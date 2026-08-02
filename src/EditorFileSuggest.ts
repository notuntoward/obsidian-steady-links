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
	private lastSuggestions: SuggestionItem[] = [];

	constructor(app: App, plugin: SteadyLinksPlugin) {
		super(app);
		this.plugin = plugin;

		if (this.scope) {
			this.scope.register(null, "Tab", (evt?: KeyboardEvent) => {
				if (evt) {
					evt.preventDefault();
					evt.stopPropagation();
				}
				const context = this.context;
				if (!context) return true;

				const item = this.getSelectedSuggestionItem();
				if (!item) return true;

				const completionText = getCompletionText(item, context.query);

				if (context.query.trim().toLowerCase() === completionText.trim().toLowerCase()) {
					flashSuggestContainer();
					return false;
				}

				const editor = context.editor;
				editor.replaceRange(completionText, context.start, context.end);
				const newEndCh = context.start.ch + completionText.length;
				const newCursor = { line: context.start.line, ch: newEndCh };
				editor.setCursor(newCursor);

				context.end = newCursor;
				context.query = completionText;

				try {
					if (typeof (this as any).suggestions?.update === "function") {
						(this as any).suggestions.update();
					}
				} catch {
					// ignore
				}

				return false;
			});

		}
	}

	private getSelectedSuggestionItem(): SuggestionItem | undefined {
		let items = this.lastSuggestions;
		if (!items || items.length === 0) {
			let v = (this as any).values || (this as any).suggestions;
			if (!Array.isArray(v)) {
				v = (this as any).suggestions?.values;
			}
			if (Array.isArray(v)) {
				items = v;
			}
		}

		if (!items || items.length === 0) return undefined;

		let selectedId: number | undefined = (this as any).selectedId;
		if (selectedId === undefined) {
			selectedId = (this as any).suggestions?.selectedId;
		}

		if (selectedId === undefined) {
			const containers = document.querySelectorAll(".suggestion-container");
			for (let i = 0; i < containers.length; i++) {
				const container = containers[i] as HTMLElement;
				if (!container.classList.contains("is-hidden") && container.style.display !== "none") {
					const selectedEl = container.querySelector(".suggestion-item.is-selected");
					if (selectedEl) {
						const allItems = Array.from(container.querySelectorAll(".suggestion-item"));
						const idx = allItems.indexOf(selectedEl);
						if (idx !== -1) {
							selectedId = idx;
							break;
						}
					}
				}
			}
		}

		if (selectedId === undefined && items.length > 0) {
			selectedId = 0;
		}

		if (selectedId !== undefined && items[selectedId]) {
			return items[selectedId];
		}

		return undefined;
	}

	onTrigger(cursor: EditorPosition, editor: Editor, file: TFile): EditorSuggestTriggerInfo | null {
		if (!this.plugin.settings.keepLinksSteady) return null;

		const line = editor.getLine(cursor.line);
		const sub = line.substring(0, cursor.ch);

		// Find the last open "[[" before the cursor on this line
		const openIdx = sub.lastIndexOf("[[");
		if (openIdx === -1) return null;

		const closeIdx = line.indexOf("]]", openIdx);
		// If "]]" exists and cursor is at or past the closing "]]", then we are outside the link
		if (closeIdx !== -1 && cursor.ch >= closeIdx + 2) return null;

		const queryEnd = (closeIdx !== -1 && cursor.ch >= closeIdx) ? closeIdx : cursor.ch;
		const query = line.substring(openIdx + 2, queryEnd);

		return {
			start: { line: cursor.line, ch: openIdx + 2 },
			end: { line: cursor.line, ch: queryEnd },
			query: query,
		};
	}

	async getSuggestions(context: EditorSuggestContext): Promise<SuggestionItem[]> {
		const items = await getSuggestionItems(context.query, this.app, true);
		this.lastSuggestions = items;
		return items;
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
			if (item.file && (!currentFile || item.file.path !== currentFile.path)) {
				linkValue = `${item.file.basename}#${item.heading}`;
			} else {
				linkValue = `#${item.heading}`;
			}
		} else if (item.type === "block") {
			if (!item.blockId && item.file && item.position) {
				const newBlockId = generateBlockId();
				await addBlockIdToFile(item.file, this.app, item.position, newBlockId);
				item.blockId = newBlockId;
			}

			const currentFile = this.app.workspace.getActiveFile();
			if (item.file && (!currentFile || item.file.path !== currentFile.path)) {
				linkValue = `${item.file.basename}#^${item.blockId}`;
			} else {
				linkValue = `#^${item.blockId}`;
			}
		} else if (item.type === "alias") {
			linkValue = item.file
				? (item.file.extension === "md" ? (item.file.basename || "") : (item.file.name || ""))
				: (item.alias || "");
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
