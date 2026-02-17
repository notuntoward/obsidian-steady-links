import { Plugin, Editor, MarkdownView } from "obsidian";
import { Extension } from "@codemirror/state";
import { EditLinkModal } from "./EditLinkModal";
import { SteadyLinksSettingTab } from "./SettingTab";
import { PluginSettings, LinkInfo } from "./types";
import {
	parseClipboardLink,
	detectLinkAtCursor,
	determineLinkFromContext,
	urlAtCursor,
	computeDisplayedTextRange
} from "./utils";
import { buildLinkText, computeCloseCursorPosition, computeSkipCursorPosition, computeSkipLinkPosition } from "./modalLogic";
import { createLinkSyntaxHiderExtension, findLinkRangeAtPos, setTemporarilyVisibleLink, temporarilyVisibleLinkField } from "./linkSyntaxHider";
import { EditorView } from "@codemirror/view";

const DEFAULT_SETTINGS: PluginSettings = {
	keepLinksSteady: false,
};

export default class SteadyLinksPlugin extends Plugin {
	settings!: PluginSettings;

	/**
	 * Live array registered with `registerEditorExtension`.
	 * Mutating its contents and calling `app.workspace.updateOptions()`
	 * toggles the link-syntax-hider extension at runtime.
	 */
	private syntaxHiderExtensions: Extension[] = [];

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

		// Register the (initially empty) extension array.  We populate it
		// later based on the user's setting.
		this.registerEditorExtension(this.syntaxHiderExtensions);
		this.applySyntaxHiderSetting();

		this.addCommand({
			id: "edit-link",
			name: "Edit link",
			editorCallback: async (editor: Editor, view: MarkdownView) => {
				const cursor = editor.getCursor();
				const line = editor.getLine(cursor.line);

				// Try to detect existing link at cursor
				const existingLink = detectLinkAtCursor(line, cursor.ch);

				let link: LinkInfo | null = null;
				let start = cursor.ch;
				let end = cursor.ch;
				let enteredFromLeft = true;

				if (existingLink) {
					// Found existing link
					link = existingLink.link;
					start = existingLink.start;
					end = existingLink.end;
					enteredFromLeft = existingLink.enteredFromLeft;
				} else {
					// Creating new link
					const selection = editor.getSelection();
					let clipboardText = "";

					try {
						clipboardText = await navigator.clipboard.readText();
						clipboardText = clipboardText.trim();
					} catch (e) {
						// Clipboard access may fail
					}

					const cursorUrl = urlAtCursor(line, cursor.ch);

					// Determine link from context (selection, clipboard, URL at cursor)
					const linkContext = determineLinkFromContext({
						selection,
						clipboardText,
						cursorUrl,
						line,
						cursorCh: cursor.ch
					});

					link = {
						text: linkContext.text,
						destination: linkContext.destination,
						isWiki: linkContext.isWiki,
						isEmbed: false,
					};

					// Handle selection range or URL range
					if (editor.somethingSelected()) {
						const selStart = editor.getCursor("from");
						const selEnd = editor.getCursor("to");
						start = selStart.ch;
						end = selEnd.ch;
					} else if (cursorUrl) {
						start = linkContext.start;
						end = linkContext.end;
					} else {
						start = cursor.ch;
						end = cursor.ch;
					}

					// Open modal with link information
					const isEditingExistingLink = false;
					const shouldSelectText = linkContext.shouldSelectText;
					const conversionNotice = linkContext.conversionNotice;

					// For new links, we don't need to skip off - just return to original position
					new EditLinkModal(
							this.app,
							link,
							(result: LinkInfo) => {
								const cursorPos = this.applyLinkEdit(editor, cursor.line, start, end, result, enteredFromLeft);
								// Re-assert cursor after modal closes so the link collapses in live preview
								setTimeout(() => editor.setCursor(cursorPos), 0);
							},
						shouldSelectText,
						conversionNotice,
						!isEditingExistingLink,
						undefined // onCancel - for new links, just return to original position
					).open();

					return;
				}

				// At this point, link is guaranteed to be non-null
				// Store original cursor position for cancel case
				const originalCursor = { line: cursor.line, ch: cursor.ch };
				const shouldSkip = this.shouldSkipOffLink(view);
				
				// Open modal for editing
				new EditLinkModal(
					this.app,
					link!,
					(result: LinkInfo) => {
						// On submit: apply the edit
						const replacement = buildLinkText(result);
						const newEnd = start + replacement.length;
						
						editor.replaceRange(
							replacement,
							{ line: cursor.line, ch: start },
							{ line: cursor.line, ch: end }
						);
						
						if (shouldSkip) {
							// Skip off the link to avoid painful cursoring
							const lineText = editor.getLine(cursor.line);
							const skipPos = computeSkipCursorPosition({
								linkStart: start,
								linkEnd: newEnd,
								cursorPos: originalCursor.ch,
								lineLength: lineText.length,
								line: cursor.line,
								lineCount: editor.lineCount(),
								prevLineLength: cursor.line > 0 ? editor.getLine(cursor.line - 1).length : 0,
							});
							editor.setCursor(skipPos);
						} else {
							// In live preview with keepLinksSteady ON, return to original position
							editor.setCursor(originalCursor);
						}
					},
					false, // shouldSelectText
					null,  // conversionNotice
					false, // isNewLink
					() => {
						// On cancel (ESC): return cursor based on mode
						if (shouldSkip) {
							// Skip off the link to avoid painful cursoring
							const lineText = editor.getLine(cursor.line);
							const skipPos = computeSkipCursorPosition({
								linkStart: start,
								linkEnd: end,
								cursorPos: originalCursor.ch,
								lineLength: lineText.length,
								line: cursor.line,
								lineCount: editor.lineCount(),
								prevLineLength: cursor.line > 0 ? editor.getLine(cursor.line - 1).length : 0,
							});
							editor.setCursor(skipPos);
						} else {
							// In live preview with keepLinksSteady ON, return to original position
							editor.setCursor(originalCursor);
						}
					}
				).open();
			},
		});

