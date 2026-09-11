import { App, Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, TFile } from "obsidian";
import { SuggestionItem } from "./types";
import {
	getSuggestionItems,
	renderSuggestionItem,
	getCompletionText,
	resolveCompletion,
	flashSuggestContainer,
	getSelectedSuggestionItem,
	computeSelectedLinkValue
} from "./suggestionLogic";
import { parseSuggestionQuery } from "./suggestionQuery";
import type SteadyLinksPlugin from "./main";

/**
 * Tag our own completion edits with the same `userEvent` genuine keyboard
 * typing carries in CodeMirror (`"input.type"`), rather than a bespoke tag
 * like `"input.autocomplete"`. This plugin's own `linkSyntaxHider.ts` CM6
 * transaction filters branch on `isUserEvent("input.type")` specifically
 * (e.g. `pasteDuplicateSyntaxFix` explicitly skips real typing via that
 * exact check) as distinct from the broader `isUserEvent("input")` family —
 * a custom tag like `"input.autocomplete"` matches the broad check but not
 * the narrow one, routing our edit through different logic than genuine
 * typing would hit. Passing `"input.type"` keeps our edit indistinguishable
 * from real typing for every one of those filters. This plugin does not
 * rely on this tag alone to keep the suggest popup open — see
 * {@link retriggerSuggest} for the actual re-trigger mechanism.
 */
const AUTOCOMPLETE_USER_EVENT = "input.type";

/**
 * Set to `true` and reload the plugin to trace Tab/`#`/`^` completion and
 * suggest open/close/trigger activity in the developer console while
 * diagnosing `[[` suggest issues. Must stay `false` for normal use — the
 * Obsidian community plugin review guidelines require plugins not to log to
 * the console during normal operation.
 */
const EDITOR_SUGGEST_DEBUG = false;

function debugLog(label: string, details?: Record<string, unknown>): void {
	if (!EDITOR_SUGGEST_DEBUG || typeof console === "undefined") return;
	console.log(`[SteadyLinks EditorFileSuggest] ${label}`, details ?? {});
}

export class EditorFileSuggest extends EditorSuggest<SuggestionItem> {
	plugin: SteadyLinksPlugin;
	private lastSuggestions: SuggestionItem[] = [];

	constructor(app: App, plugin: SteadyLinksPlugin) {
		super(app);
		this.plugin = plugin;

		if (this.scope) {
			// Tab: complete the highlighted suggestion in place and keep the
			// popup open, mirroring stock Obsidian's `[[` suggest exactly.
			this.scope.register(null, "Tab", (evt?: KeyboardEvent) => {
				if (evt?.isComposing) return true;
				debugLog("Tab pressed", { query: this.context?.query });
				return this.consumeIfHandled(evt, () => this.completeSelection());
			});

			// "#": like stock, completing the current file selection and
			// switching into heading-search mode — but only while the query
			// is a non-empty, plain file search (not already a heading/block/
			// alias query, and not an untouched empty query — pressing "#"
			// before typing any file name should search headings of the
			// *current* file, not silently pick whatever happens to be first
			// in the unfiltered file list), matching stock's
			// `suggestManager.mode === "file"` gate.
			this.scope.register(null, "#", (evt?: KeyboardEvent) => {
				const gate = this.hasTypedPlainFileQuery();
				debugLog("'#' keydown", {
					isComposing: evt?.isComposing,
					hasContext: !!this.context,
					query: this.context?.query,
					parsedType: this.context ? parseSuggestionQuery(this.context.query).type : undefined,
					gate,
				});
				if (evt?.isComposing) return true;
				if (!gate) return true;
				return this.consumeIfHandled(evt, () => this.completeSelection("#"));
			});

			// "^": same as "#", but switches into block-reference mode.
			this.scope.register(null, "^", (evt?: KeyboardEvent) => {
				const gate = this.hasTypedPlainFileQuery();
				debugLog("'^' keydown", {
					isComposing: evt?.isComposing,
					hasContext: !!this.context,
					query: this.context?.query,
					parsedType: this.context ? parseSuggestionQuery(this.context.query).type : undefined,
					gate,
				});
				if (evt?.isComposing) return true;
				if (!gate) return true;
				return this.consumeIfHandled(evt, () => this.completeSelection("^"));
			});

			// Shift+Enter: create a link to the literally-typed query text,
			// even if it doesn't match any existing file/heading/block — the
			// same "create an unresolved link" escape hatch stock Obsidian
			// offers via its own Shift+Enter handler.
			this.scope.register(["Shift"], "Enter", (evt?: KeyboardEvent) => {
				if (evt?.isComposing) return true;
				return this.consumeIfHandled(evt, () => this.createUnresolvedLink());
			});
		}
	}

