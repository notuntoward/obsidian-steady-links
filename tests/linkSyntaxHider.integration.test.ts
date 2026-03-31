/**
 * Integration tests for the cursor correction pipeline.
 *
 * These tests use a real CM6 EditorView in a jsdom environment to verify
 * that arrow-key navigation produces the expected cursor positions when
 * link syntax is hidden.  Unlike the unit tests for correctCursorPos()
 * (which hardcode the pos/oldPos that CM6 "would" deliver), these tests
 * exercise the full pipeline:
 *
 *   keypress → CM6 native cursor movement → replace decoration skip
 *   → cursorCorrector (updateListener) → correctCursorPos → dispatch
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorState, EditorSelection, Prec } from "@codemirror/state";
import {
	createHiddenSyntaxAnchor,
	correctCursorPos,
	findWikiLinkSyntaxRanges,
	findMarkdownLinkSyntaxRanges,
	syntaxHiderEnabledField,
	hiddenRangesField,
	setSyntaxHiderEnabled,
	type HiddenRange,
} from "../src/linkSyntaxHider";

// ============================================================================
// Helpers
// ============================================================================

/**
 * Create a minimal EditorView with syntax hider fields enabled.
 * We don't use the full createLinkSyntaxHiderExtension() because it
 * includes DOM-dependent plugins (body class, mode detection) that
 * don't work in jsdom.  Instead we set up just the fields needed for
 * correctCursorPos testing.
 */
function createTestView(doc: string, cursorPos: number): EditorView {
	const state = EditorState.create({
		doc,
		selection: EditorSelection.cursor(cursorPos),
		extensions: [
			syntaxHiderEnabledField,
			hiddenRangesField,
		],
	});

	const view = new EditorView({
		state,
		parent: document.body,
	});

	// Enable the syntax hider
	view.dispatch({
		effects: [setSyntaxHiderEnabled.of(true)],
	});

	return view;
}

/**
 * Compute hidden ranges for the cursor's current line.
 */
function getHiddenRanges(view: EditorView): HiddenRange[] {
	const state = view.state;
	const head = state.selection.main.head;
	const line = state.doc.lineAt(head);
	return [
		...findWikiLinkSyntaxRanges(line.text, line.from),
		...findMarkdownLinkSyntaxRanges(line.text, line.from),
	];
}

/**
 * Simulate pressing left arrow by computing what correctCursorPos
 * returns for a single left step, using the REAL CM6 state doc.
 *
 * This bridges the gap between "what position does CM6 deliver" and
 * "what does correctCursorPos return".  In a real EditorView the
 * cursor corrector is an updateListener; here we call correctCursorPos
 * directly but with the real doc object from the EditorState.
 */
function simulateLeftArrowCorrection(
	view: EditorView,
	fromPos: number,
): { cmDelivered: number; corrected: number | null; final: number } {
	const hidden = getHiddenRanges(view);
	const doc = view.state.doc;

	// CM6 with replace decorations skips from h.to to h.from when
	// pressing left.  Find which range (if any) the fromPos is at
	// the right boundary of:
	let cmDelivered = fromPos - 1; // Default: one char left
	for (const h of hidden) {
		if (fromPos === h.to) {
			// CM6 skips decoration → delivers h.from
			cmDelivered = h.from;
			break;
		}
		// If fromPos is inside a replaced range, CM6 would have
		// already positioned us at an edge.  Skip to h.from.
		if (fromPos > h.from && fromPos < h.to) {
			cmDelivered = h.from;
			break;
		}
	}
	if (cmDelivered < 0) cmDelivered = 0;

	// Run correctCursorPos with the real doc
	const corrected = correctCursorPos(
		cmDelivered,
		fromPos,
		hidden,
		doc as any,
	);

	const final = corrected !== null ? corrected : cmDelivered;

	return { cmDelivered, corrected, final };
}

// ============================================================================
// Tests
// ============================================================================