		this.addCommand({
			id: "hide-link-syntax",
			name: "Hide Link Syntax",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				// In source mode, there's no link syntax hiding - do nothing
				if (this.isSourceMode(view)) {
					return;
				}
				this.hideLinkSyntax(editor, view);
			},
		});

		this.addCommand({
			id: "show-link-syntax",
			name: "Show Link Syntax",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				// In source mode, there's no link syntax hiding - do nothing
				if (this.isSourceMode(view)) {
					return;
				}
				this.showLinkSyntax(editor, view);
			},
		});

		this.addCommand({
			id: "toggle-link-syntax",
			name: "Toggle Link Syntax",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				// In source mode, there's no link syntax hiding - do nothing
				if (this.isSourceMode(view)) {
					return;
				}

				// When "keep links steady" is disabled, behave like Hide Link Syntax
				// This preserves muscle memory for users who developed it while the setting was enabled
				if (!this.settings.keepLinksSteady) {
					this.hideLinkSyntax(editor, view);
					return;
				}

				const cm6View = (editor as any).cm as EditorView;
				if (!cm6View) {
					return;
				}

				// Check if there's a temporarily visible link
				const currentVisible = cm6View.state.field(temporarilyVisibleLinkField, false);
				
				if (currentVisible) {
					// Link is shown, hide it
					this.hideLinkSyntax(editor, view);
				} else {
					// Link is hidden, show it
					this.showLinkSyntax(editor, view);
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
				const displayedRange = computeDisplayedTextRange(line, cursor.ch);
				
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
					keepLinksSteady: this.settings.keepLinksSteady
				});

				if (skipPos) {
					editor.setCursor(skipPos);
				}
			},
		});

		this.addSettingTab(new SteadyLinksSettingTab(this.app, this));
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

		editor.replaceRange(
			replacement,
			{ line: line, ch: start },
			{ line: line, ch: end }
		);

		const cursorPos = computeCloseCursorPosition({
			linkStart: start,
			linkEnd: start + replacement.length,
			lineLength: editor.getLine(line).length,
			line,
			preferRight: !enteredFromLeft,
			lineCount: editor.lineCount(),
			prevLineLength: line > 0 ? editor.getLine(line - 1).length : 0,
		});

		editor.setCursor(cursorPos);
		return cursorPos;
	}

	/**
	 * Show the link syntax at the current cursor position.
	 * Used by both "Show Link Syntax" and "Toggle Link Syntax" commands.
	 * Only works in live preview mode when "keep links steady" is enabled.
	 */
	private showLinkSyntax(editor: Editor, view: MarkdownView): void {
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
			effects: setTemporarilyVisibleLink.of(linkRange)
		});
	}

	/**
	 * Hide the link syntax at the current cursor position.
	 * Used by both "Hide Link Syntax" and "Toggle Link Syntax" commands.
	 * 
	 * When "keep links steady" is ON: cursor stays on link for easy toggling
	 * When "keep links steady" is OFF: cursor skips off link to prevent re-expansion
	 */
	private hideLinkSyntax(editor: Editor, view: MarkdownView): void {
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
				effects: setTemporarilyVisibleLink.of(null)
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
		if (this.settings.keepLinksSteady) {
			this.syntaxHiderExtensions.push(
				...createLinkSyntaxHiderExtension(),
			);
		}
		this.app.workspace.updateOptions();
	}

	onunload() {
		// No cleanup needed. This plugin's lifecycle is managed by Obsidian:
		// - Editor extensions are cleared when `this.syntaxHiderExtensions` array is emptied
		// - Event listeners in modals are cleaned up automatically when modals close
		// - Command handlers are unregistered by the plugin system
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