	/**
	 * Diagnostic-only override: log whenever Obsidian (or this plugin) closes
	 * this suggest's popup, so it's possible to tell from the console whether
	 * a close was caused by this plugin's own code or by Obsidian itself
	 * (e.g. because no registered suggest's `onTrigger` matched anymore).
	 */
	close(): void {
		debugLog("close() called", { contextBefore: this.context ? { ...this.context, editor: undefined } : null });
		super.close();
	}

	/**
	 * Run `action` and only suppress the key's default behavior
	 * (`preventDefault`/`stopPropagation`) when it actually did something.
	 * This must run `action` *before* deciding whether to prevent default:
	 * doing it the other way around (prevent default unconditionally, then
	 * find out `action` had nothing to complete) would silently swallow the
	 * keystroke — e.g. pressing `#`/`^` while no suggestion is highlighted
	 * would eat the character instead of typing it.
	 */
	private consumeIfHandled(evt: KeyboardEvent | undefined, action: () => boolean): boolean {
		const handled = action();
		debugLog("consumeIfHandled result", { handled });
		if (!handled) return true;
		if (evt) {
			evt.preventDefault();
			evt.stopPropagation();
		}
		return false;
	}

	/**
	 * True when the user has actually typed a non-empty, plain file search
	 * (no heading/block/alias syntax yet). Used to gate the `#`/`^`
	 * mode-switch keys exactly like stock Obsidian's `suggestManager.mode`,
	 * plus an explicit non-empty check: pressing `#`/`^` before typing
	 * anything after `[[` must not silently complete-select whatever happens
	 * to be first in the unfiltered file list — it should just type the
	 * character normally (which then searches headings/blocks in the
	 * *current* file, via `parseSuggestionQuery`'s own `#`/`^`-prefix
	 * handling in {@link getSuggestionItems}).
	 */
	private hasTypedPlainFileQuery(): boolean {
		const context = this.context;
		if (!context) return false;
		if (context.query.trim() === "") return false;
		return parseSuggestionQuery(context.query).type === "file";
	}

	/**
	 * Complete the currently highlighted suggestion into the document in
	 * place, optionally appending a mode-switch character (`#` or `^`), while
	 * leaving the suggest popup open for continued typing. Returns false when
	 * there is nothing to complete (no context or no highlighted item), so
	 * callers can let the key press fall through to its default behavior.
	 */
	private completeSelection(appendChar?: string): boolean {
		const context = this.context;
		if (!context) return false;

		const item = getSelectedSuggestionItem(this, this.lastSuggestions);
		if (!item) {
			debugLog("completeSelection: no highlighted item, nothing to do", {
				query: context.query,
				lastSuggestionsCount: this.lastSuggestions.length,
			});
			return false;
		}

		let completionText: string;
		if (appendChar) {
			completionText = getCompletionText(item, context.query) + appendChar;
		} else {
			const resolved = resolveCompletion(item, context.query);
			if (resolved.alreadyComplete) {
				debugLog("completeSelection: already complete, flashing", { query: context.query });
				flashSuggestContainer();
				return true;
			}
			completionText = resolved.completionText;
		}

		const editor = context.editor;
		const file = context.file;
		const newEndCh = context.start.ch + completionText.length;
		const newCursor = { line: context.start.line, ch: newEndCh };

		// Apply the text change and move the cursor as a single atomic
		// transaction — exactly like stock Obsidian's own `[[` suggest,
		// whose Tab/`#`/`^` completions use
		// `editor.transaction({changes, selection}, "input.autocomplete")`
		// for precisely this reason. A separate, later `editor.setCursor()`
		// call is a pure selection-only dispatch that this plugin's own
		// link-syntax-hiding cursor corrector does NOT skip the way it skips
		// doc-changing edits (see linkSyntaxHider.ts's `!update.docChanged`
		// guards): the corrector treats a lone selection dispatch landing on
		// the newly-hidden trailing "]]" boundary as arrow-key-style
		// navigation and "corrects" it forward, past the boundary — which is
		// exactly what was pushing the cursor outside the link and closing
		// the popup. Setting the selection as part of the SAME doc-changing
		// transaction keeps it under that same docChanged guard.
		editor.transaction(
			{
				changes: [{ from: context.start, to: context.end, text: completionText }],
				selection: { from: newCursor },
			},
			AUTOCOMPLETE_USER_EVENT
		);

		context.end = newCursor;
		context.query = completionText;

		debugLog("completeSelection: applied", { completionText, newCursor });
		this.retriggerSuggest(editor, file);

		return true;
	}

