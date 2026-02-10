import { Plugin, Editor, MarkdownView } from "obsidian";
import { LinkEditModal } from "./LinkEditModal";
import { LinkEditorSettingTab } from "./SettingTab";
import { PluginSettings, LinkInfo } from "./types";
import { 
	parseClipboardLink,
	detectLinkAtCursor,
	determineLinkFromContext,
	urlAtCursor
} from "./utils";
import { buildLinkText, computeCloseCursorPosition, computeSkipCursorPosition } from "./modalLogic";

const DEFAULT_SETTINGS: PluginSettings = {
	alwaysMoveToEnd: false,
};

export default class LinkEditorPlugin extends Plugin {
	settings!: PluginSettings;

	async onload() {
		await this.loadSettings();

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

					new LinkEditModal(
							this.app,
							link,
							(result: LinkInfo) => {
								const cursorPos = this.applyLinkEdit(editor, cursor.line, start, end, result, enteredFromLeft);
								// Re-assert cursor after modal closes so the link collapses in live preview
								setTimeout(() => editor.setCursor(cursorPos), 0);
							},
						shouldSelectText,
						conversionNotice,
						!isEditingExistingLink
					).open();

					return;
				}

				// At this point, link is guaranteed to be non-null
				// Open modal for editing
				new LinkEditModal(
					this.app,
					link!,
					(result: LinkInfo) => {
						const cursorPos = this.applyLinkEdit(editor, cursor.line, start, end, result, enteredFromLeft);
						// Re-assert cursor after modal closes so the link collapses in live preview
						setTimeout(() => editor.setCursor(cursorPos), 0);
					},
					false, // shouldSelectText
					null,  // conversionNotice
					false  // isNewLink
				).open();
			},
		});

		this.addCommand({
			id: "skip-over-link",
			name: "Skip over link",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				const cursor = editor.getCursor();
				const line = editor.getLine(cursor.line);

				// Try to detect existing link at cursor
				const existingLink = detectLinkAtCursor(line, cursor.ch);

				if (!existingLink) {
					// No link at cursor, do nothing
					return;
				}

				// Compute the skip position
					const skipPos = computeSkipCursorPosition({
						linkStart: existingLink.start,
						linkEnd: existingLink.end,
						cursorPos: cursor.ch,
						lineLength: line.length,
						line: cursor.line,
						lineCount: editor.lineCount(),
						prevLineLength: cursor.line > 0 ? editor.getLine(cursor.line - 1).length : 0,
					});

				// Move cursor to skip position
				editor.setCursor(skipPos);
			},
		});

		this.addSettingTab(new LinkEditorSettingTab(this.app, this));
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
			preferRight: this.settings.alwaysMoveToEnd || !enteredFromLeft,
			lineCount: editor.lineCount(),
			prevLineLength: line > 0 ? editor.getLine(line - 1).length : 0,
		});

		editor.setCursor(cursorPos);
		return cursorPos;
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
