/**
 * CM6 extension that prevents links from visually expanding when the cursor
 * enters them.
 *
 * Strategy:
 *   - A **ViewPlugin** replaces hidden syntax ranges with zero-width widgets
 *     so the syntax is not rendered as text nodes (prevents zero-metric
 *     cursor positions).
 *   - An **updateListener** corrects the cursor position synchronously when
 *     it lands inside a hidden region, giving one-keypress skip.
 *   - A **transactionFilter** protects hidden ranges from user-initiated
 *     edits while allowing programmatic changes (Edit Link command).
 */

import {
	EditorView,
	Decoration,
	DecorationSet,
	ViewPlugin,
	ViewUpdate,
	PluginValue,
	WidgetType,
	keymap,
} from "@codemirror/view";
import {
	RangeSetBuilder,
	EditorState,
	EditorSelection,
	Prec,
	StateEffect,
	StateField,
	Transaction,
} from "@codemirror/state";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HiddenRange {
	from: number;
	to: number;
	side: "leading" | "trailing";
}

interface LinkRange {
	from: number;
	to: number;
}

interface LinkSpan extends LinkRange {
	textFrom: number;
	textTo: number;
}

interface VisibleLinkSpan extends LinkSpan {
	leading: HiddenRange;
	trailing: HiddenRange;
	lineFrom: number;
	lineTo: number;
}

interface ChangeSpec {
	from: number;
	to: number;
	insert: string;
}

function findPreviousWordBoundary(text: string, from: number, to: number): number {
	let pos = Math.max(from, Math.min(to, text.length));

	while (pos > from && /[\s\p{P}]/u.test(text.charAt(pos - 1))) {
		pos -= 1;
	}

	while (pos > from && /[^\s\p{P}]/u.test(text.charAt(pos - 1))) {
		pos -= 1;
	}

	return pos;
}

function findNextWordBoundary(text: string, from: number, to: number): number {
	let pos = Math.max(from, Math.min(to, 0));

	while (pos < text.length && pos < to && /[^\s\p{P}]/u.test(text.charAt(pos))) {
		pos += 1;
	}

	while (pos < text.length && pos < to && /[\s\p{P}]/u.test(text.charAt(pos))) {
		pos += 1;
	}

	return pos;
}

const setSyntaxHiderEnabled = StateEffect.define<boolean>();

// StateEffect attached to delete-redirect transactions (from deleteAtLinkEndFix
// / deleteAtLinkStartFix) so that a follow-up listener can re-position the
// cursor away from the [[ boundary, suppressing Obsidian's link suggest popup.
// The value is the cursor position to move to after the delete.
const suppressSuggestAfterDelete = StateEffect.define<number>();
const rewrittenSelectionDelete = StateEffect.define<null>();
const setSuppressNextBoundaryInput = StateEffect.define<number | null>();

// Marks a rewritten follow-up text insertion so the suppress-next-input filter
// does not recursively rewrite its own transaction.
const suppressSuggestAfterVisibleDelete = StateEffect.define<null>();

// Tracks whether the cursor most recently arrived at a link's textFrom
// (visible text start) from OUTSIDE the link (i.e. from a position past
// the link's trailing end).  This distinguishes a Home-key correction
// (outside → textFrom) from a genuine left-arrow press (textFrom ← inside).
// When Obsidian then normalises textFrom → leading.from with no userEvent,
// we use this field to suppress the left-bounce to leading.from - 1.
const arrivedAtTextFromFromOutsideEffect = StateEffect.define<boolean>();
const arrivedAtTextFromFromOutsideField = StateField.define<boolean>({
	create() {
		return false;
	},
	update(value, tr) {
		for (const e of tr.effects) {
			if (e.is(arrivedAtTextFromFromOutsideEffect)) return e.value;
		}
		// Clear on any selection change that doesn't set the effect
		if (tr.selection) return false;
		return value;
	},
});

// State effect to temporarily show a specific link's syntax
const setTemporarilyVisibleLink = StateEffect.define<LinkRange | null>();

const temporarilyVisibleLinkField = StateField.define<LinkRange | null>({
	create() {
		return null;
	},
	update(value, tr) {
		for (const effect of tr.effects) {
			if (effect.is(setTemporarilyVisibleLink)) {
				return effect.value;
			}
		}
		// Clear if cursor moves away from the temporarily visible link
		if (tr.selection && value) {
			const oldSel = tr.startState.selection.main;
			const newSel = tr.state.selection.main;

			// If cursor moved, check if it's still within the link
			if (oldSel.head !== newSel.head) {
				// Clear if cursor is no longer within the temporarily visible link range
				if (newSel.head < value.from || newSel.head > value.to) {
					return null;
				}
			}
		}
		return value;
	},
});

const syntaxHiderEnabledField = StateField.define<boolean>({
	create() {
		return false;
	},
	update(value, tr) {
		for (const effect of tr.effects) {
			if (effect.is(setSyntaxHiderEnabled)) {
				value = effect.value;
			}
		}
		return value;
	},
});

const suppressNextBoundaryInputField = StateField.define<number | null>({
	create() {
		return null;
	},
	update(value, tr) {
		for (const effect of tr.effects) {
			if (effect.is(setSuppressNextBoundaryInput)) {
				return effect.value;
			}
		}

		if (tr.docChanged) {
			return null;
		}

		if (tr.selection && value !== null) {
			const main = tr.state.selection.main;
			if (!main.empty || main.head !== value) {
				return null;
			}
		}

		return value;
	},
});

function isLivePreview(view: EditorView): boolean {
	const sourceView = view.dom.closest(".markdown-source-view");
	if (!sourceView) return false;
	if (sourceView.classList.contains("is-source-mode")) return false;
	if (sourceView.classList.contains("is-live-preview")) return true;
	const dataMode = sourceView.getAttribute("data-mode");
	if (dataMode === "source") return false;
	if (dataMode === "live" || dataMode === "preview") return true;
	const mode = getModeForView(view);
	if (mode === "source") return false;
	if (mode === "live" || mode === "preview") return true;
	return true;
}

function getModeForView(view: EditorView): "source" | "preview" | "live" | null {
	const app = (window as any).app;
	if (!app?.workspace?.getLeavesOfType) return null;
	const leaves = app.workspace.getLeavesOfType("markdown");
	for (const leaf of leaves) {
		const markdownView = leaf?.view as any;
		const contentEl: HTMLElement | undefined =
			markdownView?.contentEl ?? markdownView?.containerEl;
		if (!contentEl) continue;
		if (!contentEl.contains(view.dom)) continue;
		const mode = markdownView?.getMode?.();
		if (mode === "source" || mode === "preview" || mode === "live") {
			return mode;
		}
	}
	return null;
}

// ---------------------------------------------------------------------------
// Decorations
// ---------------------------------------------------------------------------

function createHiddenSyntaxAnchor(): HTMLSpanElement {
	const span = document.createElement("span");
	span.className = "le-hidden-syntax-anchor";
	span.setAttribute("aria-hidden", "true");
	span.setAttribute("data-steady-links-anchor", "hidden-syntax");

	// Keep a measurable inline box for custom-cursor plugins such as
	// Visible Cursor. A fully 0×0 replacement widget can cause external cursor
	// overlays to disappear when the caret lands on a link boundary because
	// there is no usable DOM rect to anchor to. The negative margin keeps the
	// anchor layout-neutral while still leaving a 1px caret target.
	span.style.display = "inline-block";
	span.style.width = "1px";
	span.style.minWidth = "1px";
	// Keep the anchor's own box tied to the text metrics instead of the full
	// line box, otherwise the inline widget can sit too high on the baseline and
	// lift block-cursor overlays. Use baseline-preserving metrics here and let
	// the inline-block alignment below position the measurable box correctly.
	span.style.height = "1em";
	span.style.lineHeight = "1";
	span.style.marginRight = "-1px";
	span.style.overflow = "hidden";
	span.style.opacity = "0";
	// Keep hit-testing enabled so vertical cursor motion can still resolve a
	// target at line start when hidden link syntax is represented by this anchor.
	// With pointer-events disabled, moving down from a blank line onto a line
	// that starts with hidden link syntax can fail because there is no hittable
	// geometry at the goal column.
	span.style.pointerEvents = "auto";
	// Extend the measurable box downward to cover descender space at end-of-line
	// caret positions without increasing the line's layout height.
	span.style.verticalAlign = "-0.2em";

	return span;
}

class HiddenSyntaxWidget extends WidgetType {
	toDOM(): HTMLElement {
		return createHiddenSyntaxAnchor();
	}

	ignoreEvent(): boolean {
		return false;
	}
}

const hiddenSyntaxReplace = Decoration.replace({
	widget: new HiddenSyntaxWidget(),
});

// ---------------------------------------------------------------------------
// Link detection (raw line text)
// ---------------------------------------------------------------------------

function findMarkdownLinkSyntaxRanges(lineText: string, lineFrom: number): HiddenRange[] {
	const ranges: HiddenRange[] = [];
	const re = /(!?\[)([^\]]*)\]\(([^)]+)\)/g;
	let m: RegExpExecArray | null;

	while ((m = re.exec(lineText)) !== null) {
		const fullStart = lineFrom + m.index;
		const prefixLen = m[1].length;
		const textLen = m[2].length;
		const textStart = fullStart + prefixLen;
		const textEnd = textStart + textLen;
		const fullEnd = fullStart + m[0].length;

		if (fullStart < textStart) ranges.push({ from: fullStart, to: textStart, side: "leading" });
		if (textEnd < fullEnd) ranges.push({ from: textEnd, to: fullEnd, side: "trailing" });
	}
	return ranges;
}

