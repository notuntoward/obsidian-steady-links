import { Plugin, Editor, MarkdownView, Notice, FileSystemAdapter, TFile, Menu, Platform } from "obsidian";
import { Extension, EditorSelection } from "@codemirror/state";
import { EditLinkModal } from "./EditLinkModal";
import { EditorFileSuggest } from "./EditorFileSuggest";
import { SteadyLinksSettingTab } from "./SettingTab";
import { PluginSettings, LinkInfo } from "./types";
import {
	parseClipboardLink,
	detectLinkAtCursor,
	determineLinkFromContext,
	urlAtCursor,
	isUrl,
	normalizeUrl,
	computeDisplayedTextRange,
	bareDomainNoteTargetFromUrl,
	fileExtTokenAtCursor,
} from "./utils";
import {
	buildLinkText,
	computeCloseCursorPosition,
	computeSkipCursorPosition,
	computeSkipLinkPosition,
} from "./modalLogic";
import {
	createLinkSyntaxHiderExtension,
	findLinkRangeAtPos,
	setTemporarilyVisibleLink,
	temporarilyVisibleLinkField,
	stripTrailingLinkSyntaxForClipboard,
	setWikiLinkHidingOptions,
} from "./linkSyntaxHider";
import { EditorView } from "@codemirror/view";

const DEFAULT_SETTINGS: PluginSettings = {
	keepLinksSteady: false,
	copyLinkToCurrentNoteInTabMenu: false,
	shortenHeadingLinks: false,
	shortenFileLinks: false,
};

export default class SteadyLinksPlugin extends Plugin {
	settings!: PluginSettings;
	private editorFileSuggest!: EditorFileSuggest;
	private disabledBuiltInSuggest: any = null;

	/**
	 * Live array registered with `registerEditorExtension`.
	 * Mutating its contents and calling `app.workspace.updateOptions()`
	 * toggles the link-syntax-hider extension at runtime.
	 */
	private syntaxHiderExtensions: Extension[] = [];

	private restoreCursorAfterModalClose(
		editor: Editor,
		cursorPos: { line: number; ch: number }
	): void {
		const restore = () => {
			const cm6View = (editor as any).cm as EditorView | undefined;
			if (!cm6View) {
				editor.setCursor(cursorPos);
				return;
			}

			const line = cm6View.state.doc.line(cursorPos.line + 1);
			const head = Math.max(line.from, Math.min(line.to, line.from + cursorPos.ch));

			cm6View.focus();
			editor.setCursor(cursorPos);
			cm6View.dispatch({
				selection: EditorSelection.cursor(head),
				scrollIntoView: true,
			});
		};

		window.setTimeout(() => {
			if (typeof window.requestAnimationFrame === "function") {
				window.requestAnimationFrame(() => {
					restore();
				});
				return;
			}

			restore();
		}, 0);
	}

	/**
	 * Check if the current view is in source mode (as opposed to live preview).
	 */
	private isSourceMode(view: MarkdownView): boolean {
		const cm6View = (view.editor as any).cm as EditorView;
		if (!cm6View) {
			// If no CM6 view, we're likely in reading view or legacy mode
			// In this case, treat as source mode (skip off link)
			return true;
		}
		const sourceView = cm6View.dom.closest(".markdown-source-view");
		if (!sourceView) {
			// No source view container, treat as source mode
			return true;
		}
		// Check for explicit source mode class
		if (sourceView.classList.contains("is-source-mode")) return true;
		// Check for live preview class - if not present, assume source mode
		if (!sourceView.classList.contains("is-live-preview")) return true;
		return false;
	}

	/**
	 * Determine if cursor should skip off link after modal closes.
	 * Returns true if:
	 * - "keep links steady" is OFF, OR
	 * - We're in source mode (where syntax hider is not active)
	 */
	private shouldSkipOffLink(view: MarkdownView): boolean {
		// If keepLinksSteady is OFF, always skip
		if (!this.settings.keepLinksSteady) return true;
		// If keepLinksSteady is ON, only skip if we're in source mode
		// (in live preview, the syntax hider is active and we want to stay on link)
		return this.isSourceMode(view);
	}