	/**
	 * Force this suggest's own `onTrigger`/`getSuggestions`/popup-render
	 * cycle to run again immediately, rather than relying on Obsidian's
	 * editor update listener to notice our edit on its own (debounced)
	 * schedule and decide, via undocumented heuristics, whether to reopen
	 * the popup. `trigger` is not declared in the public `obsidian.d.ts`,
	 * but it is the exact method the base `EditorSuggest` class this plugin
	 * extends uses internally to drive every `onTrigger` call — calling it
	 * directly on `this`, synchronously, right after our own edit, is the
	 * most direct and reliable way to keep the popup open and refreshed for
	 * Tab/`#`/`^` completions, without guessing at editor-internal timing.
	 */
	private retriggerSuggest(editor: Editor, file: TFile): void {
		const trigger = (
			this as unknown as {
				trigger?: (editor: Editor, file: TFile | null, forceShow: boolean) => boolean;
			}
		).trigger;

		if (typeof trigger !== "function") {
			debugLog("retriggerSuggest: this.trigger is not a function (unexpected)");
			return;
		}

		// Log the exact cursor state trigger()'s own internal
		// "is the selection collapsed?" check will see, since that check
		// runs (and can silently bail out) before our onTrigger is ever
		// called.
		const from = editor.getCursor("from");
		const to = editor.getCursor("to");
		debugLog("retriggerSuggest: about to call this.trigger(editor, file, true)", { from, to });

		const didTrigger = trigger.call(this, editor, file, true);
		debugLog("retriggerSuggest: called this.trigger(editor, file, true)", {
			didTrigger,
			contextAfter: this.context ? { ...this.context, editor: undefined } : null,
			isOpenAfter: (this as unknown as { isOpen?: boolean }).isOpen,
		});
	}

	/**
	 * Insert `[[<query>]]` verbatim (Shift+Enter's "create unresolved link"
	 * escape hatch) and place the cursor after the closing `]]`, exactly like
	 * {@link selectSuggestion} does for a normal selection — which is also
	 * what naturally lets the popup close itself via the standard
	 * `onTrigger` re-check rather than this plugin closing it directly.
	 * Returns false (a no-op) for an empty query, since there is nothing
	 * meaningful to link to yet.
	 */
	private createUnresolvedLink(): boolean {
		const context = this.context;
		if (!context) return false;
		if (context.query.trim() === "") return false;

		this.buildFullLinkReplacement(context, context.query, (startPos, insertion) => ({
			from: { line: startPos.line, ch: startPos.ch + insertion.length },
		}));

		return true;
	}