function findWikiLinkSyntaxRanges(lineText: string, lineFrom: number): HiddenRange[] {
	const ranges: HiddenRange[] = [];
	let searchIdx = 0;

	while (searchIdx < lineText.length) {
		const openIdx = lineText.indexOf("[[", searchIdx);
		if (openIdx === -1) break;
		const closeIdx = lineText.indexOf("]]", openIdx + 2);
		if (closeIdx === -1) break;

		const hasEmbed = openIdx > 0 && lineText[openIdx - 1] === "!";
		const rangeStart = lineFrom + (hasEmbed ? openIdx - 1 : openIdx);
		const innerStart = openIdx + 2;
		const innerContent = lineText.substring(innerStart, closeIdx);
		const pipeIdx = innerContent.lastIndexOf("|");
		const fullEnd = lineFrom + closeIdx + 2;

		// Skip empty wiki links (e.g., `[[]]`) so Obsidian's native
		// link autocomplete can work when typing `[['
		if (innerContent === "" || innerContent.trim() === "") {
			searchIdx = closeIdx + 2;
			continue;
		}

		if (pipeIdx !== -1) {
			const textStart = lineFrom + innerStart + pipeIdx + 1;
			const textEnd = lineFrom + closeIdx;
			ranges.push({ from: rangeStart, to: textStart, side: "leading" });
			ranges.push({ from: textEnd, to: fullEnd, side: "trailing" });
		} else {
			const textStart = lineFrom + innerStart;
			const textEnd = lineFrom + closeIdx;
			ranges.push({ from: rangeStart, to: textStart, side: "leading" });
			ranges.push({ from: textEnd, to: fullEnd, side: "trailing" });
		}
		searchIdx = closeIdx + 2;
	}
	return ranges;
}

function computeHiddenRanges(state: EditorState): HiddenRange[] {
	const ranges: HiddenRange[] = [];
	const seenLines = new Set<number>();

	for (const sel of state.selection.ranges) {
		const from = Math.min(sel.head, sel.anchor);
		const to = Math.max(sel.head, sel.anchor);
		const fromLine = state.doc.lineAt(from).number;
		const toLine = state.doc.lineAt(to).number;
		for (let lineNo = fromLine; lineNo <= toLine; lineNo += 1) {
			seenLines.add(lineNo);
		}
	}

	const temporarilyVisible = state.field(temporarilyVisibleLinkField, false);

	for (const lineNo of seenLines) {
		const line = state.doc.line(lineNo);
		const lineRanges = [
			...findMarkdownLinkSyntaxRanges(line.text, line.from),
			...findWikiLinkSyntaxRanges(line.text, line.from),
		];

		// Filter out ranges that belong to the temporarily visible link
		for (const range of lineRanges) {
			if (temporarilyVisible) {
				// Skip this range if it's part of the temporarily visible link
				if (range.from >= temporarilyVisible.from && range.to <= temporarilyVisible.to) {
					continue;
				}
			}
			ranges.push(range);
		}
	}

	ranges.sort((a, b) => a.from - b.from || a.to - b.to);
	return ranges;
}

// ---------------------------------------------------------------------------
// StateField
// ---------------------------------------------------------------------------

const hiddenRangesField = StateField.define<HiddenRange[]>({
	create(state) {
		return computeHiddenRanges(state);
	},
	update(prev, tr) {
		// Recompute if doc changed, selection changed, or temporarily visible link changed
		const tempVisibleChanged = tr.effects.some((e) => e.is(setTemporarilyVisibleLink));
		if (tr.docChanged || tr.selection || tempVisibleChanged) {
			return computeHiddenRanges(tr.state);
		}
		return prev;
	},
});

// ---------------------------------------------------------------------------
// Body class manager
// ---------------------------------------------------------------------------

const BODY_CLASS = "le-keep-links-steady";

class BodyClassPlugin implements PluginValue {
	private enabled = false;

	constructor(private view: EditorView) {
		this.sync(view);
	}
	update(update: ViewUpdate) {
		this.sync(update.view);
	}
	private sync(view: EditorView) {
		const enabled = view.state.field(syntaxHiderEnabledField, false) ?? false;
		if (enabled === this.enabled) return;
		this.enabled = enabled;
		document.body.classList.toggle(BODY_CLASS, enabled);
	}
	destroy() {
		document.body.classList.remove(BODY_CLASS);
	}
}

const bodyClassPlugin = ViewPlugin.fromClass(BodyClassPlugin);

// ---------------------------------------------------------------------------
// ViewPlugin - replace hidden syntax ranges
// ---------------------------------------------------------------------------

class HiddenSyntaxReplacePlugin implements PluginValue {
	decorations: DecorationSet;

	constructor(view: EditorView) {
		this.decorations = this.build(view.state);
	}

	update(update: ViewUpdate) {
		// Rebuild decorations if:
		// - Document changed
		// - Selection changed
		// - Viewport changed
		// - Temporarily visible link field changed
		const tempVisibleChanged = update.transactions.some((tr) =>
			tr.effects.some((e) => e.is(setTemporarilyVisibleLink))
		);

		if (
			update.docChanged ||
			update.selectionSet ||
			update.viewportChanged ||
			tempVisibleChanged
		) {
			this.decorations = this.build(update.state);
		}
	}

	private build(state: EditorState): DecorationSet {
		if (!state.field(syntaxHiderEnabledField, false)) {
			return Decoration.none;
		}
		const ranges = computeHiddenRanges(state);
		if (ranges.length === 0) return Decoration.none;

		const builder = new RangeSetBuilder<Decoration>();
		for (const r of ranges) {
			if (r.from < r.to) builder.add(r.from, r.to, hiddenSyntaxReplace);
		}
		return builder.finish();
	}

	destroy() {}
}

const hiddenSyntaxReplacePlugin = ViewPlugin.fromClass(HiddenSyntaxReplacePlugin, {
	decorations: (v) => v.decorations,
});

class SyntaxHiderModePlugin implements PluginValue {
	private syncing = false;
	private pendingSync: number | null = null;

	constructor(private view: EditorView) {
		this.scheduleSync(view);
	}

	update(update: ViewUpdate) {
		if (this.syncing) return;
		this.scheduleSync(update.view);
	}

	private scheduleSync(view: EditorView) {
		if (this.pendingSync !== null) return;
		this.pendingSync = window.setTimeout(() => {
			this.pendingSync = null;
			this.sync(view);
		}, 0);
	}

	private sync(view: EditorView) {
		const enabled = isLivePreview(view);
		const current = view.state.field(syntaxHiderEnabledField, false);
		if (enabled === current) return;
		this.syncing = true;
		try {
			view.dispatch({ effects: setSyntaxHiderEnabled.of(enabled) });
		} finally {
			this.syncing = false;
		}
	}

	destroy() {}
}

const syntaxHiderModePlugin = ViewPlugin.fromClass(SyntaxHiderModePlugin);

// ---------------------------------------------------------------------------
// Cursor correction
// ---------------------------------------------------------------------------

function correctCursorPos(
	pos: number,
	oldPos: number,
	hidden: HiddenRange[],
	doc: EditorState["doc"],
	isPointer: boolean = false,
	hasGoalColumn: boolean = false
): number | null {
	const oldLine = doc.lineAt(Math.min(oldPos, doc.length));
	const newLine = doc.lineAt(Math.min(pos, doc.length));
	const isVerticalMotion = oldLine.number !== newLine.number;

	for (const h of hidden) {
		let inside: boolean;
		if (h.side === "leading") {
			if (pos === h.from && oldPos === h.from - 1 && !isPointer && !isVerticalMotion) {
				return h.to;
			}

			// When the leading hidden range starts at the beginning of a line
			// (e.g. "\n[[target]]"), position h.from is a valid line-start
			// cursor stop for someone arriving from the previous line (moving
			// right).  But if the user is pressing LEFT from h.to (the visible
			// text edge), we must skip past the decoration to h.from - 1.
			if (pos === h.from && pos === doc.lineAt(pos).from) {
				// Vertical motion (up/down arrow) from a different line
				// must snap to visible text.  The cursor at h.from is inside
				// the replaced [[ / ![[ decoration and invisible there.
				// We require hasGoalColumn to distinguish real vertical motion
				// (up/down arrow, which CM6 tags with goalColumn) from
				// horizontal wrap (right-arrow from end of previous line,
				// which crosses lines but has no goalColumn).
				if (isVerticalMotion && hasGoalColumn) {
					return h.to;
				}
				const movingRight = pos >= oldPos;
				if (movingRight) {
					// Right-arrow wrap from end of previous non-blank line:
					// stay at line start (h.from) — the hidden anchor is a
					// valid cursor stop for horizontal motion.
					if (h.from > 0) {
						const previousLine = doc.lineAt(h.from - 1);
						if (previousLine.text.length === 0) {
							return h.to;
						}
					}
					return null; // Arrived from non-empty prev line — stay
				}
				// Home key (or any horizontal same-line jump to line start):
				// the cursor jumped from outside the link to h.from.  The
				// dedicated Home keymap handler intercepts this before the
				// cursor ever reaches correctCursorPos, so this branch is a
				// fallback safety net — return null (stay at h.from) to avoid
				// bouncing to the previous line.
				if (!isVerticalMotion && oldPos > h.to) {
					return null;
				}
				// Moving left (left-arrow from h.to or from inside the link):
				// skip to before the link (end of prev line), or null if
				// already at document start (nowhere to go).
				return h.from > 0 ? h.from - 1 : null;
			}
			inside = pos >= h.from && pos < h.to;
		} else {
			inside = pos >= h.from && pos < h.to;
		}
		if (!inside) {
			continue;
		}

		const movingRight = pos >= oldPos;
		if (h.side === "leading") {
			return movingRight ? h.to : Math.max(0, h.from - 1);
		}
		// For pointer (click) events, always go to the text boundary
		// instead of skipping to the next line / past the range.
		if (isPointer) {
			return h.from;
		}
		if (movingRight) {
			// For line-ending links, stop at the line end (h.to) rather
			// than jumping to the next line (h.to + 1).  The user can
			// press right again from h.to to advance normally.
			const lineEnd = doc.lineAt(pos).to;
			if (h.to === lineEnd) {
				return h.to;
			}
			return Math.min(doc.length, h.to + 1);
		}
		// Moving left through trailing range.  When entering from the
		// right edge (oldPos === h.to), skip the trailing boundary
		// entirely: both short ranges (e.g. "]]" — zero visual width)
		// and long ranges (e.g. "](url)" — external-link icon) do not
		// represent a meaningful visible cursor stop.  Go directly to
		// h.from - 1 (the last character of the visible link text) so
		// leftward motion enters the link text in one arrow press.
		if (oldPos === h.to && h.from > 0) {
			return h.from - 1;
		}
		return h.from;
	}
	return null;
}