	async onload() {
		await this.loadSettings();

		// -----------------------------------------------------------------------
		// Fix: register DOM copy listener to strip trailing link syntax when copying.
		// When the cursor is inside a link's visible text and copy/kill-line selects
		// to end of line, the raw selection contains trailing hidden syntax like "]]"
		// or "](url)". We intercept standard copy operations and strip it.
		// -----------------------------------------------------------------------
		this.registerDomEvent(document, "copy", (e: ClipboardEvent) => {
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			const cm6View = activeView
				? ((activeView.editor as any).cm as EditorView | undefined)
				: undefined;
			if (cm6View && cm6View.hasFocus) {
				const selection = cm6View.state.sliceDoc(
					cm6View.state.selection.main.from,
					cm6View.state.selection.main.to
				);
				const stripped = stripTrailingLinkSyntaxForClipboard(selection, cm6View.state);
				if (stripped !== selection) {
					e.clipboardData?.setData("text/plain", stripped);
					e.preventDefault();
				}
			}
		});
		// -----------------------------------------------------------------------

		// -----------------------------------------------------------------------
		// Capture Ctrl+n / Ctrl+p / Ctrl+b / Ctrl+f globally when suggestions are open
		// to bypass default global commands (like Ctrl+n = New Note) and Vim overrides.
		// -----------------------------------------------------------------------
		this.registerDomEvent(window, "keydown", (e: KeyboardEvent) => {
			if (!e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return;
			const key = e.key.toLowerCase();
			if (key !== "n" && key !== "p" && key !== "b" && key !== "f") return;

			const containers = document.querySelectorAll(".suggestion-container");
			let isAnySuggestOpen = false;
			for (let i = 0; i < containers.length; i++) {
				const container = containers[i];
				if (!container.classList.contains("is-hidden") && (container as HTMLElement).style.display !== "none") {
					isAnySuggestOpen = true;
					break;
				}
			}

			if (isAnySuggestOpen) {
				e.preventDefault();
				e.stopImmediatePropagation();

				let mappedKey = "";
				let mappedCode = "";
				let mappedKeyCode = 0;

				if (key === "n") {
					mappedKey = "ArrowDown";
					mappedCode = "ArrowDown";
					mappedKeyCode = 40;
				} else if (key === "p") {
					mappedKey = "ArrowUp";
					mappedCode = "ArrowUp";
					mappedKeyCode = 38;
				} else if (key === "b") {
					mappedKey = "ArrowLeft";
					mappedCode = "ArrowLeft";
					mappedKeyCode = 37;
				} else if (key === "f") {
					mappedKey = "ArrowRight";
					mappedCode = "ArrowRight";
					mappedKeyCode = 39;
				}

				const target = document.activeElement || document;
				const shouldBubble = !("tagName" in target) || ((target as any).tagName !== "INPUT" && (target as any).tagName !== "TEXTAREA");
				target.dispatchEvent(new KeyboardEvent("keydown", {
					key: mappedKey,
					code: mappedCode,
					keyCode: mappedKeyCode,
					which: mappedKeyCode,
					bubbles: shouldBubble,
					cancelable: true
				}));
			}
		}, true);
		// -----------------------------------------------------------------------

		// Register the (initially empty) extension array.  We populate it
		// later based on the user's setting.
		this.registerEditorExtension(this.syntaxHiderExtensions);

		this.editorFileSuggest = new EditorFileSuggest(this.app, this);
		this.registerEditorSuggest(this.editorFileSuggest);

		this.app.workspace.onLayoutReady(() => {
			if (this.settings.keepLinksSteady) {
				this.disableBuiltInLinkSuggest();
			}
		});

		this.applySyntaxHiderSetting();

		this.addCommand({
			id: "edit-link",
			name: "Edit link",
			editorCallback: async (editor: Editor, view: MarkdownView) => {
				await this.handleEditLinkCommand(editor, view);
			},
		});

		this.addCommand({
			id: "collapse-link",
			name: "Collapse Link",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				// In source mode, there's no link syntax hiding - do nothing
				if (this.isSourceMode(view)) {
					return;
				}
				this.collapseLink(editor, view);
			},
		});

		this.addCommand({
			id: "expand-link",
			name: "Expand Link",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				// In source mode, there's no link syntax hiding - do nothing
				if (this.isSourceMode(view)) {
					return;
				}
				this.expandLink(editor, view);
			},
		});