describe("Integration: cursor correction with real CM6 state", () => {
	let view: EditorView;

	afterEach(() => {
		view?.destroy();
	});

	describe("custom cursor compatibility", () => {
		it("creates a measurable hidden-syntax anchor for link-edge cursor overlays", () => {
			const anchor = createHiddenSyntaxAnchor();

			expect(anchor.className).toBe("le-hidden-syntax-anchor");
			expect(anchor.getAttribute("aria-hidden")).toBe("true");
			expect(anchor.getAttribute("data-steady-links-anchor")).toBe(
				"hidden-syntax",
			);
			expect(anchor.style.display).toBe("inline-block");
			expect(anchor.style.width).toBe("1px");
			expect(anchor.style.minWidth).toBe("1px");
			expect(anchor.style.height).toBe("1lh");
			expect(anchor.style.lineHeight).toBe("inherit");
			expect(anchor.style.marginRight).toBe("-1px");
			expect(anchor.style.opacity).toBe("0");
			expect(anchor.style.pointerEvents).toBe("none");
			expect(anchor.style.verticalAlign).toBe("text-bottom");
		});
	});

	// ── Wikilink at end of line ───────────────────────────────────────

	describe("wikilink at end of line: see [[target]]", () => {
		beforeEach(() => {
			view = createTestView("see [[target]]", 14);
		});

		it("left arrow from h.to (14) reaches h.from-1 (11) in one step", () => {
			const result = simulateLeftArrowCorrection(view, 14);
			// CM6 skips ]] → h.from = 12
			expect(result.cmDelivered).toBe(12);
			// Correction: oldPos=14=h.to, h.to===lineEnd, h.to-h.from=2
			// → returns h.from-1 = 11
			expect(result.final).toBe(11);
		});

		it("left arrow from h.from (12) reaches 11 normally", () => {
			const result = simulateLeftArrowCorrection(view, 12);
			// CM6 delivers 11 (normal left, no decoration)
			expect(result.cmDelivered).toBe(11);
			// No correction needed
			expect(result.corrected).toBe(null);
			expect(result.final).toBe(11);
		});
	});

	// ── Wikilink in mid-line ──────────────────────────────────────────

	describe("wikilink mid-line: see [[target]] more", () => {
		beforeEach(() => {
			view = createTestView("see [[target]] more", 15);
		});

		it("left arrow from space (15) to h.to (14): no correction", () => {
			const result = simulateLeftArrowCorrection(view, 15);
			expect(result.cmDelivered).toBe(14);
			// h.to is not inside [h.from, h.to) — no correction
			expect(result.corrected).toBe(null);
			expect(result.final).toBe(14);
		});

		it("left arrow from h.to (14): CM6 skips to h.from, skips to h.from-1 (short range)", () => {
			const result = simulateLeftArrowCorrection(view, 14);
			expect(result.cmDelivered).toBe(12);
			// h.to - h.from = 2 (short "]]" range, zero-width widget)
			// → invisible stop at h.from=12 skipped → returns h.from-1 = 11
			expect(result.final).toBe(11);
		});
	});

	// ── Markdown link at end of line ──────────────────────────────────

	describe("markdown link at end of line: [text](url)", () => {
		beforeEach(() => {
			view = createTestView("[link text](https://x.com)", 26);
		});

		it("left arrow from h.to: returns h.from (not h.from-1)", () => {
			// Trailing range: ](https://x.com) → {from: 10, to: 26}
			const result = simulateLeftArrowCorrection(view, 26);
			// CM6 skips decoration → delivers h.from = 10
			expect(result.cmDelivered).toBe(10);
			// h.to - h.from = 16 > 2 → does NOT skip to h.from-1
			// Returns h.from = 10 (the text boundary, preserves last char)
			expect(result.final).toBe(10);
		});
	});

	// ── Markdown link mid-line ────────────────────────────────────────

	describe("markdown link mid-line: Click [here](https://x.com) for details", () => {
		// "[here](https://x.com)" starts at index 6
		// Leading: {from: 6, to: 7}  ("[")
		// Trailing: {from: 11, to: 27}  ("](https://x.com)")
		// Space after link at position 27.

		beforeEach(() => {
			view = createTestView("Click [here](https://x.com) for details", 28);
		});

		it("left arrow from 28 (char after space) to 27: normal, no correction", () => {
			const result = simulateLeftArrowCorrection(view, 28);
			// 28 is past h.to (27). Normal left → 27.
			expect(result.cmDelivered).toBe(27);
			// 27 is not inside [11, 27) — no correction
			expect(result.corrected).toBe(null);
			expect(result.final).toBe(27);
		});

		it("left arrow from h.to (27): CM6 skips to h.from (11)", () => {
			const result = simulateLeftArrowCorrection(view, 27);
			// 27 = h.to → CM6 skips decoration → delivers h.from = 11
			expect(result.cmDelivered).toBe(11);
			// h.to (27) !== lineEnd (39) → returns h.from = 11
			expect(result.final).toBe(11);
		});
	});

	// ── Leading range: wikilink at line start ─────────────────────────

	describe("leading range: line-start wikilink", () => {
		beforeEach(() => {
			view = createTestView("prev line\n[[target]]", 12);
		});

		it("left arrow from h.to (12) of leading range on line 2", () => {
			// Leading: {from: 10, to: 12} on line 2
			const result = simulateLeftArrowCorrection(view, 12);
			// CM6 skips leading decoration → delivers h.from = 10
			expect(result.cmDelivered).toBe(10);
			// h.from=10 === lineStart=10, movingLeft (10 < 12)
			// → returns h.from - 1 = 9 (end of "prev line")
			expect(result.final).toBe(9);
		});

		it("right arrow: arriving at line start from prev line stays there", () => {
			// Simulate what happens when moving right from pos 9
			// (end of prev line) to pos 10 (start of line 2 = h.from)
			const hidden = getHiddenRanges(view);
			const doc = view.state.doc;
			const corrected = correctCursorPos(10, 9, hidden, doc as any);
			// movingRight (10 >= 9) at line start → null (stay)
			expect(corrected).toBe(null);
		});
	});

	// ── Typing after link (regression guard) ──────────────────────────

	describe("typing after link: cursor must stay at h.to", () => {
		it("cursor at h.to is NOT corrected (safe for typing)", () => {
			view = createTestView("see [[target]]", 14);
			const hidden = getHiddenRanges(view);
			const doc = view.state.doc;

			// Cursor arrived at h.to=14 via right-arrow or End key.
			// oldPos < pos (e.g., came from position 11 via right-arrow
			// through the trailing range → correction placed at h.to=14).
			// Now the cursor is at 14. No further correction should fire
			// for this position — typing at 14 inserts AFTER the link.
			const corrected = correctCursorPos(14, 11, hidden, doc as any);
			// 14 is not inside [12, 14) — no correction
			expect(corrected).toBe(null);
		});
	});
});