function computeHiddenRangesForPositions(
	doc: {
		lineAt(pos: number): { number: number; from: number; text: string };
		line(n: number): { from: number; text: string };
	},
	sel: EditorSelection
): HiddenRange[] {
	const ranges: HiddenRange[] = [];
	const seenLines = new Set<number>();
	for (const r of sel.ranges) {
		seenLines.add(doc.lineAt(r.head).number);
	}

	for (const lineNo of seenLines) {
		const line = doc.line(lineNo);
		ranges.push(
			...findMarkdownLinkSyntaxRanges(line.text, line.from),
			...findWikiLinkSyntaxRanges(line.text, line.from)
		);
	}
	ranges.sort((a, b) => a.from - b.from || a.to - b.to);
	return ranges;
}

const CORRECTING = "__leSyntaxCorrecting";
const cursorCorrector = EditorView.updateListener.of((update) => {
	if (!update.selectionSet) return;
	if ((update.view as any)[CORRECTING]) return;
	if (!update.state.field(syntaxHiderEnabledField, false)) return;

	const state = update.state;
	const newSel = state.selection;
	const oldSel = update.startState.selection;
	const hidden = computeHiddenRangesForPositions(state.doc, newSel);

	if (hidden.length === 0) return;
	const linkSpans = buildVisibleLinkSpans(hidden, state.doc);

	// Detect pointer-initiated selection changes (clicks / taps)
	const isPointer = update.transactions.some((tr) => tr.isUserEvent("select.pointer"));

	// Detect whether any transaction carries an explicit userEvent.
	// Obsidian's own link-normalisation dispatches carry NO userEvent
	// (they are programmatic, not user-initiated).  We use this to
	// distinguish "Obsidian moved cursor from h.to → h.from" from a
	// genuine user left-arrow press (which has userEvent "select" / "select.move").
	const hasUserEvent = update.transactions.some(
		(tr) => tr.annotation(Transaction.userEvent) !== undefined
	);

	let skipLeadingInsertionCorrection = false;
	let skipTrailingInsertionCorrection = false;
	if (update.docChanged) {
		let insertText: string | undefined;
		let insertFrom = -1;
		let insertTo = -1;
		let insertCount = 0;

		update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
			const text = inserted.toString();
			insertCount += 1;
			insertText = text;
			insertFrom = fromA;
			insertTo = toA;
		});

		if (
			insertText !== undefined &&
			insertCount === 1 &&
			insertFrom === insertTo &&
			!insertText.includes("\n") &&
			newSel.ranges.length === 1 &&
			newSel.main.empty
		) {
			const safeInsertText = insertText;
			const head = newSel.main.head;
			if (head === insertFrom + safeInsertText.length) {
				// Skip correction when typing at the leading edge of a hidden range
				// (e.g., typing the opening brackets of a link)
				skipLeadingInsertionCorrection = hidden.some(
					(h) =>
						h.side === "leading" &&
						h.from === head &&
						insertFrom === h.from - safeInsertText.length
				);

				// Skip correction when typing at the trailing edge (h.from) of a trailing range.
				// This is the position right before the trailing syntax (e.g., before "]]"),
				// which is a valid editing position for typing link destinations.
				// This allows Obsidian's native link autocomplete to work when typing inside [[...]]
				skipTrailingInsertionCorrection = hidden.some(
					(h) => h.side === "trailing" && head === h.from
				);
			}
		}
	}

	if (skipLeadingInsertionCorrection || skipTrailingInsertionCorrection) return;

	let needsAdjust = false;

	const adjusted = newSel.ranges.map((range, i) => {
		const oldHead = i < oldSel.ranges.length ? oldSel.ranges[i].head : oldSel.main.head;
		let head = range.head;

		// Obsidian's own link extension sometimes dispatches a programmatic
		// (no userEvent) move from textFrom (visible text start) back to
		// leading.from (line start, inside the hidden leading syntax) after
		// we place the cursor at textFrom via a vertical-motion or Home-key
		// correction.  Without intervention, the markdownLeadingExit check
		// or correctCursorPos treats this as a left-arrow press and bounces
		// to leading.from-1 (previous line).
		//
		// We distinguish this from a genuine left-arrow press by checking
		// arrivedAtTextFromFromOutsideField: it is true only when the cursor
		// arrived at textFrom from outside the link (vertical motion, Home
		// key, etc.).  A genuine left-arrow from textFrom would not have
		// set this field.
		//
		// !! CRITICAL ORDERING !!
		// This check MUST run BEFORE markdownLeadingExit because that check
		// matches the same oldHead=textFrom, head=leading.from pattern.
		// If you move markdownLeadingExit above this block, down-arrow and
		// up-arrow will bounce on line-start markdown links.  This has been
		// broken by AI at least 4 times.  The "Obsidian normalization must
		// not bounce cursor off line-start markdown links" integration tests
		// will fail if the ordering is wrong.
		// !! CRITICAL: Obsidian normalisation suppression !!
		//
		// After vertical motion (up/down arrow) or Home/Ctrl+A delivers the
		// cursor to textFrom (visible alias start), Obsidian dispatches a
		// follow-up normalisation from textFrom back to leading.from (the
		// hidden [[ or [ syntax at line start) with NO userEvent.
		//
		// This suppression block MUST:
		//   1. Run BEFORE markdownLeadingExit (which matches the same pattern)
		//   2. Redirect to textFrom (visible alias start), NOT stay at
		//      leading.from (hidden syntax)
		//
		// If you change this to stay at leading.from instead of redirecting
		// to textFrom, the visible-cursor plugin will render a garbled block
		// cursor on the hidden [[ syntax character.  The cursor will also
		// require two right-arrow presses to move off the first visible
		// character because the real selection is inside hidden syntax, not
		// on the visible alias start.
		//
		// This has been broken by AI multiple times.  The regression tests
		// "Obsidian normalisation suppression must redirect to textFrom"
		// will fail if you break this.  Always run npm run test:run.
		if (!isPointer && !hasUserEvent) {
			const cameFromOutside = update.startState.field(
				arrivedAtTextFromFromOutsideField,
				false
			);
			if (cameFromOutside) {
				const obsidianNorm = linkSpans.find(
					(span) =>
						head === span.leading.from &&
						head === state.doc.lineAt(head).from &&
						oldHead === span.textFrom
				);
				if (obsidianNorm) {
					// MUST redirect to textFrom, NOT stay at leading.from.
					// leading.from is inside the hidden [[ decoration and
					// invisible.  Staying there breaks block cursor rendering
					// in the visible-cursor plugin and requires two right-arrow
					// presses to move off the first visible character.
					head = obsidianNorm.textFrom;
					needsAdjust = true;
				}
			}
		}

		if (!isPointer) {
			const markdownLeadingExit = linkSpans.find(
				(span) =>
					isMarkdownLinkSpan(state.doc, span) &&
					oldHead === span.textFrom &&
					head === span.leading.from
			);
			if (markdownLeadingExit) {
				head = Math.max(0, markdownLeadingExit.leading.from - 1);
				needsAdjust = true;
			}
		}

		// Any navigation (Home key, Emacs Ctrl+A, editor.setCursor, etc.) that
		// lands the cursor at or near the start of a line-start link coming
		// from OUTSIDE the entire link (oldHead > span.to) must be handled:
		//
		// Case A: cursor arrives at h.from (leading.from = lineStart).
		//   Snap to span.textFrom and mark arrivedFromOutside.
		//
		// Case B: Obsidian's Editor API translates {line, ch:0} directly to
		//   span.textFrom (skipping the hidden leading range internally).
		//   The cursor arrives at textFrom from outside; mark arrivedFromOutside
		//   so the follow-up normalisation (textFrom→h.from, no userEvent) is
		//   suppressed.  No snap needed — already at the right position.
		if (!isPointer) {
			const lineStartSpan = linkSpans.find(
				(span) =>
					span.leading.from === state.doc.lineAt(span.leading.from).from &&
					oldHead > span.to && // came from strictly outside the link
					(head === span.leading.from || head === span.textFrom)
			);
			if (lineStartSpan) {
				if (head === lineStartSpan.leading.from) {
					// Case A: snap to visible text start
					head = lineStartSpan.textFrom;
					needsAdjust = true;
				} else {
					// Case B: already at textFrom, just mark it
					needsAdjust = true; // trigger dispatch so the effect is attached
				}
				(update.view as any).__leArrivedFromOutside = lineStartSpan.leading.from;
			}
		}

		if (!isPointer) {
			const boundarySpan = findVisibleLinkSpanAtBoundary(linkSpans, head);
			if (boundarySpan && head === boundarySpan.leading.from) {
				const lineStartsWithLink = boundarySpan.leading.from === boundarySpan.lineFrom;
				const cameFromVisibleText =
					oldHead >= boundarySpan.textFrom && oldHead <= boundarySpan.textTo;
				const isAtVisibleTextStart = oldHead === boundarySpan.textFrom;

				if (cameFromVisibleText && !lineStartsWithLink) {
					if (isAtVisibleTextStart) {
						head = Math.max(0, boundarySpan.leading.from - 1);
						needsAdjust = true;
					} else {
						const visibleText = state.doc.sliceString(
							boundarySpan.textFrom,
							boundarySpan.textTo
						);
						const relativeOldHead = Math.max(
							0,
							Math.min(visibleText.length, oldHead - boundarySpan.textFrom)
						);
						const nextVisibleBoundary = findNextWordBoundary(
							visibleText,
							relativeOldHead,
							visibleText.length
						);
						head = boundarySpan.textFrom + nextVisibleBoundary;
						needsAdjust = true;
					}
				}
			}
		}

		// CM6 vertical motion can legitimately arrive at the line-start position of
		// a hidden leading range with a remembered goal column, and then follow up
		// with a normalization step from the visible-text edge back to line start.
		// Treat that as successful vertical motion, not as a LEFT-arrow-style move
		// that should bounce back to the previous line.
		// goalColumn is set on the NEW selection (the one being dispatched),
		// not the old one.  Check both to handle CM6's internal normalization
		// steps where the old selection carries goalColumn forward.
		const hasGoalColumn =
			newSel.main.goalColumn !== undefined || oldSel.main.goalColumn !== undefined;
		if (hasGoalColumn) {
			const oldLine = state.doc.lineAt(Math.min(oldHead, state.doc.length));
			const newLine = state.doc.lineAt(Math.min(head, state.doc.length));
			const isVertical = oldLine.number !== newLine.number;

			let allowLeadingBoundaryAdvance = false;
			for (const span of linkSpans) {
				// Vertical motion can land at either leading.from (wikilinks,
				// where the hidden [[ is 2+ chars wide and column 0 hits it)
				// or directly at textFrom (markdown links, where the hidden
				// [ is only 1 char and CM6's goalColumn lands just past it).
				// Handle both cases.
				const landedAtLeadingFrom =
					head === span.leading.from && head === state.doc.lineAt(head).from;
				const landedAtTextFromVertically =
					head === span.textFrom &&
					span.leading.from === state.doc.lineAt(span.leading.from).from &&
					isVertical;

				if (!landedAtLeadingFrom && !landedAtTextFromVertically) continue;

				// Vertical motion (up/down arrow) from a different line
				// landing at or near the line-start hidden leading range.
				// Snap to visible text (if not already there) and mark
				// arrivedFromOutside so the follow-up Obsidian normalisation
				// (textFrom → leading.from, no userEvent) is suppressed —
				// without this, correctCursorPos treats the normalisation
				// as a left-arrow and bounces to the previous line.
				if (isVertical) {
					head = span.textFrom;
					needsAdjust = true;
					(update.view as any).__leArrivedFromOutside = span.leading.from;
					// When vertical motion arrives from a line above/below with a
					// remembered goal column that is inside the folded link text,
					// always snap to the visible text start. Preserving oldHead here
					// would send the cursor back to the visual end of the link on the
					// return ArrowDown/ArrowUp path, which breaks the expected
					// "land at line start" behavior for line-start links.
					break;
				}

				if (!landedAtLeadingFrom) continue;

				if (oldHead === span.leading.from - 1) {
					allowLeadingBoundaryAdvance = true;
					break;
				}
				if (oldHead < span.textFrom || oldHead > span.textTo) continue;

				// A same-line horizontal move inside visible text that lands on the
				// hidden leading boundary should preserve the current visible column.
				// Do not apply this to vertical motion; those cases are handled above
				// and must snap to span.textFrom instead.

				head = oldHead;
				needsAdjust = true;
				break;
			}

			if (allowLeadingBoundaryAdvance) {
				head = Math.min(state.doc.length, head + 1);
			}
		}

		for (let pass = 0; pass < 3; pass++) {
			const markdownRightEdgeSpan = linkSpans.find(
				(span) =>
					isMarkdownLinkSpan(state.doc, span) &&
					oldHead === span.to &&
					head === span.trailing.to - 1
			);
			if (markdownRightEdgeSpan) {
				head = markdownRightEdgeSpan.textTo;
				needsAdjust = true;
				break;
			}

			const corrected = correctCursorPos(
				head,
				oldHead,
				hidden,
				state.doc,
				isPointer,
				hasGoalColumn
			);
			if (corrected === null || corrected === head) break;
			head = corrected;
			needsAdjust = true;
		}

		return range.empty
			? EditorSelection.cursor(head)
			: EditorSelection.range(range.anchor, head);
	});

	if (!needsAdjust) {
		return;
	}

	const sel = EditorSelection.create(adjusted, newSel.mainIndex);
	const view = update.view;

	const arrivedFromOutsideHFrom: number | undefined = (view as any).__leArrivedFromOutside;
	(view as any).__leArrivedFromOutside = undefined;

	(view as any)[CORRECTING] = true;
	try {
		view.dispatch({
			selection: sel,
			scrollIntoView: true,
			effects:
				arrivedFromOutsideHFrom !== undefined
					? [arrivedAtTextFromFromOutsideEffect.of(true)]
					: undefined,
		});
	} finally {
		(view as any)[CORRECTING] = false;
	}
});

