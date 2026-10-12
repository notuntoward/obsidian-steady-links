import { Plugin, Editor, MarkdownView, Notice, FileSystemAdapter, TFile, Menu, Platform } from "obsidian";
import { Extension, EditorSelection } from "@codemirror/state";
import { EditLinkModal } from "./EditLinkModal";
import { EditorFileSuggest } from "./EditorFileSuggest";
import { SteadyLinksSettingTab } from "./SettingTab";
import { PluginSettings, LinkInfo } from "./types";
import {
	detectLinkAtCursor,
	determineLinkFromContext,
	urlAtCursor,
	isUrl,
	normalizeUrl,
	computeDisplayedTextRange,
	bareDomainNoteTargetFromUrl,
	fileExtTokenAtCursor,
	moveToFront,
} from "./utils";
import {
	buildLinkText,
	computeCloseCursorPosition,
	computeSkipCursorPosition,
	computeSkipLinkPosition,
} from "./modalLogic";
import {
	generateFileLink,
	generateLocationLink,
	knownBlockIds,
	planLocationLink,
	resolveLocation,
	selectedFileFromMenu,
	isSupportedFileTarget,
	shouldAddFileLinkMenuItem,
} from "./copyLinks";
import { revealInNativeFileExplorer, type NativeFileExplorerPlugin } from "./fileExplorer";
import {
	resolveLocalFileTargetPath,
	resolveVaultFileFromLink,
} from "./linkTargetResolution";
import { generateBlockId } from "./suggestionLogic";
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
	setDebug(enabled: boolean = true) {
		(window as any).__STEADY_LINKS_DEBUG = enabled;
		console.log(`[SteadyLinks] Debug logging ${enabled ? "enabled" : "disabled"}`);
	}
	settings!: PluginSettings;
	private editorFileSuggest!: EditorFileSuggest;

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
			try {
				const cm6View = (editor as any).cm as EditorView | undefined;
				if (!cm6View) {
					editor.setCursor(cursorPos);
					return;
				}

				const doc = cm6View.state.doc;
				if (doc.lines < 1) return;
				const targetLine = Math.max(1, Math.min(doc.lines, cursorPos.line + 1));
				const line = doc.line(targetLine);
				const targetCh = Math.max(0, Math.min(line.length, cursorPos.ch));
				const head = Math.max(line.from, Math.min(line.to, line.from + targetCh));

				cm6View.focus();
				try {
					editor.setCursor({ line: targetLine - 1, ch: targetCh });
				} catch (e) {
					console.warn("[SteadyLinks] editor.setCursor fallback failed:", e);
				}
				cm6View.dispatch({
					selection: EditorSelection.cursor(head),
					scrollIntoView: true,
				});
			} catch (err) {
				console.error("[SteadyLinks] Error restoring cursor after modal close:", err, cursorPos);
			}
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





		// Register the (initially empty) extension array.  We populate it
		// later based on the user's setting.
		this.registerEditorExtension(this.syntaxHiderExtensions);

		this.editorFileSuggest = new EditorFileSuggest(this.app, this);
		this.registerEditorSuggest(this.editorFileSuggest);

		// Re-assert our suggest's position once more after layout is fully
		// restored (all plugins finished loading), in case another plugin
		// raced to the front of the list during its own onload().
		this.app.workspace.onLayoutReady(() => {
			this.prioritizeOwnSuggest();
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
			editorCallback: (editor: Editor, _view: MarkdownView) => {
				this.handleOpenLinkInDefaultApp(editor);
			},
		});

		this.addCommand({
			id: "reveal-linked-file-in-navigation",
			name: "Reveal linked file in navigation",
			editorCallback: (editor: Editor, _view: MarkdownView) => {
				this.handleRevealLinkedFileInNavigation(editor);
			},
		});

		this.addCommand({
			id: "copy-link-to-current-note",
			name: "Copy link to current note",
			checkCallback: (checking: boolean) => {
				if (this.isFileExplorerActive()) {
					if (!checking) {
						new Notice(
							"File Explorer rows cannot be targeted by this hotkey. Right-click the desired file and choose Copy link to current note; the file does not need to be open."
						);
					}
					return true;
				}
				const file = this.app.workspace.getActiveFile();
				if (!file || !isSupportedFileTarget(file)) return false;
				if (!checking) this.copyLinkToFile(file);
				return true;
			},
		});

		this.addCommand({
			id: "copy-link-to-current-location",
			name: "Copy link to current location",
			checkCallback: (checking: boolean) => {
				if (this.isFileExplorerActive()) {
					if (checking) return false;
					new Notice(
						"Copy link to current location is not implemented in File Explorer. Open the note in an editing view and run this command there."
					);
					return true;
				}
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (view?.file && view.getMode() === "source") {
					const resolution = this.resolveEditorLocation(view.editor, view.file);
					if (!resolution.target) {
						if (!checking) new Notice(resolution.reason ?? "Could not resolve this location.");
						return false;
					}
					if (!checking) this.copyLinkToLocation(view.editor, view.file);
					return true;
				}
				if (this.isActivePdfView()) {
					if (!checking) this.showPdfPageLimitation();
					return true;
				}
				return false;
			},
		});

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu: Menu, file: unknown, source: string) => {
				// Use the file payload as the target; Explorer sources can be
				// "file-explorer-context-menu", not only "file-explorer".
				if (
					!(file instanceof TFile) ||
					!shouldAddFileLinkMenuItem(
						source,
						this.settings.copyLinkToCurrentNoteInTabMenu
					)
				) {
					return;
				}
				this.addCopyFileMenuItem(menu, file);
			})
		);

		this.registerEvent(
			this.app.workspace.on("files-menu", (menu, files) => {
				// Obsidian supplies the exact selected-file list through this
				// public event. A multi-file selection is intentionally omitted.
				const file = selectedFileFromMenu(files);
				if (file) this.addCopyFileMenuItem(menu, file);
			})
		);

		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, editor, info) => {
				if (!(info instanceof MarkdownView) || info.getMode() !== "source") return;
				const file = info.file;
				if (!file) return;
				const resolution = this.resolveEditorLocation(editor, file);
				if (!resolution.target) return;
				menu.addItem((item) => {
					item
						.setTitle("Copy link to current location")
						.setIcon("link")
						.onClick(() => this.copyLinkToLocation(editor, file));
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

	private handleRevealLinkedFileInNavigation(editor: Editor): void {
		const link = this.getLinkAtCursor(editor);
		if (!link) {
			new Notice("No link found at cursor");
			return;
		}
		const file = this.getVaultFileFromLink(link.link);
		if (!file) {
			let destination = link.link.destination.trim();
			if (destination.startsWith("<") && destination.endsWith(">")) {
				destination = destination.slice(1, -1).trim();
			}
			if (isUrl(destination)) {
				new Notice("Cannot reveal a URL in Obsidian's File Explorer");
				return;
			}
			new Notice("Only files in this vault can be revealed in Obsidian's File Explorer");
			return;
		}
		try {
			if (!this.revealFileInNativeNavigation(file)) {
				new Notice("Obsidian's native File Explorer is unavailable");
			}
		} catch {
			new Notice("Could not reveal the linked file in Obsidian's File Explorer");
		}
	}

	private getOpenableFromCursor(
		editor: Editor
	): { kind: "url"; url: string } | { kind: "file"; path: string } | null {
		const link = this.getLinkAtCursor(editor);
		if (!link) return null;
		return this.resolveOpenableTarget(link.link);
	}

	private getLinkAtCursor(editor: Editor) {
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);
		return detectLinkAtCursor(line, cursor.ch);
	}

	private getVaultFileFromLink(link: { destination: string; isWiki: boolean }): TFile | null {
		return resolveVaultFileFromLink(
			link,
			this.app.workspace.getActiveFile()?.path ?? "",
			(linkPath, sourcePath) =>
				this.app.metadataCache.getFirstLinkpathDest(linkPath, sourcePath)
		);
	}

	private revealFileInNativeNavigation(file: TFile): boolean {
		// This is the core File Explorer API used by Obsidian's native reveal action.
		// Keep the internal plugin access narrowly typed because it is not in obsidian.d.ts.
		const appWithInternalPlugins = this.app as unknown as {
			internalPlugins?: {
				getPluginById?: (id: string) => NativeFileExplorerPlugin | null;
			};
		};
		const fileExplorerPlugin =
			appWithInternalPlugins.internalPlugins?.getPluginById?.("file-explorer");
		return revealInNativeFileExplorer(fileExplorerPlugin, file);
	}

	private resolveOpenableTarget(
		link: { destination: string; isWiki: boolean }
	): { kind: "url"; url: string } | { kind: "file"; path: string } | null {
		let d = link.destination.trim();
		if (d.startsWith("<") && d.endsWith(">")) {
			d = d.slice(1, -1).trim();
		}
		if (!d) return null;

		const isExplicitUrl = /^https?:\/\//i.test(d) || /^www\./i.test(d);

		if (isExplicitUrl) {
			return { kind: "url", url: normalizeUrl(d) };
		}

		const adapter = this.app.vault.adapter;
		const getFullPath =
			adapter instanceof FileSystemAdapter
				? (path: string) => adapter.getFullPath(path)
				: undefined;
		const filePath = resolveLocalFileTargetPath(
			link,
			this.app.workspace.getActiveFile()?.path ?? "",
			(linkPath, sourcePath) =>
				this.app.metadataCache.getFirstLinkpathDest(linkPath, sourcePath),
			getFullPath
		);
		if (filePath) return { kind: "file", path: filePath };

		if (isUrl(d)) {
			return { kind: "url", url: normalizeUrl(d) };
		}

		return null;
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
		if (!isSupportedFileTarget(file)) {
			new Notice("Canvas and Ink links are not supported");
			return;
		}
		try {
			const link = generateFileLink(file, this.app.fileManager, file.path);
			this.writeLinkToClipboard(link, "Copied link to current note");
		} catch {
			new Notice("Could not generate a link to this file");
		}
	}

	private addCopyFileMenuItem(menu: Menu, file: TFile): void {
		if (!isSupportedFileTarget(file)) return;
		menu.addItem((item) => {
			item
				.setTitle("Copy link to current note")
				.setIcon("link")
				.onClick(() => this.copyLinkToFile(file));
		});
	}

	private isFileExplorerActive(): boolean {
		return this.app.workspace.activeLeaf?.view.getViewType() === "file-explorer";
	}

	private isActivePdfView(): boolean {
		return (
			this.app.workspace.activeLeaf?.view.getViewType() === "pdf" &&
			this.app.workspace.getActiveFile()?.extension.toLowerCase() === "pdf"
		);
	}

	private resolveEditorLocation(editor: Editor, file: TFile) {
		if (editor.listSelections().length !== 1) {
			return {
				target: null,
				reason: "Multiple editor selections are ambiguous; use one cursor or one text selection.",
			};
		}
		const selection = editor.somethingSelected()
			? {
					from: editor.getCursor("from"),
					to: editor.getCursor("to"),
					text: editor.getSelection(),
				}
			: undefined;
		return resolveLocation({
			content: editor.getValue(),
			cache: this.app.metadataCache.getFileCache(file),
			cursor: editor.getCursor(),
			selection,
		});
	}

	private copyLinkToLocation(editor: Editor, file: TFile): void {
		const resolution = this.resolveEditorLocation(editor, file);
		if (!resolution.target) {
			new Notice(resolution.reason ?? "Could not resolve this location.");
			return;
		}
		const cache = this.app.metadataCache.getFileCache(file);
		if (!cache) {
			new Notice("Obsidian has not indexed this note yet.");
			return;
		}
		const plan = planLocationLink(resolution.target, knownBlockIds(cache), generateBlockId);
		if (!plan) {
			new Notice("Could not create a reliable link to this location.");
			return;
		}

		try {
			if (plan.insertion) {
				editor.replaceRange(plan.insertion.text, plan.insertion.position);
			}
			const link = generateLocationLink(
				file,
				this.app.fileManager,
				plan.subpath,
				resolution.target.alias
			);
			const targetLabel =
				resolution.target.kind === "heading"
					? `heading "${resolution.target.heading}"`
					: resolution.target.kind === "table"
						? "table"
						: "block";
			this.writeLinkToClipboard(link, `Copied link to ${targetLabel} in ${file.basename}`);
		} catch {
			new Notice("Could not create a reliable link to this location.");
		}
	}

	private writeLinkToClipboard(link: string, successNotice: string): void {
		try {
			const clipboard = navigator.clipboard;
			if (!clipboard) {
				new Notice("Clipboard access is unavailable");
				return;
			}
			clipboard
				.writeText(link)
				.then(() => new Notice(successNotice))
				.catch(() => new Notice("Failed to copy link to clipboard"));
		} catch {
			new Notice("Failed to copy link to clipboard");
		}
	}

	private showPdfPageLimitation(): void {
		new Notice(
			"Could not determine the PDF page under the pointer. Use the PDF viewer's 1-based page number and create the #page=n link manually."
		);
	}

	/**
	 * Expand the link syntax at the current cursor position.
	 * Used by both "Expand Link" and "Toggle Link Expand" commands.
	 * Only works in live preview mode when "keep links steady" is enabled.
	 */
	private expandLink(editor: Editor, _view: MarkdownView): void {
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

		// If not found exactly at the cursor, the cursor may have been pushed
		// outside the link's raw range by a few characters (e.g. by Steady
		// Links' own hidden-syntax cursor correction landing just off the
		// link boundary). Search outward from the cursor, nearest position
		// first, but keep the search BOUNDED:
		//   - detectLinkAtCursor rescans the whole line on every call, so an
		//     unbounded outward search is O(line length²) in the worst case
		//     (a long line with no link near the cursor).
		//   - An unbounded search can also walk all the way to a completely
		//     unrelated link elsewhere on the same line and act on THAT one,
		//     instead of correctly doing nothing when the cursor isn't
		//     actually near any link.
		// A "pushed out" cursor is only ever off by the width of a small
		// number of hidden syntax characters, never by an arbitrarily large
		// distance, so a small fixed cap is both safe and sufficient.
		const MAX_PUSHED_OUT_CURSOR_SEARCH = 5;
		if (!existingLink) {
			for (let offset = 1; offset <= MAX_PUSHED_OUT_CURSOR_SEARCH; offset++) {
				const before = cursor.ch - offset;
				if (before >= 0) {
					existingLink = detectLinkAtCursor(line, before);
					if (existingLink) break;
				}
				const after = cursor.ch + offset;
				if (after <= line.length) {
					existingLink = detectLinkAtCursor(line, after);
					if (existingLink) break;
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
	private collapseLink(editor: Editor, _view: MarkdownView): void {
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
		}
		// Keep our own [[ suggest first in line regardless of the setting.
		// EditorFileSuggest.onTrigger() already returns null immediately when
		// keepLinksSteady is off, so Obsidian falls through to the next
		// registered suggest (e.g. the built-in one) on its own — there is
		// nothing to "restore" when the setting is disabled.
		this.prioritizeOwnSuggest();
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

	/**
	 * Move our own `[[` suggest to the front of Obsidian's internal suggest
	 * list so it is always checked before the built-in `[[` suggest (or any
	 * other plugin's), instead of trying to detect and disable the built-in
	 * one.
	 *
	 * Obsidian's suggest manager calls each registered EditorSuggest's
	 * `onTrigger()` in array order and uses the first one that returns a
	 * non-null result, so simply going first is enough to make our own
	 * popup win — there is nothing to disable, remove, or later restore.
	 * `EditorFileSuggest.onTrigger()` already returns null immediately when
	 * `keepLinksSteady` is off, so Obsidian falls through to the next
	 * registered suggest on its own in that case.
	 *
	 * This only reorders an array we already have an entry in via the
	 * documented `registerEditorSuggest` API; it never inspects, calls, or
	 * mutates any other plugin's suggest.
	 */
	private prioritizeOwnSuggest() {
		const suggests = (this.app.workspace as any).editorSuggest?.suggests;
		if (!Array.isArray(suggests)) return;
		moveToFront(suggests, this.editorFileSuggest);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
