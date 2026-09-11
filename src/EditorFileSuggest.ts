import { App, Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, TFile } from "obsidian";
import { SuggestionItem } from "./types";
import {
	getSuggestionItems,
	renderSuggestionItem,
	getCompletionText,
	flashSuggestContainer,
	getSelectedSuggestionItem,
	computeSelectedLinkValue
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

				const item = getSelectedSuggestionItem(this, this.lastSuggestions);
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

		const { linkValue, newLinkText } = await computeSelectedLinkValue(item, this.app, false);

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