const suppressSuggestAfterDeleteListener = EditorView.updateListener.of((update) => {
	if (!update.state.field(syntaxHiderEnabledField, false)) return;

	let targetPos: number | null = null;
	for (const tr of update.transactions) {
		for (const effect of tr.effects) {
			if (effect.is(suppressSuggestAfterDelete)) {
				targetPos = effect.value;
			}
		}
	}

	if (targetPos === null) return;

	window.setTimeout(() => {
		if (!update.view.dom.isConnected) return;

		const current = update.view.state.selection.main;
		if (!current.empty || current.head !== targetPos) return;

		update.view.dispatch({
			selection: EditorSelection.cursor(targetPos),
			scrollIntoView: true,
		});
	}, 0);
});

const boundaryInputSuppressor = EditorView.domEventHandlers({
	keydown(event, view) {
		if (!view.state.field(syntaxHiderEnabledField, false)) return false;
		if (event.defaultPrevented) return false;
		if (event.ctrlKey || event.metaKey || event.altKey) return false;
		if (event.isComposing) return false;
		if (event.key.length !== 1) return false;

		const sel = view.state.selection;
		if (sel.ranges.length !== 1 || !sel.main.empty) return false;

		const suppressPos = view.state.field(suppressNextBoundaryInputField, false);
		if (suppressPos === null || suppressPos !== sel.main.head) return false;

		event.preventDefault();
		const nextPos = suppressPos + event.key.length;
		view.dispatch({
			changes: { from: suppressPos, to: suppressPos, insert: event.key },
			selection: EditorSelection.cursor(nextPos),
			scrollIntoView: true,
			effects: [setSuppressNextBoundaryInput.of(nextPos)],
		});
		return true;
	},
});

// ---------------------------------------------------------------------------
// Backspace / Delete inside link display text — high-precedence keymap
// ---------------------------------------------------------------------------

/**
 * Handle Backspace and Delete when the cursor is inside the display-text
 * region of a hidden link.
 *
 * By owning these keys at high precedence (same approach as `enterAtLinkEndKeymap`
 * for Enter), we consume the keypress before Obsidian's handler ever sees it.
 * This prevents Obsidian's `LinkTextSuggest.onTrigger` from firing (it is
 * evaluated on each raw keypress), which is the only reliable way to stop the
 * completion popup from appearing.
 *
 * The dispatch is intentionally plain (no userEvent annotation) so it looks
 * like a programmatic edit to Obsidian — the suggest trigger is not activated.
 *
 * Handles the same boundary cases as `deleteAtLinkEndFix` /
 * `deleteAtLinkStartFix`:
 *
 * Backspace:
 *  - Cursor strictly inside display text [textFrom, textTo): delete char before cursor.
 *  - Cursor at the right edge of display text (= textTo = trail.from): delete
 *    the last display char (head - 1).
 *
 * Delete:
 *  - Cursor strictly inside display text or at the left edge (= textFrom = lead.to):
 *    delete char at cursor.
 */
const deleteInLinkTextKeymap = keymap.of([
	{
		key: "Backspace",
		run(view) {
			if (!view.state.field(syntaxHiderEnabledField, false)) return false;
			const sel = view.state.selection;
			if (sel.ranges.length !== 1 || !sel.main.empty) return false;

			const head = sel.main.head;
			const hidden = computeHiddenRanges(view.state);

			for (let i = 0; i < hidden.length - 1; i++) {
				const lead = hidden[i];
				const trail = hidden[i + 1];
				if (lead.side !== "leading" || trail.side !== "trailing") continue;

				const textFrom = lead.to;
				const textTo = trail.from;

				// Case 1: cursor inside display text or at the right edge (textTo)
				if (head > textFrom && head <= textTo) {
					if (head - 1 < textFrom) return false; // nothing to delete
					view.dispatch({
						changes: { from: head - 1, to: head, insert: "" },
						selection: EditorSelection.cursor(head - 1),
						scrollIntoView: true,
					});
					return true; // consume key — Obsidian never sees Backspace
				}

				// Case 2: cursor at trail.to (just past the closing syntax, e.g. after "]]")
				// Backspace would target [trail.to-1, trail.to) = inside trailing syntax.
				// Redirect to delete the last display char (textTo - 1).
				if (head === trail.to && textTo > textFrom) {
					view.dispatch({
						changes: { from: textTo - 1, to: textTo, insert: "" },
						selection: EditorSelection.cursor(textTo - 1),
						scrollIntoView: true,
						effects: [setSuppressNextBoundaryInput.of(textTo - 1)],
					});
					return true;
				}
			}
			return false;
		},
	},
	{
		key: "Delete",
		run(view) {
			if (!view.state.field(syntaxHiderEnabledField, false)) return false;
			const sel = view.state.selection;
			if (sel.ranges.length !== 1 || !sel.main.empty) return false;

			const head = sel.main.head;
			const hidden = computeHiddenRanges(view.state);

			for (let i = 0; i < hidden.length - 1; i++) {
				const lead = hidden[i];
				const trail = hidden[i + 1];
				if (lead.side !== "leading" || trail.side !== "trailing") continue;

				const textFrom = lead.to;
				const textTo = trail.from;

				// Cursor inside display text or at the left edge (textFrom)
				if (head >= textFrom && head < textTo) {
					if (head + 1 > textTo) return false; // nothing to delete
					view.dispatch({
						changes: { from: head, to: head + 1, insert: "" },
						selection: EditorSelection.cursor(head),
						scrollIntoView: true,
					});
					return true; // consume key — Obsidian never sees Delete
				}

				// Cursor at the outside-left edge (lead.from), where a raw Delete would
				// target the leading syntax (e.g. the first '[' of a wikilink). Redirect
				// to delete the first visible display character and consume the key so
				// Obsidian's link completion never sees the Delete press.
				if (head === lead.from && textFrom < textTo) {
					view.dispatch({
						changes: { from: textFrom, to: textFrom + 1, insert: "" },
						selection: EditorSelection.cursor(textFrom),
						scrollIntoView: true,
					});
					return true;
				}
			}
			return false;
		},
	},
]);