	/**
	 * Compute and atomically apply the start/end positions, replacement
	 * text, and resulting selection for inserting a complete `[[<inner>]]`
	 * wikilink across the suggest's current `[[` + query span, consuming any
	 * auto-paired trailing "]]" so it isn't duplicated. Shared by
	 * {@link selectSuggestion} (a resolved file/heading/block/alias) and
	 * {@link createUnresolvedLink} (Shift+Enter's literal, unresolved link)
	 * — the only two places that insert a *complete* link, as opposed to
	 * {@link completeSelection}'s in-progress completion.
	 *
	 * The change and the resulting selection are applied via a single
	 * `editor.transaction(...)` call (rather than a change followed by a
	 * separate `setCursor`/`setSelection`) for the same reason described in
	 * {@link completeSelection}: keeping the selection update inside the
	 * same doc-changing transaction keeps it under this plugin's own
	 * cursor-corrector's `!docChanged` guard.
	 */
	private buildFullLinkReplacement(
		context: EditorSuggestContext,
		inner: string,
		computeSelection: (
			startPos: EditorPosition,
			insertion: string
		) => { from: EditorPosition; to?: EditorPosition }
	): void {
		const editor = context.editor;
		const startPos = { line: context.start.line, ch: context.start.ch - 2 }; // include the "[["
		const endPos = this.resolveEndConsumingAutoPairedClose(context.end, editor);
		const insertion = `[[${inner}]]`;
		const selection = computeSelection(startPos, insertion);

		editor.transaction({
			changes: [{ from: startPos, to: endPos, text: insertion }],
			selection,
		});
	}

	/**
	 * If Obsidian auto-paired a "]]" immediately after `end`, extend `end` to
	 * cover it so a full-link replacement doesn't leave a duplicate "]]"
	 * behind. Used by {@link buildFullLinkReplacement}.
	 */
	private resolveEndConsumingAutoPairedClose(end: EditorPosition, editor: Editor): EditorPosition {
		let endCh = end.ch;
		const lineText = editor.getLine(end.line);
		if (lineText.substring(endCh, endCh + 2) === "]]") {
			endCh += 2;
		}
		return { line: end.line, ch: endCh };
	}

	onTrigger(cursor: EditorPosition, editor: Editor, file: TFile): EditorSuggestTriggerInfo | null {
		debugLog("onTrigger called", { cursor, keepLinksSteady: this.plugin.settings.keepLinksSteady });

		if (!this.plugin.settings.keepLinksSteady) {
			debugLog("onTrigger: bail (keepLinksSteady is off)");
			return null;
		}

		const line = editor.getLine(cursor.line);
		const sub = line.substring(0, cursor.ch);

		// Find the last open "[[" before the cursor on this line
		const openIdx = sub.lastIndexOf("[[");
		if (openIdx === -1) {
			debugLog("onTrigger: bail (no '[[' before cursor)", { line, cursorCh: cursor.ch });
			return null;
		}

		const closeIdx = line.indexOf("]]", openIdx);
		// If "]]" exists and cursor is at or past the closing "]]", then we are outside the link
		if (closeIdx !== -1 && cursor.ch >= closeIdx + 2) {
			debugLog("onTrigger: bail (cursor is at/past the closing ']]')", {
				line,
				cursorCh: cursor.ch,
				closeIdx,
			});
			return null;
		}

		const queryEnd = (closeIdx !== -1 && cursor.ch >= closeIdx) ? closeIdx : cursor.ch;
		const query = line.substring(openIdx + 2, queryEnd);

		debugLog("onTrigger matched", {
			line,
			cursorCh: cursor.ch,
			startCh: openIdx + 2,
			endCh: queryEnd,
			query,
		});

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
		const inner = newLinkText !== null ? `${linkValue}|${newLinkText}` : linkValue;

		this.buildFullLinkReplacement(context, inner, (startPos, insertion) => {
			if (newLinkText !== null) {
				const selectionStartCh = startPos.ch + 2 + linkValue.length + 1; // startPos.ch + [[ + linkValue + |
				const selectionEndCh = selectionStartCh + newLinkText.length;
				return {
					from: { line: startPos.line, ch: selectionStartCh },
					to: { line: startPos.line, ch: selectionEndCh },
				};
			}
			return { from: { line: startPos.line, ch: startPos.ch + insertion.length } };
		});
	}
}
