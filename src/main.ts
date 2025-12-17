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
						// Check if this is an embedded link (starts with !)
						const isEmbed = start > 0 && line.charAt(start - 1) === '!';
						if (isEmbed) {
							start--; // Include the ! in the selection
						}
						link = { text: match[1], destination: match[2], isWiki: false, isEmbed: isEmbed };
						enteredFromLeft = cursor.ch <= start + 1;
						break;
					}
				}

				// Wiki
				if (!link) {
					// Find all wikilinks in the line
					const wikiLinkMatches = [];
					let startIndex = 0;
					while (true) {
						const openIndex = line.indexOf('[[', startIndex);
						if (openIndex === -1) break;
						
						const closeIndex = line.indexOf(']]', openIndex);
						if (closeIndex === -1) break;
						
						const fullMatch = line.substring(openIndex, closeIndex + 2);
						const innerContent = line.substring(openIndex + 2, closeIndex);
						const lastPipeIndex = innerContent.lastIndexOf('|');
						
						let destination, text;
						if (lastPipeIndex === -1) {
							destination = innerContent.trim();
							text = destination;
						} else {
							destination = innerContent.substring(0, lastPipeIndex).trim();
							text = innerContent.substring(lastPipeIndex + 1).trim();
						}
						
						wikiLinkMatches.push({
							index: openIndex,
							match: fullMatch,
							groups: [destination, text]
						});
						
						startIndex = closeIndex + 2;
					}
					
					// Check if cursor is within any of the found wikilinks
					for (const wikiMatch of wikiLinkMatches) {
						start = wikiMatch.index;
						end = wikiMatch.index + wikiMatch.match.length;
						if (cursor.ch >= start && cursor.ch <= end) {
							// Check if this is an embedded link (starts with !)
							const isEmbed = start > 0 && line.charAt(start - 1) === '!';
							if (isEmbed) {
								start--; // Include the ! in the selection
							}
							link = {
								destination: wikiMatch.groups[0],
								text: wikiMatch.groups[1],
								isWiki: true,
								isEmbed: isEmbed,
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
							conversionNotice = `URL converted: ${original} → ${normalized}`;
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
							conversionNotice = `URL converted: ${original} → ${normalized}`;
						}
					} else if (selection) {
						linkText = selection;
						if (isClipboardUrl) {
							const original = clipboardText;
							const normalized = normalizeUrl(original);
							linkDest = normalized;
							shouldBeMarkdown = true;
							if (original !== normalized) {
								conversionNotice = `URL converted: ${original} → ${normalized}`;
							}
						} else {
							// Check if clipboard contains a valid link (wiki or markdown)
							const parsedLink = parseClipboardLink(clipboardText);
							if (parsedLink) {
								linkDest = parsedLink.destination;
								shouldBeMarkdown = !parsedLink.isWiki;
								conversionNotice = `Used destination from link in clipboard`;
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
							conversionNotice = `URL converted: ${original} → ${normalized}`;
						}
					} else {
						// Check if clipboard contains a valid link (wiki or markdown)
						const parsedLink = parseClipboardLink(clipboardText);
						if (parsedLink) {
							linkText = parsedLink.text;
							linkDest = parsedLink.destination;
							shouldBeMarkdown = !parsedLink.isWiki;
							conversionNotice = `Used text & destination from link in clipboard`;
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
						isEmbed: false,
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