// ---------------------------------------------------------------------------
// Enter key at link end
// ---------------------------------------------------------------------------

/**
 * Detect the list continuation prefix for a line.
 * Returns the string to prepend after "\n" (e.g. "- ", "1. ", "- [ ] "),
 * or "" for non-list lines.
 */
function listContinuation(lineText: string): string {
	const trimmed = lineText.trimStart();
	const indent = lineText.substring(0, lineText.length - trimmed.length);

	// Try ordered list first: "1. " or "1) " (with optional checkbox)
	const orderedM = trimmed.match(/^(\d+)([.)]) (?:(\[.\]) )?/);
	if (orderedM) {
		const num = parseInt(orderedM[1], 10);
		const sep = orderedM[2]; // "." or ")"
		let prefix = indent + String(num + 1) + sep + " ";
		if (orderedM[3]) prefix += "[ ] ";
		return prefix;
	}

	// Try unordered bullet: "- ", "* ", "+ " (with optional checkbox)
	const bulletM = trimmed.match(/^([-*+]) (?:(\[.\]) )?/);
	if (bulletM) {
		let prefix = indent + bulletM[1] + " ";
		if (bulletM[2]) prefix += "[ ] ";
		return prefix;
	}

	return "";
}

/**
 * Keymap handler that fires BEFORE Obsidian's own Enter binding.
 * When the cursor sits inside or at the boundary of a trailing hidden
 * range that reaches the end of the line, we fully handle the Enter
 * key by inserting a newline (with list continuation) at line.to and
 * consuming the event.  This prevents any interaction between the
 * cursor position (which may be inside a replaced decoration) and
 * the default Enter handling (which can produce a spurious "]" when
 * the cursor is logically inside hidden wikilink syntax).
 */
// ---------------------------------------------------------------------------
// Home key handler
// ---------------------------------------------------------------------------
// Intercepts Home (and Shift+Home for extend-selection) when the cursor is
// outside a link whose leading range starts at the beginning of the line.
// Without this, CM6's moveToLineBoundary delivers the cursor to h.from
// (inside the hidden [[ syntax), Obsidian's link extension then expands the
// link and repositions the cursor to the previous line.
//
// We dispatch directly to h.to (visible text start) and return true so
// neither CM6's default handler nor any downstream extension ever sees the
// cursor at h.from.
const homeKeyKeymap = keymap.of([
	{
		key: "Home",
		run(view) {
			return handleHomeKey(view, false);
		},
		shift(view) {
			return handleHomeKey(view, true);
		},
	},
]);

function handleHomeKey(view: EditorView, extend: boolean): boolean {
	if (!view.state.field(syntaxHiderEnabledField, false)) return false;
	const sel = view.state.selection;
	if (sel.ranges.length !== 1) return false;

	const head = sel.main.head;
	const doc = view.state.doc;
	const line = doc.lineAt(head);

	const hidden = computeHiddenRanges(view.state);
	const linkSpans = buildVisibleLinkSpans(hidden, doc);

	for (const span of linkSpans) {
		if (span.leading.from !== line.from) continue; // link must start at line start
		if (head <= span.to) continue; // cursor is inside the link — let CM6 handle

		// Cursor is to the right of the entire link on the same line.
		// Snap directly to span.textFrom (visible text start) instead of
		// letting CM6's moveToLineBoundary land at line.from (inside [[).
		const dest = span.textFrom;
		view.dispatch({
			selection: extend
				? EditorSelection.range(sel.main.anchor, dest)
				: EditorSelection.cursor(dest),
			scrollIntoView: true,
			userEvent: "select",
			effects: [arrivedAtTextFromFromOutsideEffect.of(true)],
		});
		return true;
	}
	return false;
}

const enterAtLinkEndKeymap = keymap.of([
	{
		key: "Enter",
		run(view) {
			if (!view.state.field(syntaxHiderEnabledField, false)) return false;
			const sel = view.state.selection;
			if (sel.ranges.length !== 1 || !sel.main.empty) return false;

			const head = sel.main.head;
			const hidden = computeHiddenRanges(view.state);

			for (const h of hidden) {
				if (h.side !== "trailing") continue;
				if (head < h.from || head > h.to) continue;

				const line = view.state.doc.lineAt(head);
				// Only act when the trailing range reaches the line end
				if (h.to !== line.to) continue;

				// Compute insert text with list continuation (handles ordered lists)
				const continuation = listContinuation(line.text);
				const insert = "\n" + continuation;

				view.dispatch({
					changes: {
						from: line.to,
						to: line.to,
						insert,
					},
					selection: EditorSelection.cursor(line.to + insert.length),
					scrollIntoView: true,
				});
				return true; // Consume Enter — we handled it
			}
			return false;
		},
	},
]);

// ---------------------------------------------------------------------------
// Edit protection
// ---------------------------------------------------------------------------

const enterAtLinkEndFix = EditorState.transactionFilter.of((tr) => {
	if (!tr.docChanged) return tr;
	if (!tr.isUserEvent("input")) return tr;
	if (!tr.startState.field(syntaxHiderEnabledField, false)) return tr;
	const startSel = tr.startState.selection;
	if (startSel.ranges.length !== 1) return tr;
	const range = startSel.ranges[0];
	if (!range.empty) return tr;

	// If the cursor is already at the line end, OR the insertion is already
	// at the line end, don't intercept.
	//
	// Case 1: enterAtLinkEndKeymap pre-positions the cursor to line.to before
	// returning false; we must not redirect that Enter or ordered-list numbering
	// (and other smart-Enter behaviours) will break.
	//
	// Case 2: enterAtLinkEndFix itself produces a redirected transaction by
	// calling tr.startState.update({changes: {from: line.to, ...}}).  That
	// redirected transaction is run through the filter pipeline again — we must
	// not intercept it or we'll loop forever.
	{
		const lineAtHead = tr.startState.doc.lineAt(range.head);
		if (range.head === lineAtHead.to) return tr;
		// Guard against self-loop: if the insertion is already positioned at
		// line.to (the redirect destination), pass through.
		// "insertFrom" is computed below; use the raw change data here.
		let firstInsertFrom = -1;
		let hasNewline = false;
		tr.changes.iterChanges((fromA, _toA, _fromB, _toB, inserted) => {
			const text = inserted.toString();
			if (text.includes("\n") && firstInsertFrom === -1) {
				firstInsertFrom = fromA;
				hasNewline = true;
			}
		});
		if (hasNewline && firstInsertFrom === lineAtHead.to) return tr;
	}

	let insertText: string | undefined;
	let insertFrom = -1;
	let insertTo = -1;
	let insertCount = 0;

	tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
		const text = inserted.toString();
		if (!text.includes("\n")) return;
		insertCount += 1;
		insertText = text;
		insertFrom = fromA;
		insertTo = toA;
	});

	if (!insertText || insertCount !== 1) return tr;

	const hidden = computeHiddenRanges(tr.startState);
	if (hidden.length === 0) return tr;

	const line = tr.startState.doc.lineAt(range.head);

	// For pure insertions at cursor, check via findLinkEndAtPos
	// For replacements or insertions at other positions, check whether
	// the cursor or the change range overlaps a trailing hidden range
	let matchedTrailing: HiddenRange | null = null;

	if (insertFrom === insertTo && insertFrom === range.head) {
		const linkEnd = findLinkEndAtPos(line.text, line.from, insertFrom);
		if (linkEnd !== null) {
			for (const h of hidden) {
				if (h.side === "trailing" && linkEnd === h.to) {
					matchedTrailing = h;
					break;
				}
			}
		}
	}

	// Fallback: if the cursor is at or inside a trailing hidden range,
	// or the change range overlaps one, redirect the newline to the
	// end of the line regardless of exact insertion position.
	if (!matchedTrailing) {
		for (const h of hidden) {
			if (h.side !== "trailing") continue;
			// Cursor inside or at trailing range boundary
			if (range.head >= h.from && range.head <= h.to) {
				matchedTrailing = h;
				break;
			}
			// Change range overlaps trailing range
			if (insertFrom < h.to && insertTo > h.from) {
				matchedTrailing = h;
				break;
			}
		}
	}

	if (!matchedTrailing) return tr;

	// Only redirect newlines when the trailing range reaches the line end
	if (matchedTrailing.to !== line.to) return tr;

	let finalInsertText = insertText;
	if (insertText === "\n" && line.text.trimStart().startsWith("- ")) {
		finalInsertText = "\n- ";
	}

	const userEvent = tr.annotation(Transaction.userEvent) ?? undefined;
	return tr.startState.update({
		changes: { from: line.to, to: line.to, insert: finalInsertText },
		selection: EditorSelection.cursor(line.to + finalInsertText.length),
		scrollIntoView: true,
		userEvent,
	});
});

function isPureDeleteTransaction(tr: Transaction): boolean {
	if (!tr.docChanged) return false;

	let sawDeletion = false;
	let pureDelete = true;

	tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
		if (inserted.length !== 0) {
			pureDelete = false;
			return;
		}
		if (toA > fromA) {
			sawDeletion = true;
		}
	});

	return pureDelete && sawDeletion;
}

function isWikiLinkSpan(state: EditorState, link: LinkSpan): boolean {
	const prefix = state.doc.sliceString(link.from, Math.min(link.textFrom, link.to));
	return prefix.startsWith("[[") || prefix.startsWith("![[");
}

function findLinkSpanContainingVisibleRange(
	links: LinkSpan[],
	from: number,
	to: number
): LinkSpan | null {
	for (const link of links) {
		if (from >= link.textFrom && to <= link.textTo) {
			return link;
		}
	}

	return null;
}

