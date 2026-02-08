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
			hotkeys: [
				{
					modifiers: ["Ctrl"],
					key: "e"
				}
			],
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
							this.applyLinkEdit(editor, cursor.line, start, end, result, enteredFromLeft);
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
						this.applyLinkEdit(editor, cursor.line, start, end, result, enteredFromLeft);
					},
					false, // shouldSelectText
					null,  // conversionNotice
					false  // isNewLink
				).open();
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
	) {
		let replacement: string;
		const embedPrefix = result.isEmbed ? "!" : "";

		if (result.isWiki) {
			if (result.text === result.destination) {
				replacement = `${embedPrefix}[[${result.destination}]]`;
			} else {
				replacement = `${embedPrefix}[[${result.destination}|${result.text}]]`;
			}
		} else {
			replacement = `${embedPrefix}[${result.text}](${result.destination})`;
		}

		editor.replaceRange(
			replacement,
			{ line: line, ch: start },
			{ line: line, ch: end }
		);

		let newCh: number;
		if (this.settings.alwaysMoveToEnd) {
			newCh = start + replacement.length;
		} else {
			// Move cursor to the outside of the link, to the edge nearest to where
			// the cursor was when the link editor was originally activated
			newCh = enteredFromLeft ? start : start + replacement.length;
		}

		editor.setCursor({ line: line, ch: newCh });
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
