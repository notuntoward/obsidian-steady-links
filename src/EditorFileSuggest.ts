import { App, Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, TFile } from "obsidian";
import { SuggestionItem } from "./types";
import {
	getSuggestionItems,
	renderSuggestionItem,
	getCompletionText,
	flashSuggestContainer,
	generateBlockId,
	addBlockIdToFile
} from "./suggestionLogic";
import type SteadyLinksPlugin from "./main";

export class EditorFileSuggest extends EditorSuggest<SuggestionItem> {
	plugin: SteadyLinksPlugin;

	constructor(app: App, plugin: SteadyLinksPlugin) {
		super(app);
		this.plugin = plugin;

		if (this.scope) {
			// Register TAB key to complete the prefix/basename and not close suggest
			this.scope.register([], "Tab", () => {
				const context = this.context;
				if (!context) return true;

				let selectedId = (this as any).selectedId;
				let values = (this as any).suggestions;
				if (selectedId === undefined) {
					selectedId = (this as any).suggestions?.selectedId;
				}
				if (!Array.isArray(values)) {
					values = (this as any).suggestions?.values;
				}

				if (selectedId === undefined || !values || !values[selectedId]) {
					return true;
				}

				const item = values[selectedId];
				const completionText = getCompletionText(item, context.query);

				if (context.query.trim() === completionText.trim()) {
					flashSuggestContainer();
					return false; // consume event
				} else {
					const editor = context.editor;
					editor.replaceRange(completionText, context.start, context.end);
					editor.setCursor({
						line: context.start.line,
						ch: context.start.ch + completionText.length
					});
					return false; // consume event
				}
			});
		}
	}

	onTrigger(cursor: EditorPosition, editor: Editor, file: TFile): EditorSuggestTriggerInfo | null {
		if (!this.plugin.settings.keepLinksSteady) return null;

		const line = editor.getLine(cursor.line);
		const sub = line.substring(0, cursor.ch);

		// Find the last open "[[" before the cursor on this line
		const openIdx = sub.lastIndexOf("[[");
		if (openIdx === -1) return null;

		// Make sure it's not closed before the cursor
		const closeIdx = sub.indexOf("]]", openIdx);
		if (closeIdx !== -1 && closeIdx < cursor.ch) return null;

		const query = sub.substring(openIdx + 2);

		const result = {
			start: { line: cursor.line, ch: openIdx + 2 },
			end: { line: cursor.line, ch: cursor.ch },
			query: query,
		};
		console.log("[SteadyLinks] EditorFileSuggest onTrigger:", result);
		return result;
	}

	async getSuggestions(context: EditorSuggestContext): Promise<SuggestionItem[]> {
		console.log("[SteadyLinks] EditorFileSuggest getSuggestions query:", context.query);
		const suggestions = await getSuggestionItems(context.query, this.app, true);
		console.log("[SteadyLinks] EditorFileSuggest getSuggestions count:", suggestions.length);
		return suggestions;
	}

	renderSuggestion(item: SuggestionItem, el: HTMLElement): void {
		const query = this.context?.query ?? "";
		renderSuggestionItem(item, el, query, this.app);
	}

	async selectSuggestion(item: SuggestionItem, evt: MouseEvent | KeyboardEvent): Promise<void> {
		const context = this.context;
		if (!context) return;

		let linkValue: string;
		let newLinkText: string | null = null;

		if (item.type === "heading") {
			const currentFile = this.app.workspace.getActiveFile();
			if (item.file && currentFile && item.file.path === currentFile.path) {
				linkValue = `#${item.heading}`;
			} else if (item.file) {
				const fileName = item.file.basename;
				linkValue = `${fileName}#${item.heading}`;
			} else {
				linkValue = `#${item.heading}`;
			}
		} else if (item.type === "block") {
			if (!item.blockId) {
				const newBlockId = generateBlockId();
				if (item.file && item.position) {
					await addBlockIdToFile(item.file, this.app, item.position, newBlockId);
					item.blockId = newBlockId;
				}
			}

			const currentFile = this.app.workspace.getActiveFile();
			if (item.file && currentFile && item.file.path === currentFile.path) {
				linkValue = `#^${item.blockId}`;
			} else if (item.file) {
				const fileName = item.file.basename;
				linkValue = `${fileName}#^${item.blockId}`;
			} else {
				linkValue = `#^${item.blockId}`;
			}
		} else if (item.type === "alias") {
			if (item.file && item.file.extension === "md") {
				linkValue = item.file.basename || "";
			} else if (item.file) {
				linkValue = item.file.name || "";
			} else {
				linkValue = item.alias || "";
			}
			newLinkText = item.alias || "";
		} else {
			if (item.extension === "md") {
				linkValue = item.basename || "";
			} else {
				linkValue = item.name || "";
			}
		}

		const editor = context.editor;
		const startPos = { line: context.start.line, ch: context.start.ch - 2 }; // include the "[["
		
		// If Obsidian auto-paired "]]" immediately after the cursor, consume them so we don't leave duplicates.
		let endCh = context.end.ch;
		const lineText = editor.getLine(context.end.line);
		if (lineText.substring(endCh, endCh + 2) === "]]") {
			endCh += 2;
		}
		const endPos = { line: context.end.line, ch: endCh };

		let insertion: string;
		if (newLinkText !== null) {
			insertion = `[[${linkValue}|${newLinkText}]]`;
		} else {
			insertion = `[[${linkValue}]]`;
		}

		editor.replaceRange(insertion, startPos, endPos);

		if (newLinkText !== null) {
			const selectionStartCh = startPos.ch + 2 + linkValue.length + 1; // startPos.ch + [[ + linkValue + |
			const selectionEndCh = selectionStartCh + newLinkText.length;
			editor.setSelection(
				{ line: startPos.line, ch: selectionStartCh },
				{ line: startPos.line, ch: selectionEndCh }
			);
		} else {
			editor.setCursor({ line: startPos.line, ch: startPos.ch + insertion.length });
		}
	}
}