const suppressSuggestAfterVisibleDeleteFilter = EditorState.transactionFilter.of((tr) => {
	if (!isPureDeleteTransaction(tr)) return tr;
	if (!tr.startState.field(syntaxHiderEnabledField, false)) return tr;
	if (tr.effects.some((e) => e.is(suppressSuggestAfterVisibleDelete))) {
		return tr;
	}

	const startSel = tr.startState.selection;
	if (startSel.ranges.length !== 1) return tr;

	const hidden = tr.startState.field(hiddenRangesField, false);
	if (!hidden || hidden.length === 0) return tr;

	const links = buildLinkSpans(hidden);
	if (links.length === 0) return tr;

	let deleteFrom = -1;
	let deleteTo = -1;
	let deleteCount = 0;
	tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
		if (inserted.length !== 0) return;
		deleteCount += 1;
		deleteFrom = fromA;
		deleteTo = toA;
	});

	if (deleteCount !== 1) return tr;
	if (deleteFrom >= deleteTo) return tr;

	const link = findLinkSpanContainingVisibleRange(links, deleteFrom, deleteTo);
	if (!link) return tr;
	if (!isWikiLinkSpan(tr.startState, link)) return tr;

	const suppressPos = tr.newSelection.main.head;
	const userEvent = tr.annotation(Transaction.userEvent) ?? undefined;

	return tr.startState.update({
		changes: tr.changes,
		selection: tr.newSelection,
		scrollIntoView: tr.scrollIntoView,
		userEvent,
		effects: [
			...tr.effects,
			suppressSuggestAfterVisibleDelete.of(null),
			setSuppressNextBoundaryInput.of(suppressPos),
		],
	});
});

const suppressNextBoundaryInputFilter = EditorState.transactionFilter.of((tr) => {
	if (!tr.docChanged) return tr;
	if (!tr.isUserEvent("input")) return tr;
	if (!tr.startState.field(syntaxHiderEnabledField, false)) return tr;
	const suppressedInputPos = tr.startState.field(suppressNextBoundaryInputField, false);
	if (suppressedInputPos === null) {
		return tr;
	}
	if (tr.effects.some((e) => e.is(suppressSuggestAfterVisibleDelete))) {
		return tr;
	}

	const startSel = tr.startState.selection;
	if (startSel.ranges.length !== 1 || !startSel.main.empty) return tr;

	const suppressPos = suppressedInputPos;
	if (suppressPos !== startSel.main.head) return tr;

	let insertText: string | undefined;
	let insertFrom = -1;
	let insertTo = -1;
	let insertCount = 0;

	tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
		const text = inserted.toString();
		if (text.includes("\n")) return;
		insertCount += 1;
		insertText = text;
		insertFrom = fromA;
		insertTo = toA;
	});

	if (!insertText || insertCount !== 1) return tr;
	if (insertFrom !== insertTo) return tr;
	if (insertFrom !== suppressPos) return tr;

	const nextPos = suppressPos + insertText.length;
	return tr.startState.update({
		changes: { from: suppressPos, to: suppressPos, insert: insertText },
		selection: EditorSelection.cursor(nextPos),
		scrollIntoView: tr.scrollIntoView,
		effects: [
			suppressSuggestAfterVisibleDelete.of(null),
			setSuppressNextBoundaryInput.of(nextPos),
		],
	});
});

const insertAtLinkStartFix = EditorState.transactionFilter.of((tr) => {
	if (!tr.docChanged) return tr;
	if (!tr.isUserEvent("input")) return tr;
	if (!tr.startState.field(syntaxHiderEnabledField, false)) return tr;
	if (tr.startState.field(suppressNextBoundaryInputField, false) !== null) {
		return tr;
	}
	if (tr.effects.some((e) => e.is(suppressSuggestAfterVisibleDelete))) {
		return tr;
	}
	const startSel = tr.startState.selection;
	if (startSel.ranges.length !== 1) return tr;
	const range = startSel.ranges[0];
	if (!range.empty) return tr;

	let insertText: string | undefined;
	let insertFrom = -1;
	let insertTo = -1;
	let insertCount = 0;

	tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
		const text = inserted.toString();
		if (text.includes("\n")) return;
		insertCount += 1;
		insertText = text;
		insertFrom = fromA;
		insertTo = toA;
	});

	if (!insertText || insertCount !== 1) return tr;
	if (insertFrom !== insertTo) return tr;
	if (insertFrom !== range.head) return tr;

	const hidden = computeHiddenRanges(tr.startState);
	if (hidden.length === 0) return tr;

	for (const h of hidden) {
		if (h.side !== "leading") continue;
		if (insertFrom !== h.to) continue;

		const userEvent = tr.annotation(Transaction.userEvent) ?? undefined;
		return tr.startState.update({
			changes: { from: h.from, to: h.from, insert: insertText },
			selection: EditorSelection.cursor(h.from + insertText.length),
			scrollIntoView: true,
			userEvent,
		});
	}

	return tr;
});

/**
 * Handles two cases at the RIGHT boundary of a link (trailing range):
 *
 * 1. **Backspace from outside-right** — cursor is at h.to (just after the
 *    closing syntax, e.g. after "]]").  The natural delete target lands inside
 *    the trailing syntax.  Redirect to delete h.from - 1 (last display char).
 *
 * 2. **Del from inside-right** — cursor is at h.from (just before the
 *    trailing syntax, e.g. before "]]").  A forward delete would consume the
 *    first character of the trailing syntax.  Redirect to delete h.from - 1
 *    (last display char — same target as case 1, since the character at
 *    h.from - 1 is the last visible character of the link text).
 *
 * Only applies when:
 *  - Single cursor, no selection
 *  - Exactly one single-character pure delete in the transaction
 *  - The deleted range falls within the trailing hidden range
 *  - cursor was at h.to (backspace) or h.from (Del)
 *  - h.from > 0 (there is a visible character before the trailing syntax)
 */
const deleteAtLinkEndFix = EditorState.transactionFilter.of((tr) => {
	if (!isPureDeleteTransaction(tr)) return tr;
	if (!tr.startState.field(syntaxHiderEnabledField, false)) return tr;

	const hidden = tr.startState.field(hiddenRangesField, false);
	if (!hidden || hidden.length === 0) return tr;

	const startSel = tr.startState.selection;
	if (startSel.ranges.length !== 1) return tr;
	const range = startSel.ranges[0];
	if (!range.empty) return tr; // Only single-cursor (no selection) deletes

	// Collect the change (expect exactly one pure delete)
	let deleteFrom = -1;
	let deleteTo = -1;
	let deleteCount = 0;
	tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
		if (inserted.length !== 0) return; // Not a pure delete
		deleteCount += 1;
		deleteFrom = fromA;
		deleteTo = toA;
	});

	if (deleteCount !== 1) return tr;
	if (deleteTo - deleteFrom !== 1) return tr; // Only single-char delete

	// Check if the deletion falls within a trailing hidden range.
	for (const h of hidden) {
		if (h.side !== "trailing") continue;
		if (deleteFrom < h.from || deleteTo > h.to) continue;
		// Must have visible link text before the trailing syntax to delete into
		if (h.from === 0) return tr;

		// Case 1: Backspace from outside-right — cursor was at h.to
		// Case 2: Del from inside-right — cursor was at h.from (about to delete
		//         the first character of the trailing syntax forward)
		if (range.head !== h.to && range.head !== h.from) continue;

		const userEvent = tr.annotation(Transaction.userEvent) ?? undefined;
		return tr.startState.update({
			changes: { from: h.from - 1, to: h.from, insert: "" },
			selection: EditorSelection.cursor(h.from - 1),
			scrollIntoView: true,
			userEvent,
			// Attach effect so suppressSuggestAfterDeleteListener can dispatch
			// a selection-only follow-up, resetting Obsidian's suggest trigger.
			effects: [
				suppressSuggestAfterDelete.of(h.from - 1),
				setSuppressNextBoundaryInput.of(h.from - 1),
			],
		});
	}

	return tr;
});

/**
 * Handles two cases at the LEFT boundary of a link (leading range):
 *
 * 1. **Del from outside-left** — cursor is at h.from (just before the
 *    opening syntax, e.g. before "[[").  A forward delete would consume the
 *    first character of the leading syntax.  Redirect to delete h.to
 *    (first display char — the character immediately after the leading range).
 *
 * 2. **Backspace from inside-left** — cursor is at h.to (just after the
 *    leading syntax, e.g. after "[[").  The natural backspace targets the last
 *    character of the leading syntax.  Redirect to delete h.from - 1 (the
 *    character before the link).
 *
 * Only applies to a single-character delete (toA - fromA === 1) whose
 * range falls entirely within a leading hidden range.
 */
const deleteAtLinkStartFix = EditorState.transactionFilter.of((tr) => {
	if (!isPureDeleteTransaction(tr)) return tr;
	if (!tr.startState.field(syntaxHiderEnabledField, false)) return tr;

	const hidden = tr.startState.field(hiddenRangesField, false);
	if (!hidden || hidden.length === 0) return tr;

	const startSel = tr.startState.selection;
	if (startSel.ranges.length !== 1) return tr;
	const range = startSel.ranges[0];
	if (!range.empty) return tr; // Only single-cursor (no selection) deletes

	// Collect the change (expect exactly one)
	let deleteFrom = -1;
	let deleteTo = -1;
	let deleteCount = 0;
	tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
		if (inserted.length !== 0) return; // Not a pure delete
		deleteCount += 1;
		deleteFrom = fromA;
		deleteTo = toA;
	});

	if (deleteCount !== 1) return tr;
	if (deleteTo - deleteFrom !== 1) return tr; // Only single-char delete

	const doc = tr.startState.doc;
	const userEvent = tr.annotation(Transaction.userEvent) ?? undefined;

	// Check if the deletion falls entirely inside a leading hidden range
	for (const h of hidden) {
		if (h.side !== "leading") continue;
		if (deleteFrom < h.from || deleteTo > h.to) continue;
		// Deletion is inside [h.from, h.to) — it would delete part of leading syntax.

		// Case 2: Backspace from inside-left — cursor at h.to, deletion targets [h.to-1, h.to)
		// Redirect to delete the character before the link (h.from - 1).
		if (range.head === h.to) {
			if (h.from === 0) return tr; // Nothing before the link to delete
			return tr.startState.update({
				changes: { from: h.from - 1, to: h.from, insert: "" },
				selection: EditorSelection.cursor(h.from - 1),
				scrollIntoView: true,
				userEvent,
				effects: [
					suppressSuggestAfterDelete.of(h.from - 1),
					setSuppressNextBoundaryInput.of(h.from - 1),
				],
			});
		}

		// Case 1: Del from outside-left — cursor at h.from, deletion targets [h.from, h.from+1)
		// Redirect to delete the first display character (h.to).
		if (range.head === h.from) {
			if (h.to >= doc.length) return tr; // Nothing after the leading syntax to delete
			return tr.startState.update({
				changes: { from: h.to, to: h.to + 1, insert: "" },
				selection: EditorSelection.cursor(h.to),
				scrollIntoView: true,
				userEvent,
				effects: [suppressSuggestAfterDelete.of(h.to)],
			});
		}

		// Deletion inside the range but cursor not at a recognized boundary:
		// redirect to delete char before link (same as backspace-from-inside-left).
		if (h.from === 0) return tr;
		return tr.startState.update({
			changes: { from: h.from - 1, to: h.from, insert: "" },
			selection: EditorSelection.cursor(h.from - 1),
			scrollIntoView: true,
			userEvent,
			effects: [suppressSuggestAfterDelete.of(h.from - 1)],
		});
	}

	return tr;
});

