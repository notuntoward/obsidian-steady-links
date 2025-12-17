import { Plugin, Editor, MarkdownView } from "obsidian";
import { LinkEditModal } from "./LinkEditModal";
import { LinkEditorSettingTab } from "./SettingTab";
import { PluginSettings, LinkInfo } from "./types";
import { parseClipboardLink } from "./utils";

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

				const mdRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
				const wikiRegex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

				let match: RegExpExecArray | null;
				let link: LinkInfo | null = null;
				let start = 0;
				let end = 0;
				let enteredFromLeft = true;

				// Markdown
				while ((match = mdRegex.exec(line)) !== null) {
					start = match.index;
					end = match.index + match[0].length;
					if (cursor.ch >= start && cursor.ch <= end) {
						link = { text: match[1], destination: match[2], isWiki: false };
						enteredFromLeft = cursor.ch <= start + 1;
						break;
					}
				}

				// Wiki
				if (!link) {
					while ((match = wikiRegex.exec(line)) !== null) {
						start = match.index;
						end = match.index + match[0].length;
						if (cursor.ch >= start && cursor.ch <= end) {
							link = {
								destination: match[1],
								text: match[2] ?? match[1],
								isWiki: true,
							};
							enteredFromLeft = cursor.ch <= start + 2;
							break;
						}
					}
				}

				// New link
				let shouldSelectText = false;
				let conversionNotice: string | null = null;

				if (!link) {
					const selection = editor.getSelection();
					let clipboardText = "";

					try {
						clipboardText = await navigator.clipboard.readText();
						clipboardText = clipboardText.trim();
					} catch (e) {
						// Clipboard access may fail
					}

					const isUrl = (str: string): boolean => {
						if (!str) return false;
						const trimmed = str.trim();
						return /^https?:\/\/\S+$|^www\.\S+$/i.test(trimmed);
					};

					const normalizeUrl = (str: string): string => {
						if (!str) return str;
						const trimmed = str.trim();
						if (/^https?:\/\//i.test(trimmed)) return trimmed;
						if (/^www\./i.test(trimmed)) return "https://" + trimmed;
						return trimmed;
					};

					// Check for URL at cursor position
					const urlAtCursor = (text: string, pos: number): string | null => {
						const urlRegex = /https?:\/\/[^\s]+|www\.[^\s]+/gi;
						let match;
						while ((match = urlRegex.exec(text)) !== null) {
							if (pos >= match.index && pos <= match.index + match[0].length) {
								return match[0];
							}
						}
						return null;
					};

					const isSelectionUrl = isUrl(selection);
					const isClipboardUrl = isUrl(clipboardText);
					const cursorUrl = urlAtCursor(line, cursor.ch);

					let linkText = "";
					let linkDest = "";
					let shouldBeMarkdown = false;

					// If cursor is on a URL but not within a link, use that URL
					if (cursorUrl && !isSelectionUrl) {
						const original = cursorUrl.trim();
						const normalized = normalizeUrl(original);
						linkText = original;
						linkDest = normalized;
						shouldBeMarkdown = true;
						shouldSelectText = true;
						if (original !== normalized) {
							conversionNotice = `✓ URL converted: ${original} → ${normalized}`;
						}
						// Find the URL boundaries to set start/end
						const urlStart = line.indexOf(cursorUrl);
						const urlEnd = urlStart + cursorUrl.length;
						start = urlStart;
						end = urlEnd;
					} else if (isSelectionUrl) {
						const original = selection.trim();
						const normalized = normalizeUrl(original);
						linkText = original;
						linkDest = normalized;
						shouldBeMarkdown = true;
						shouldSelectText = true;
						if (original !== normalized) {
							conversionNotice = `✓ URL converted: ${original} → ${normalized}`;
						}
					} else if (selection) {
						linkText = selection;
						if (isClipboardUrl) {
							const original = clipboardText;
							const normalized = normalizeUrl(original);
							linkDest = normalized;
							shouldBeMarkdown = true;
							if (original !== normalized) {
								conversionNotice = `✓ URL converted: ${original} → ${normalized}`;
							}
						} else {
							// Check if clipboard contains a valid link (wiki or markdown)
							const parsedLink = parseClipboardLink(clipboardText);
							if (parsedLink) {
								linkDest = parsedLink.destination;
								shouldBeMarkdown = !parsedLink.isWiki;
								conversionNotice = `✓ Used destination from link in clipboard`;
							} else {
								linkDest = clipboardText;
								shouldBeMarkdown = false;
							}
						}
					} else if (isClipboardUrl) {
						const original = clipboardText;
						const normalized = normalizeUrl(original);
						linkText = normalized;
						linkDest = normalized;
						shouldSelectText = true;
						shouldBeMarkdown = true;
						if (original !== normalized) {
							conversionNotice = `✓ URL converted: ${original} → ${normalized}`;
						}
					} else {
						// Check if clipboard contains a valid link (wiki or markdown)
						const parsedLink = parseClipboardLink(clipboardText);
						if (parsedLink) {
							linkText = parsedLink.text;
							linkDest = parsedLink.destination;
							shouldBeMarkdown = !parsedLink.isWiki;
							conversionNotice = `✓ Used text & destination from link in clipboard`;
						} else {
							linkText = "";
							linkDest = clipboardText;
							shouldBeMarkdown = false;
						}
					}

					link = {
						text: linkText,
						destination: linkDest,
						isWiki: !shouldBeMarkdown,
					};

					if (editor.somethingSelected()) {
						const selStart = editor.getCursor("from");
						const selEnd = editor.getCursor("to");
						start = selStart.ch;
						end = selEnd.ch;
					} else if (!cursorUrl) {
						start = cursor.ch;
						end = cursor.ch;
					}
				}

				new LinkEditModal(
					this.app,
					link,
					(result: LinkInfo) => {
						let replacement: string;
						if (result.isWiki) {
							if (result.text === result.destination) {
								replacement = `[[${result.destination}]]`;
							} else {
								replacement = `[[${result.destination}|${result.text}]]`;
							}
						} else {
							replacement = `[${result.text}](${result.destination})`;
						}

						editor.replaceRange(
							replacement,
							{ line: cursor.line, ch: start },
							{ line: cursor.line, ch: end }
						);

						let newCh: number;
						if (this.settings.alwaysMoveToEnd) {
							newCh = start + replacement.length;
						} else {
							newCh = enteredFromLeft ? start + replacement.length : start;
						}

						editor.setCursor({ line: cursor.line, ch: newCh });
					},
					shouldSelectText,
					conversionNotice
				).open();
			},
		});

		this.addSettingTab(new LinkEditorSettingTab(this.app, this));
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