		this.addCommand({
			id: "toggle-link-expand",
			name: "Toggle Link Expand",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				// In source mode, there's no link syntax hiding - do nothing
				if (this.isSourceMode(view)) {
					return;
				}

				// When "keep links steady" is disabled, behave like Collapse Link
				// This preserves muscle memory for users who developed it while the setting was enabled
				if (!this.settings.keepLinksSteady) {
					this.collapseLink(editor, view);
					return;
				}

				const cm6View = (editor as any).cm as EditorView;
				if (!cm6View) {
					return;
				}

				// Check if there's a temporarily visible link
				const currentVisible = cm6View.state.field(temporarilyVisibleLinkField, false);

				if (currentVisible) {
					// Link is shown, collapse it
					this.collapseLink(editor, view);
				} else {
					// Link is collapsed, expand it
					this.expandLink(editor, view);
				}
			},
		});

		this.addCommand({
			id: "skip-link",
			name: "Skip Link",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				const cursor = editor.getCursor();
				const line = editor.getLine(cursor.line);

				// Compute the displayed text range for the link at cursor
				const displayedRange = computeDisplayedTextRange(line, cursor.ch, {
					shortenHeadingLinks: this.settings.shortenHeadingLinks,
					shortenFileLinks: this.settings.shortenFileLinks,
				});

				if (!displayedRange) {
					// Cursor is not in or on the edge of a link - do nothing
					return;
				}

				// Compute the skip position
				const skipPos = computeSkipLinkPosition({
					linkStart: displayedRange.linkStart,
					linkEnd: displayedRange.linkEnd,
					displayedTextStart: displayedRange.displayedTextStart,
					displayedTextEnd: displayedRange.displayedTextEnd,
					cursorPos: cursor.ch,
					lineLength: line.length,
					line: cursor.line,
					lineCount: editor.lineCount(),
					prevLineLength: cursor.line > 0 ? editor.getLine(cursor.line - 1).length : 0,
					isSourceMode: this.isSourceMode(view),
					keepLinksSteady: this.settings.keepLinksSteady,
				});

				if (skipPos) {
					editor.setCursor(skipPos);
				}
			},
		});

		this.addCommand({
			id: "open-link-in-default-app",
			name: "Open link in default app",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.handleOpenLinkInDefaultApp(editor);
			},
		});

		this.addCommand({
			id: "reveal-link-in-explorer",
			name: "Reveal link in file explorer",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.handleRevealLinkInExplorer(editor);
			},
		});

		this.addCommand({
			id: "copy-link-to-current-note",
			name: "Copy link to current note",
			callback: () => {
				const file = this.app.workspace.getActiveFile();
				if (!file) {
					new Notice("No active note");
					return;
				}
				this.copyLinkToFile(file);
			},
		});

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu: Menu, file: unknown, source: string) => {
				if (!this.settings.copyLinkToCurrentNoteInTabMenu) return;
				if (source !== "tab-header") return;
				if (!(file instanceof TFile)) return;
				menu.addItem((item) => {
					item
						.setTitle("Copy link to current note")
						.setIcon("link")
						.onClick(() => this.copyLinkToFile(file));
				});
			})
		);

		this.addSettingTab(new SteadyLinksSettingTab(this.app, this));
	}

	private handleOpenLinkInDefaultApp(editor: Editor): void {
		if (!Platform.isDesktop) {
			new Notice("Opening in default app is only supported on desktop");
			return;
		}
		const target = this.getOpenableFromCursor(editor);
		if (!target) {
			new Notice("No link found at cursor");
			return;
		}
		const { shell } = require("electron");
		if (target.kind === "url") {
			shell.openExternal(target.url).catch(() => new Notice("Failed to open URL"));
			return;
		}
		shell.openPath(target.path).then((errMsg: string) => {
			if (errMsg) new Notice("Failed to open: " + errMsg);
		});
	}

	private handleRevealLinkInExplorer(editor: Editor): void {
		if (!Platform.isDesktop) {
			new Notice("Revealing in file explorer is only supported on desktop");
			return;
		}
		const target = this.getOpenableFromCursor(editor);
		if (!target) {
			new Notice("No link found at cursor");
			return;
		}
		if (target.kind === "url") {
			new Notice("Cannot reveal a URL in the file explorer");
			return;
		}
		const { shell } = require("electron");
		shell.showItemInFolder(target.path);
	}

	private getOpenableFromCursor(
		editor: Editor
	): { kind: "url"; url: string } | { kind: "file"; path: string } | null {
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);
		const link = detectLinkAtCursor(line, cursor.ch);
		if (!link) return null;
		return this.resolveOpenableTarget(link.link.destination);
	}

	private resolveOpenableTarget(
		destination: string
	): { kind: "url"; url: string } | { kind: "file"; path: string } | null {
		let d = destination.trim();
		if (d.startsWith("<") && d.endsWith(">")) {
			d = d.slice(1, -1).trim();
		}
		if (!d) return null;

		const isExplicitUrl = /^https?:\/\//i.test(d) || /^www\./i.test(d);

		if (isExplicitUrl) {
			return { kind: "url", url: normalizeUrl(d) };
		}

		const fileTarget = this.resolveVaultFile(d);
		if (fileTarget) return fileTarget;

		if (isUrl(d)) {
			return { kind: "url", url: normalizeUrl(d) };
		}

		if (this.looksLikeAbsolutePath(d)) {
			return { kind: "file", path: d };
		}

		return null;
	}

	private resolveVaultFile(
		destination: string
	): { kind: "file"; path: string } | null {
		const filePart = destination.split("#")[0].trim();
		if (!filePart) return null;

		const sourcePath = this.app.workspace.getActiveFile()?.path ?? "";
		let tfile: TFile | null = null;
		try {
			tfile = this.app.metadataCache.getFirstLinkpathDest(filePart, sourcePath);
		} catch {
			tfile = null;
		}
		if (!tfile) return null;

		const adapter = this.app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) return null;
		return { kind: "file", path: adapter.getFullPath(tfile.path) };
	}

	private looksLikeAbsolutePath(p: string): boolean {
		return (
			/^[A-Za-z]:[\\/]/.test(p) ||
			p.startsWith("/") ||
			p.startsWith("\\\\")
		);
	}

	/**
	 * Apply link edit to editor
	 */
	private applyLinkEdit(
		editor: Editor,
		line: number,
		start: number,
		end: number,
		result: LinkInfo,
		enteredFromLeft: boolean
	): { line: number; ch: number } {
		const replacement = buildLinkText(result);

		editor.replaceRange(replacement, { line: line, ch: start }, { line: line, ch: end });

		const cursorPos = computeCloseCursorPosition({
			linkStart: start,
			linkEnd: start + replacement.length,
			lineLength: editor.getLine(line).length,
			line,
			preferRight: !enteredFromLeft,
			lineCount: editor.lineCount(),
			prevLineLength: line > 0 ? editor.getLine(line - 1).length : 0,
		});

		return cursorPos;
	}

	private copyLinkToFile(file: TFile): void {
		const linkBody = file.extension === "md" ? file.path.replace(/\.md$/i, "") : file.path;
		const wikilink = `[[${linkBody}]]`;
		navigator.clipboard
			.writeText(wikilink)
			.then(() => new Notice("Copied link to current note"))
			.catch(() => new Notice("Failed to copy link to current note"));
	}

	/**
	 * Expand the link syntax at the current cursor position.
	 * Used by both "Expand Link" and "Toggle Link Expand" commands.
	 * Only works in live preview mode when "keep links steady" is enabled.
	 */
	private expandLink(editor: Editor, view: MarkdownView): void {
		// This command only makes sense when "keep links steady" is enabled
		if (!this.settings.keepLinksSteady) {
			return;
		}

		// Get the CM6 view from the editor
		const cm6View = (editor as any).cm as EditorView;
		if (!cm6View) {
			return;
		}

		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);

		// First, try to detect link at current cursor position using the editor API
		let existingLink = detectLinkAtCursor(line, cursor.ch);

		// If not found at cursor, try to find any link on the current line
		// by iterating through potential positions (cursor might be pushed out)
		if (!existingLink) {
			// Try positions around the cursor
			for (let offset = -5; offset <= 5; offset++) {
				const testPos = cursor.ch + offset;
				if (testPos >= 0 && testPos <= line.length) {
					existingLink = detectLinkAtCursor(line, testPos);
					if (existingLink) {
						break;
					}
				}
			}
		}

		if (!existingLink) {
			return;
		}

		// Find the full link range (including syntax) using CM6 document positions
		const docLine = cm6View.state.doc.line(cursor.line + 1); // CM6 lines are 1-indexed

		// Convert the editor line position to CM6 document position
		const linkStartPos = docLine.from + existingLink.start;

		// Try to find the link range at the link's actual position
		const linkRange = findLinkRangeAtPos(docLine.text, docLine.from, linkStartPos);

		if (!linkRange) {
			return;
		}

		// Dispatch effect to temporarily show this link's syntax
		cm6View.dispatch({
			effects: setTemporarilyVisibleLink.of(linkRange),
		});
	}

	/**
	 * Collapse the link syntax at the current cursor position.
	 * Used by both "Collapse Link" and "Toggle Link Expand" commands.
	 *
	 * When "keep links steady" is ON: cursor stays on link for easy toggling
	 * When "keep links steady" is OFF: cursor skips off link to prevent automatic re-expansion
	 */
	private collapseLink(editor: Editor, view: MarkdownView): void {
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);

		const existingLink = detectLinkAtCursor(line, cursor.ch);

		if (!existingLink) {
			return;
		}

		// Clear any temporarily visible link
		const cm6View = (editor as any).cm as EditorView;
		if (cm6View) {
			cm6View.dispatch({
				effects: setTemporarilyVisibleLink.of(null),
			});
		}

		// When "keep links steady" is ON, don't skip - let user toggle back and forth
		// When OFF, skip off the link to prevent automatic re-expansion
		if (this.settings.keepLinksSteady) {
			return;
		}

		const skipPos = computeSkipCursorPosition({
			linkStart: existingLink.start,
			linkEnd: existingLink.end,
			cursorPos: cursor.ch,
			lineLength: line.length,
			line: cursor.line,
			lineCount: editor.lineCount(),
			prevLineLength: cursor.line > 0 ? editor.getLine(cursor.line - 1).length : 0,
		});

		editor.setCursor(skipPos);
	}

	/**
	 * Populate or clear the live extensions array so the CM6 link-syntax
	 * hider is active only when the user has opted in.
	 */
	applySyntaxHiderSetting() {
		this.syntaxHiderExtensions.length = 0;
		const wikiLinkOptions = {
			shortenHeadingLinks: this.settings.shortenHeadingLinks,
			shortenFileLinks: this.settings.shortenFileLinks,
		};
		if (this.settings.keepLinksSteady) {
			this.syntaxHiderExtensions.push(...createLinkSyntaxHiderExtension(wikiLinkOptions));
			this.disableBuiltInLinkSuggest();
		} else {
			this.enableBuiltInLinkSuggest();
		}
		this.app.workspace.updateOptions();

		// Broadcast the current wikilink-shortening options directly to every
		// already-open editor. workspace.updateOptions() alone is not enough
		// here: CodeMirror's Compartment.reconfigure() (what updateOptions()
		// triggers) preserves an existing StateField's current value across a
		// reconfigure rather than re-running its .init() initializer with the
		// new value — .init() only takes effect the first time the field is
		// introduced into a given editor's state. So toggling a setting like
		// "Shorten heading and block links" while "Keep links steady" stays
		// enabled throughout would otherwise have no visible effect until
		// Obsidian is restarted.
		if (this.settings.keepLinksSteady) {
			this.app.workspace.iterateAllLeaves((leaf) => {
				if (!(leaf.view instanceof MarkdownView)) return;
				const cm6View = (leaf.view.editor as any).cm as EditorView | undefined;
				cm6View?.dispatch({ effects: [setWikiLinkHidingOptions.of(wikiLinkOptions)] });
			});
		}
	}

	/**
	 * Handle the Edit Link command - orchestrates opening the modal and applying changes.
	 * Routes to either handling an existing link edit or creating a new link.
	 */
	private async handleEditLinkCommand(editor: Editor, view: MarkdownView): Promise<void> {
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);

		// Detect existing link at cursor
		const existingLink = detectLinkAtCursor(line, cursor.ch);

		if (existingLink) {
			// Editing existing link
			this.handleExistingLinkEdit(editor, view, cursor, existingLink);
		} else {
			// Creating new link
			await this.handleNewLinkCreation(editor, cursor, line);
		}
	}

	/**
	 * Handle editing an existing link - preserves cursor behavior based on "keep links steady" setting.
	 * Applies link changes and positions cursor appropriately after modal closes.
	 */
	private handleExistingLinkEdit(
		editor: Editor,
		view: MarkdownView,
		cursor: { line: number; ch: number },
		existingLink: any
	): void {
		const originalCursor = { line: cursor.line, ch: cursor.ch };
		const shouldSkip = this.shouldSkipOffLink(view);
		const start = existingLink.start;
		const end = existingLink.end;

		new EditLinkModal(
			this.app,
			existingLink.link,
			(result: LinkInfo) => {
				const replacement = buildLinkText(result);
				const newEnd = start + replacement.length;

				editor.replaceRange(
					replacement,
					{ line: cursor.line, ch: start },
					{ line: cursor.line, ch: end }
				);

				if (shouldSkip) {
					const lineText = editor.getLine(cursor.line);
					const skipPos = computeSkipCursorPosition({
						linkStart: start,
						linkEnd: newEnd,
						cursorPos: originalCursor.ch,
						lineLength: lineText.length,
						line: cursor.line,
						lineCount: editor.lineCount(),
						prevLineLength:
							cursor.line > 0 ? editor.getLine(cursor.line - 1).length : 0,
					});
					this.restoreCursorAfterModalClose(editor, skipPos);
				} else {
					this.restoreCursorAfterModalClose(editor, originalCursor);
				}
			},
			false, // shouldSelectText
			null, // conversionNotice
			false, // isNewLink
			() => {
				// On cancel: return cursor based on mode
				if (shouldSkip) {
					const lineText = editor.getLine(cursor.line);
					const skipPos = computeSkipCursorPosition({
						linkStart: start,
						linkEnd: end,
						cursorPos: originalCursor.ch,
						lineLength: lineText.length,
						line: cursor.line,
						lineCount: editor.lineCount(),
						prevLineLength:
							cursor.line > 0 ? editor.getLine(cursor.line - 1).length : 0,
					});
					this.restoreCursorAfterModalClose(editor, skipPos);
				} else {
					this.restoreCursorAfterModalClose(editor, originalCursor);
				}
			}
		).open();
	}

	/**
	 * Handle creating a new link - infers link context from selection/clipboard/cursor position.
	 * Intelligently determines link text, destination, and range for the new link.
	 */
	/**
	 * Return true when `cursorUrl` is a scheme-less bare-domain string whose
	 * exact name matches an existing note in the vault. Explicit URLs (with an
	 * http(s):// scheme or www. prefix) always return false — an explicit scheme
	 * signals web intent regardless of any same-named note.
	 */
	private bareDomainResolvesToNote(cursorUrl: string): boolean {
		const trimmed = cursorUrl.trim();
		if (/^(https?:\/\/|www\.)/i.test(trimmed)) return false;

		const noteTarget = bareDomainNoteTargetFromUrl(trimmed);
		if (noteTarget === null) return false;

		const sourcePath = this.app.workspace.getActiveFile()?.path ?? "";
		try {
			return (
				this.app.metadataCache.getFirstLinkpathDest(noteTarget, sourcePath) !== null
			);
		} catch {
			return false;
		}
	}

	/**
	 * If the cursor sits on a bare file reference with a linkable extension
	 * (e.g. diagram.canvas, assets/photo.png) AND that file exists in the vault,
	 * return the token; otherwise null. Existence is required so we never make a
	 * wikilink to a non-existent file.
	 */
	private resolveCursorFileLink(line: string, cursorCh: number): string | null {
		const token = fileExtTokenAtCursor(line, cursorCh);
		if (token === null) return null;

		// Resolve against the vault. Strip any trailing #heading/^block.
		const linkpath = token.split("#")[0].trim();
		if (!linkpath) return null;

		const sourcePath = this.app.workspace.getActiveFile()?.path ?? "";
		try {
			return this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath) !== null
				? token
				: null;
		} catch {
			return null;
		}
	}

	private async handleNewLinkCreation(
		editor: Editor,
		cursor: { line: number; ch: number },
		line: string
	): Promise<void> {
		const selection = editor.getSelection();
		let clipboardText = "";

		try {
			clipboardText = await navigator.clipboard.readText();
			clipboardText = clipboardText.trim();
		} catch (e) {
			// Clipboard access may fail - proceed without it
		}

		const cursorUrl = urlAtCursor(line, cursor.ch);

		// If the cursor is on a scheme-less bare-domain string that matches an
		// existing note (e.g. a note literally named community.cloud.databricks.com),
		// treat it as a note link rather than promoting it to a web URL.
		const cursorUrlResolvesToNote =
			cursorUrl !== null && this.bareDomainResolvesToNote(cursorUrl);

		// If the cursor is on a bare file reference with a linkable extension
		// (e.g. diagram.canvas, assets/photo.png) that exists in the vault, make
		// a wikilink to that file.
		const cursorFileLink = this.resolveCursorFileLink(line, cursor.ch);

		const linkContext = determineLinkFromContext({
			selection,
			clipboardText,
			cursorUrl,
			line,
			cursorCh: cursor.ch,
			cursorUrlResolvesToNote,
			cursorFileLink,
		});

		const link: LinkInfo = {
			text: linkContext.text,
			destination: linkContext.destination,
			isWiki: linkContext.isWiki,
			isEmbed: false,
		};

		// Determine range for new link (selection, URL, or cursor position)
		let start = cursor.ch;
		let end = cursor.ch;

		if (editor.somethingSelected()) {
			const selStart = editor.getCursor("from");
			const selEnd = editor.getCursor("to");
			start = selStart.ch;
			end = selEnd.ch;
		} else if (cursorUrl || cursorFileLink) {
			start = linkContext.start;
			end = linkContext.end;
		}

		new EditLinkModal(
			this.app,
			link,
			(result: LinkInfo) => {
				const cursorPos = this.applyLinkEdit(
					editor,
					cursor.line,
					start,
					end,
					result,
					true // enteredFromLeft
				);
				this.restoreCursorAfterModalClose(editor, cursorPos);
			},
			linkContext.shouldSelectText,
			linkContext.conversionNotice,
			true // isNewLink
		).open();
	}

	onunload() {
		this.enableBuiltInLinkSuggest();
	}

	disableBuiltInLinkSuggest() {
		const suggests = (this.app.workspace as any).editorSuggest?.suggests;
		if (!suggests) return;

		// Find the built-in link suggest that triggers on "[["
		const mockEditor: any = {
			getLine: (line: number) => "[[",
		};
		const mockCursor: any = { line: 0, ch: 2 };
		const mockFile: any = {};

		let builtIn = null;
		for (const s of suggests) {
			try {
				const trigger = s.onTrigger(mockCursor, mockEditor, mockFile);
				if (trigger && typeof trigger === "object") {
					const noTriggerEditor: any = {
						getLine: (line: number) => "a",
					};
					const noTriggerCursor: any = { line: 0, ch: 1 };
					const noTrigger = s.onTrigger(noTriggerCursor, noTriggerEditor, mockFile);
					if (!noTrigger) {
						builtIn = s;
						break;
					}
				}
			} catch {
				// ignore
			}
		}

		if (builtIn && suggests.includes(builtIn)) {
			this.disabledBuiltInSuggest = builtIn;
			const idx = suggests.indexOf(builtIn);
			if (idx > -1) {
				suggests.splice(idx, 1);
			}
		}
	}

	enableBuiltInLinkSuggest() {
		const suggests = (this.app.workspace as any).editorSuggest?.suggests;
		if (!suggests || !this.disabledBuiltInSuggest) return;

		if (!suggests.includes(this.disabledBuiltInSuggest)) {
			suggests.unshift(this.disabledBuiltInSuggest);
		}
		this.disabledBuiltInSuggest = null;
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