/**
 * Rewrites multi-character or selection-spanning deletes so hidden syntax is
 * never deleted directly while link display text still behaves like Gmail:
 *
 *  - Partial display-text selections delete only the selected visible text.
 *  - Mixed plain-text + link-text selections delete both visible portions
 *    while skipping hidden syntax.
 *  - If a selection covers all visible text of a link, the entire link
 *    (including destination / syntax) is deleted.
 *
 * Single-character cursor deletes are left to deleteAtLinkEndFix /
 * deleteAtLinkStartFix.
 */
function buildVisibleLinkSpans(hidden: HiddenRange[], doc?: EditorState["doc"]): VisibleLinkSpan[] {
	const spans: VisibleLinkSpan[] = [];

	for (let i = 0; i < hidden.length; i += 1) {
		const lead = hidden[i];
		if (lead.side !== "leading") continue;

		const trail = hidden
			.slice(i + 1)
			.find((candidate) => candidate.side === "trailing" && candidate.from >= lead.to);
		if (!trail) continue;

		const line = doc?.lineAt(lead.from);
		if (line && trail.to > line.to) continue;

		spans.push({
			from: lead.from,
			to: trail.to,
			textFrom: lead.to,
			textTo: trail.from,
			leading: lead,
			trailing: trail,
			lineFrom: line?.from ?? lead.from,
			lineTo: line?.to ?? trail.to,
		});
	}

	return spans;
}

function buildLinkSpans(hidden: HiddenRange[]): LinkSpan[] {
	return buildVisibleLinkSpans(hidden).map(({ from, to, textFrom, textTo }) => ({
		from,
		to,
		textFrom,
		textTo,
	}));
}

function findVisibleLinkSpanAtBoundary(
	spans: VisibleLinkSpan[],
	pos: number
): VisibleLinkSpan | null {
	return (
		spans.find(
			(span) =>
				pos === span.leading.from ||
				pos === span.trailing.from ||
				pos === span.trailing.to - 1
		) ?? null
	);
}

function isMarkdownLinkSpan(doc: EditorState["doc"], span: VisibleLinkSpan): boolean {
	const leading = doc.sliceString(span.from, span.textFrom);
	// Markdown links start with "[" but NOT "[[" or "![[" (which are wikilinks).
	// Check that the leading syntax contains "[" but does not start with "[["
	// (after stripping an optional "!" embed prefix).
	const stripped = leading.startsWith("!") ? leading.slice(1) : leading;
	return stripped.startsWith("[") && !stripped.startsWith("[[");
}

function rewriteDeleteChangeForLinks(change: ChangeSpec, links: LinkSpan[]): ChangeSpec[] {
	if (change.insert !== "" || change.from >= change.to) {
		return [change];
	}

	const overlappingLinks = links.filter((link) => change.from < link.to && change.to > link.from);
	if (overlappingLinks.length === 0) {
		return [change];
	}

	const rewritten: ChangeSpec[] = [];
	let cursor = change.from;

	for (const link of overlappingLinks) {
		if (cursor < link.from) {
			const plainTo = Math.min(change.to, link.from);
			if (cursor < plainTo) {
				rewritten.push({ from: cursor, to: plainTo, insert: "" });
			}
		}

		const selectedDisplayFrom = Math.max(change.from, link.textFrom);
		const selectedDisplayTo = Math.min(change.to, link.textTo);
		const overlapsDisplay = selectedDisplayFrom < selectedDisplayTo;
		const deletesEntireDisplay =
			overlapsDisplay &&
			selectedDisplayFrom <= link.textFrom &&
			selectedDisplayTo >= link.textTo;

		if (deletesEntireDisplay) {
			rewritten.push({ from: link.from, to: link.to, insert: "" });
		} else if (overlapsDisplay) {
			rewritten.push({
				from: selectedDisplayFrom,
				to: selectedDisplayTo,
				insert: "",
			});
		}

		cursor = Math.max(cursor, link.to);
	}

	if (cursor < change.to) {
		rewritten.push({ from: cursor, to: change.to, insert: "" });
	}

	return rewritten;
}

function clampDeleteChangeAgainstHidden(change: ChangeSpec, hidden: HiddenRange[]): ChangeSpec[] {
	let { from, to } = change;

	for (const h of hidden) {
		if (from >= to) break;

		if (h.side === "leading") {
			if (from >= h.from && from < h.to) {
				from = h.to;
			} else if (from < h.from && to > h.from) {
				to = Math.min(to, h.from);
			}
		} else {
			if (from >= h.from && from < h.to) {
				from = h.to;
			} else if (from < h.from && to > h.from) {
				to = Math.min(to, h.from);
			}
		}
	}

	return from < to ? [{ from, to, insert: change.insert }] : [];
}

function rewriteDeleteChanges(
	changes: ChangeSpec[],
	hidden: HiddenRange[],
	links: LinkSpan[],
	hasSelectionDelete: boolean
): ChangeSpec[] {
	const rewritten: ChangeSpec[] = [];

	for (const c of changes) {
		if (hasSelectionDelete) {
			rewritten.push(...rewriteDeleteChangeForLinks(c, links));
		} else {
			rewritten.push(...clampDeleteChangeAgainstHidden(c, hidden));
		}
	}

	return rewritten;
}

function changesInteractWithLinks(changes: ChangeSpec[], links: LinkSpan[]): boolean {
	for (const c of changes) {
		for (const link of links) {
			if (c.from < link.to && c.to > link.from) {
				return true;
			}
		}
	}
	return false;
}

const deleteSelectionKeymap = keymap.of([
	{
		key: "Backspace",
		run(view) {
			if (!view.state.field(syntaxHiderEnabledField, false)) return false;
			const sel = view.state.selection;
			if (sel.ranges.every((r) => r.empty)) return false;

			const hidden = view.state.field(hiddenRangesField, false);
			if (!hidden || hidden.length === 0) return false;
			const links = buildLinkSpans(hidden);
			if (links.length === 0) return false;

			const changes = sel.ranges
				.filter((r) => !r.empty)
				.map((r) => ({
					from: Math.min(r.anchor, r.head),
					to: Math.max(r.anchor, r.head),
					insert: "",
				}));

			if (!changesInteractWithLinks(changes, links)) return false;

			const rewritten = rewriteDeleteChanges(changes, hidden, links, true);
			if (rewritten.length === 0) {
				view.dispatch({
					selection: EditorSelection.cursor(sel.main.from),
					scrollIntoView: true,
				});
				return true;
			}

			view.dispatch({
				changes: rewritten,
				selection: EditorSelection.cursor(rewritten[0].from),
				scrollIntoView: true,
			});
			return true;
		},
	},
	{
		key: "Delete",
		run(view) {
			if (!view.state.field(syntaxHiderEnabledField, false)) return false;
			const sel = view.state.selection;
			if (sel.ranges.every((r) => r.empty)) return false;

			const hidden = view.state.field(hiddenRangesField, false);
			if (!hidden || hidden.length === 0) return false;
			const links = buildLinkSpans(hidden);
			if (links.length === 0) return false;

			const changes = sel.ranges
				.filter((r) => !r.empty)
				.map((r) => ({
					from: Math.min(r.anchor, r.head),
					to: Math.max(r.anchor, r.head),
					insert: "",
				}));

			if (!changesInteractWithLinks(changes, links)) return false;

			const rewritten = rewriteDeleteChanges(changes, hidden, links, true);
			if (rewritten.length === 0) {
				view.dispatch({
					selection: EditorSelection.cursor(sel.main.from),
					scrollIntoView: true,
				});
				return true;
			}

			view.dispatch({
				changes: rewritten,
				selection: EditorSelection.cursor(rewritten[0].from),
				scrollIntoView: true,
			});
			return true;
		},
	},
]);

const clampSelectionDeleteFilter = EditorState.transactionFilter.of((tr) => {
	if (!isPureDeleteTransaction(tr)) return tr;
	if (!tr.startState.field(syntaxHiderEnabledField, false)) return tr;
	if (tr.effects.some((e) => e.is(rewrittenSelectionDelete))) return tr;

	const hidden = tr.startState.field(hiddenRangesField, false);
	if (!hidden || hidden.length === 0) return tr;
	const links = buildLinkSpans(hidden);
	if (links.length === 0) return tr;
	const hasSelectionDelete = tr.startState.selection.ranges.some((r) => !r.empty);

	// Collect all changes in the transaction
	const changes: ChangeSpec[] = [];
	let allSingleChar = true;

	tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
		const changeLen = toA - fromA;
		if (changeLen > 1) allSingleChar = false;
		changes.push({ from: fromA, to: toA, insert: inserted.toString() });
	});

	// If every change is ≤1 char and this is not a selection delete,
	// let the single-char boundary filters handle it.
	if (allSingleChar && !hasSelectionDelete) return tr;

	if (!changesInteractWithLinks(changes, links)) return tr;

	// Rebuild the changes. For selection deletes, preserve Gmail-style visible
	// semantics. For non-selection multi-char deletes, keep the old clamping
	// behavior used by kill-word / kill-line style commands.
	const clampedChanges = rewriteDeleteChanges(changes, hidden, links, hasSelectionDelete);

	// If all changes were dropped, return a no-op
	if (clampedChanges.length === 0) return [];

	// If nothing changed after clamping, pass through
	if (clampedChanges.length === changes.length) {
		let identical = true;
		for (let i = 0; i < changes.length; i++) {
			if (
				clampedChanges[i].from !== changes[i].from ||
				clampedChanges[i].to !== changes[i].to ||
				clampedChanges[i].insert !== changes[i].insert
			) {
				identical = false;
				break;
			}
		}
		if (identical) return tr;
	}

	// Place cursor at the start of the first clamped change
	const cursorPos = clampedChanges[0].from;
	const userEvent = tr.annotation(Transaction.userEvent) ?? undefined;

	return tr.startState.update({
		changes: clampedChanges,
		selection: EditorSelection.cursor(cursorPos),
		scrollIntoView: true,
		userEvent,
		effects: hasSelectionDelete ? [rewrittenSelectionDelete.of(null)] : undefined,
	});
});

const protectSyntaxFilter = EditorState.transactionFilter.of((tr) => {
	if (!tr.docChanged) return tr;
	const isPureDelete = isPureDeleteTransaction(tr);
	if (!tr.isUserEvent("input") && !isPureDelete) return tr;
	if (!tr.startState.field(syntaxHiderEnabledField, false)) return tr;
	if (tr.effects.some((e) => e.is(rewrittenSelectionDelete))) return tr;

	// Note: We no longer unconditionally bypass protection for non-empty
	// selections.  clampSelectionDeleteFilter (which runs first) handles
	// selection-spanning deletes by clipping them to display-text only.
	// protectSyntaxFilter is the last-resort safety net.
	//
	// Only bypass if the selection-delete does NOT overlap any hidden range —
	// in that case it's safe plain-text editing and needs no clamping.
	const startSel = tr.startState.selection;
	if (isPureDelete && startSel.ranges.some((r) => !r.empty)) {
		const hidden = tr.startState.field(hiddenRangesField, false);
		if (!hidden || hidden.length === 0) return tr;
		let overlaps = false;
		tr.changes.iterChangedRanges((fromA: number, toA: number) => {
			for (const h of hidden) {
				if (fromA < h.to && toA > h.from) overlaps = true;
			}
		});
		if (!overlaps) return tr; // safe: doesn't touch any hidden syntax
		// Falls through to the protection / blocking logic below
	}

	const hidden = tr.startState.field(hiddenRangesField, false);
	if (!hidden || hidden.length === 0) return tr;

	let dominated = false;
	tr.changes.iterChangedRanges((fromA: number, toA: number) => {
		for (const h of hidden) {
			if (fromA < h.to && toA > h.from) dominated = true;
		}
	});

	if (!dominated) return tr;

	// Allow link-level replacements through (e.g. Obsidian's native [[
	// completion replacing the entire link content).  A "link-level
	// replacement" is a single change that replaces an entire wikilink
	// ([[…]]) or markdown link ([…](…)) with another link of the same
	// type, or that replaces only the visible-text portion of a link
	// even though the change range touches hidden syntax boundaries.
	{
		let isLinkCompletion = true;
		let changeCount = 0;
		tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
			changeCount += 1;
			if (changeCount > 1) {
				isLinkCompletion = false;
				return;
			}
			const insertedText = inserted.toString();
			// Check if the change replaces a full wikilink with another wikilink
			const oldText = tr.startState.doc.sliceString(fromA, toA);
			if (
				oldText.startsWith("[[") &&
				oldText.endsWith("]]") &&
				insertedText.startsWith("[[") &&
				insertedText.endsWith("]]")
			) {
				return; // valid link-level replacement
			}
			if (
				oldText.startsWith("![[") &&
				oldText.endsWith("]]") &&
				insertedText.startsWith("![[") &&
				insertedText.endsWith("]]")
			) {
				return; // valid embed-level replacement
			}
			// Also allow replacements that swap the visible text portion of
			// a link — the inserted text does not contain link syntax and is
			// simply a new note name / display text.
			if (
				!insertedText.includes("[[") &&
				!insertedText.includes("]]") &&
				!insertedText.includes("](") &&
				!insertedText.includes("\n") &&
				insertedText.length > 0
			) {
				// Verify the change range spans only visible text (possibly
				// touching the boundary but not deleting syntax).  This covers
				// the common Obsidian completion pattern of replacing "par"
				// inside [[par]] with "Actual Note Name".
				const links = buildLinkSpans(hidden);
				for (const link of links) {
					if (fromA >= link.textFrom && toA <= link.textTo) {
						return; // change is within visible text — allow
					}
				}
			}
			isLinkCompletion = false;
		});
		if (isLinkCompletion && changeCount > 0) return tr;
	}

	// Safety net: if the blocked transaction contains a newline (Enter
	// key), redirect the insertion to the end of the line so the link
	// is preserved instead of silently swallowing the keypress.
	let newlineText: string | undefined;
	let newlineFrom = -1;
	tr.changes.iterChanges((fromA, _toA, _fromB, _toB, inserted) => {
		const text = inserted.toString();
		if (text.includes("\n")) {
			newlineText = text;
			newlineFrom = fromA;
		}
	});

	if (newlineText !== undefined && newlineFrom >= 0) {
		const line = tr.startState.doc.lineAt(newlineFrom);
		const userEvent = tr.annotation(Transaction.userEvent) ?? undefined;
		return tr.startState.update({
			changes: {
				from: line.to,
				to: line.to,
				insert: newlineText,
			},
			selection: EditorSelection.cursor(line.to + newlineText.length),
			scrollIntoView: true,
			userEvent,
		});
	}

	return [];
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findLinkEndAtPos(lineText: string, lineFrom: number, pos: number): number | null {
	const ranges = [
		...findMarkdownLinkSyntaxRanges(lineText, lineFrom),
		...findWikiLinkSyntaxRanges(lineText, lineFrom),
	];

	for (const r of ranges) {
		if (r.side !== "trailing") continue;
		if (pos < r.from || pos > r.to) continue;
		return r.to;
	}
	return null;
}

/**
 * Find the full link range at a given position (including both leading and trailing syntax).
 * Returns null if no link is found at the position.
 */
export function findLinkRangeAtPos(
	lineText: string,
	lineFrom: number,
	pos: number
): LinkRange | null {
	const ranges = [
		...findMarkdownLinkSyntaxRanges(lineText, lineFrom),
		...findWikiLinkSyntaxRanges(lineText, lineFrom),
	];

	// Group ranges by link (each link has leading and trailing ranges)
	const links = new Map<number, { from: number; to: number }>();

	for (const r of ranges) {
		if (pos < r.from || pos > r.to) continue;

		// Find all ranges for this link by looking for adjacent ranges
		let linkStart = r.from;
		let linkEnd = r.to;

		// Look for the leading range if this is trailing
		if (r.side === "trailing") {
			for (const other of ranges) {
				if (other.side === "leading" && other.to <= r.from) {
					// Check if they're part of the same link (no significant gap)
					const textBetween = lineText.substring(other.to - lineFrom, r.from - lineFrom);
					if (!textBetween.includes("\n") && textBetween.length < 1000) {
						linkStart = Math.min(linkStart, other.from);
					}
				}
			}
		}

		// Look for the trailing range if this is leading
		if (r.side === "leading") {
			for (const other of ranges) {
				if (other.side === "trailing" && other.from >= r.to) {
					const textBetween = lineText.substring(r.to - lineFrom, other.from - lineFrom);
					if (!textBetween.includes("\n") && textBetween.length < 1000) {
						linkEnd = Math.max(linkEnd, other.to);
					}
				}
			}
		}

		return { from: linkStart, to: linkEnd };
	}

	return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function createLinkSyntaxHiderExtension() {
	// CM6 applies transactionFilters in REVERSE registration order
	// (last registered runs first). Desired execution order:
	//   1. deleteAtLinkEndFix   — single-char backspace/del at right edge
	//   2. deleteAtLinkStartFix — single-char backspace/del at left edge
	//   3. clampSelectionDeleteFilter — multi-char and selection deletes
	//   4. protectSyntaxFilter  — last-resort safety net
	//
	// To achieve this, list them in REVERSE order in the array:
	return [
		syntaxHiderEnabledField,
		suppressNextBoundaryInputField,
		arrivedAtTextFromFromOutsideField,
		syntaxHiderModePlugin,
		hiddenRangesField,
		bodyClassPlugin,
		temporarilyVisibleLinkField,
		Prec.highest(hiddenSyntaxReplacePlugin),
		Prec.highest(cursorCorrector),
		Prec.highest(suppressSuggestAfterDeleteListener),
		Prec.highest(boundaryInputSuppressor),
		Prec.highest(homeKeyKeymap),
		Prec.highest(deleteSelectionKeymap),
		Prec.highest(deleteInLinkTextKeymap),
		Prec.highest(enterAtLinkEndKeymap),
		Prec.highest(enterAtLinkEndFix),
		Prec.highest(suppressNextBoundaryInputFilter),
		Prec.highest(suppressSuggestAfterVisibleDeleteFilter),
		Prec.highest(insertAtLinkStartFix),
		Prec.highest(protectSyntaxFilter),
		Prec.highest(clampSelectionDeleteFilter),
		Prec.highest(deleteAtLinkEndFix),
		Prec.highest(deleteAtLinkStartFix),
	];
}

export {
	findMarkdownLinkSyntaxRanges,
	findWikiLinkSyntaxRanges,
	computeHiddenRanges,
	correctCursorPos,
	handleHomeKey,
	createHiddenSyntaxAnchor,
	listContinuation,
	findLinkEndAtPos,
	setTemporarilyVisibleLink,
	temporarilyVisibleLinkField,
	enterAtLinkEndFix,
	deleteAtLinkEndFix,
	deleteAtLinkStartFix,
	clampSelectionDeleteFilter,
	syntaxHiderEnabledField,
	hiddenRangesField,
	setSyntaxHiderEnabled,
	isMarkdownLinkSpan,
	buildVisibleLinkSpans,
};
export type { HiddenRange, LinkRange, VisibleLinkSpan };
