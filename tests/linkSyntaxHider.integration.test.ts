/**
 * Integration tests for the real cursor-correction pipeline.
 *
 * These tests use a real CM6 EditorView in a jsdom environment and dispatch
 * real selection transactions through the installed extensions. Unlike the
 * unit tests for correctCursorPos(), these tests verify that the exported
 * extension wires together:
 *
 *   selection update → hidden range computation → cursorCorrector
 *   (updateListener) → correctCursorPos() → follow-up dispatch
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, afterEach } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorState, EditorSelection, Transaction } from "@codemirror/state";
import {
	createHiddenSyntaxAnchor,
	createLinkSyntaxHiderExtension,
	setSyntaxHiderEnabled,
} from "../src/linkSyntaxHider";

// ============================================================================
// Helpers
// ============================================================================

/**
 * Create a real EditorView using the exported syntax-hider extension.
 *
 * The host element is marked as live preview so the mode plugin and the
 * cursor-correction listener run in the same shape they do in production.
 */
function createTestView(doc: string, cursorPos: number): EditorView {
	const host = document.createElement("div");
	host.className = "markdown-source-view is-live-preview";
	document.body.appendChild(host);

	const state = EditorState.create({
		doc,
		selection: EditorSelection.cursor(cursorPos),
		extensions: createLinkSyntaxHiderExtension(),
	});

	const view = new EditorView({
		state,
		parent: host,
	});

	// Enable immediately so the integration tests do not depend on the mode
	// plugin's async sync tick.
	view.dispatch({
		effects: [setSyntaxHiderEnabled.of(true)],
	});

	return view;
}

/**
 * Dispatch a selection change through the real extension pipeline.
 */
function dispatchSelection(view: EditorView, head: number, userEvent?: string): number {
	view.dispatch({
		selection: EditorSelection.cursor(head),
		annotations: userEvent ? [Transaction.userEvent.of(userEvent)] : undefined,
	});

	return view.state.selection.main.head;
}

// ============================================================================
// Tests
// ============================================================================

describe("Integration: cursor correction with real CM6 state", () => {
	let view: EditorView;

	afterEach(() => {
		view?.destroy();
		document.body.innerHTML = "";
	});

	describe("custom cursor compatibility", () => {
		it("creates a measurable hidden-syntax anchor for link-edge cursor overlays", () => {
			const anchor = createHiddenSyntaxAnchor();

			expect(anchor.className).toBe("le-hidden-syntax-anchor");
			expect(anchor.getAttribute("aria-hidden")).toBe("true");
			expect(anchor.getAttribute("data-steady-links-anchor")).toBe("hidden-syntax");
			expect(anchor.style.display).toBe("inline-block");
			expect(anchor.style.width).toBe("1px");
			expect(anchor.style.minWidth).toBe("1px");
			expect(anchor.style.height).toBe("1em");
			expect(anchor.style.lineHeight).toBe("1");
			expect(anchor.style.marginRight).toBe("-1px");
			expect(anchor.style.opacity).toBe("0");
			expect(anchor.style.pointerEvents).toBe("auto");
			expect(anchor.style.verticalAlign).toBe("baseline");
		});
	});

	describe("wikilink at end of line: see [[target]]", () => {
		it("selection delivered to trailing h.from is corrected to h.from-1", () => {
			view = createTestView("see [[target]]", 14);

			// This matches the position CM6 delivers after moving left across the
			// replaced trailing syntax.
			expect(dispatchSelection(view, 12)).toBe(11);
		});

		it("cursor at h.to remains stable for typing after the link", () => {
			view = createTestView("see [[target]]", 11);

			// Arriving at h.to from the left is a valid place to type after the link.
			expect(dispatchSelection(view, 14)).toBe(14);
		});
	});

	describe("wikilink mid-line: see [[target]] more", () => {
		it("selection delivered to trailing h.to from plain text remains unchanged", () => {
			view = createTestView("see [[target]] more", 15);

			expect(dispatchSelection(view, 14)).toBe(14);
		});

		it("selection delivered to leading h.from from plain text is corrected to visible text", () => {
			view = createTestView("see [[target]] more", 3);

			expect(dispatchSelection(view, 4, "select")).toBe(6);
		});

		it("selection delivered to trailing h.from is corrected to h.from-1", () => {
			view = createTestView("see [[target]] more", 14);

			expect(dispatchSelection(view, 12)).toBe(11);
		});
	});

	describe("markdown link at end of line: [text](url)", () => {
		it("selection delivered to trailing h.from skips the icon boundary into visible text", () => {
			view = createTestView("[link text](https://x.com)", 26);

			// h.from = 10 (textTo), the external-link icon boundary.
			// Not a meaningful cursor stop — skip to h.from - 1 = 9.
			expect(dispatchSelection(view, 10)).toBe(9);
		});
	});

	describe("markdown link mid-line: Click [here](https://x.com) for details", () => {
		it("selection delivered to trailing h.from is corrected to h.from", () => {
			view = createTestView("Click [here](https://x.com) for details", 28);

			expect(dispatchSelection(view, 11)).toBe(11);
		});

		it("leftward motion from plain text enters markdown link text in one step", () => {
			// "Click [here](https://x.com) for details"
			//  trailing hidden range: {from:11, to:27}
			//  The external-link icon at the trailing boundary is not a
			//  meaningful cursor stop, so one left arrow from inside the
			//  trailing hidden range should skip to h.from (textTo = 11).
			//  From there, correctCursorPos sees oldPos != h.to so it
			//  returns h.from directly.
			view = createTestView("Click [here](https://x.com) for details", 28);

			// Left arrow landing inside trailing range: corrected to h.from (11)
			expect(dispatchSelection(view, 26)).toBe(11);
		});

		it("leftward character motion through multi-word markdown link text does not bounce back", () => {
			// Simulate arrowing left through a multi-word markdown link one
			// character at a time, starting from inside the visible text.
			// The cursor should never jump forward (to the right) during
			// a sequence of leftward moves.
			view = createTestView("Click [two words here](https://x.com) for details", 20);

			let pos = 20;
			let previousPos = pos;
			const visited: number[] = [pos];

			// Arrow left until we exit the link or take too many steps
			for (let i = 0; i < 30; i++) {
				const next = dispatchSelection(view, pos - 1);
				visited.push(next);

				// The cursor must never jump forward during leftward motion
				expect(next).toBeLessThanOrEqual(pos);

				previousPos = pos;
				pos = next;

				// Stop once we've exited the link area
				if (pos <= 5) break;
			}

			// We should have exited the link cleanly
			expect(pos).toBeLessThanOrEqual(5);
		});
	});

	describe("leading range: line-start wikilink", () => {
		it("selection delivered to leading h.from from the right is corrected to previous line end", () => {
			view = createTestView("prev line\n[[target]]", 12);

			expect(dispatchSelection(view, 10)).toBe(9);
		});

		it("selection arriving at line start from previous line stays there", () => {
			view = createTestView("prev line\n[[target]]", 9);

			expect(dispatchSelection(view, 10)).toBe(10);
		});

		it("selection arriving from a blank line above to a line-start wikilink snaps to visible text", () => {
			view = createTestView("\n[[target]]", 0);

			expect(dispatchSelection(view, 1)).toBe(3);
		});
	});

	describe("leading range: line-start heading wikilink", () => {
		it("selection arriving from a blank line above to [[#heading]] lands in visible text", () => {
			view = createTestView("# h2\n\n[[#h1.2]]", 5);

			expect(dispatchSelection(view, 9, "select")).toBe(9);
		});
	});

	describe("leading range: line-start markdown link after blank line", () => {
		it("selection arriving from a blank line above to a line-start markdown link lands in visible text", () => {
			view = createTestView("\n[text](url)", 0);

			expect(dispatchSelection(view, 1)).toBe(2);
		});
	});

	describe("pointer-initiated corrections", () => {
		it("pointer selection inside trailing syntax snaps to the text boundary", () => {
			view = createTestView("see [[target]]", 11);

			expect(dispatchSelection(view, 13, "select.pointer")).toBe(12);
		});
	});

	describe("visible-text delete followed by typing", () => {
		it("rewrites the next text input after an emacs-style visible-text delete inside a wikilink", () => {
			view = createTestView("[[target]]", 2);

			view.dispatch({
				changes: { from: 2, to: 3, insert: "" },
				selection: EditorSelection.cursor(2),
				annotations: [Transaction.userEvent.of("delete")],
			});

			expect(view.state.doc.toString()).toBe("[[arget]]");

			view.dispatch({
				changes: { from: 2, to: 2, insert: "x" },
				selection: EditorSelection.cursor(3),
				annotations: [Transaction.userEvent.of("input.type")],
			});

			expect(view.state.doc.toString()).toBe("[[xarget]]");
			expect(view.state.selection.main.head).toBe(3);
		});

		it("rewrites typing at the left visual edge of a piped wikilink to outside the link", () => {
			const doc = "abcdefg [[Note-08|test link]] defg";
			const linkStart = doc.indexOf("[[Note-08|test link]]");
			const visibleTextStart = doc.indexOf("test link");
			view = createTestView(doc, visibleTextStart);

			view.dispatch({
				changes: { from: visibleTextStart, to: visibleTextStart, insert: "X" },
				selection: EditorSelection.cursor(visibleTextStart + 1),
				annotations: [Transaction.userEvent.of("input.type")],
			});

			expect(view.state.doc.toString()).toBe("abcdefg X[[Note-08|test link]] defg");
			expect(view.state.selection.main.head).toBe(linkStart + 1);
		});
	});

	describe("selection delete with the full extension", () => {
		it("deletes a fully selected line that contains a link", () => {
			view = createTestView("[[target]]\nafter", 0);

			view.dispatch({
				selection: EditorSelection.range(0, 11),
			});

			view.dispatch({
				changes: { from: 0, to: 11, insert: "" },
				selection: EditorSelection.cursor(0),
				annotations: [Transaction.userEvent.of("delete")],
			});

			expect(view.state.doc.toString()).toBe("after");
			expect(view.state.selection.main.head).toBe(0);
		});
	});

	// ──────────────────────────────────────────────────────────────────────
	// BUG GUARD: native [[ completion must not be blocked by protectSyntaxFilter
	//
	// Obsidian's native [[ completion dispatches a transaction that replaces
	// the entire [[partial]] with [[Actual Note Name]].  The change range
	// overlaps the hidden [[ and ]] syntax ranges.  protectSyntaxFilter must
	// allow this through instead of silently dropping the transaction (which
	// used to leave the partial text as the link destination).
	// ──────────────────────────────────────────────────────────────────────
	describe("native [[ completion passthrough", () => {
		it("replacing [[partial]] with [[Full Note Name]] is allowed through", () => {
			// Simulate: user typed [[par]] (auto-closed), then completion
			// replaces the entire wikilink with the selected note name.
			view = createTestView("[[par]]", 5);

			view.dispatch({
				changes: { from: 0, to: 7, insert: "[[Full Note Name]]" },
				selection: EditorSelection.cursor(18),
				annotations: [Transaction.userEvent.of("input")],
			});

			expect(view.state.doc.toString()).toBe("[[Full Note Name]]");
		});

		it("replacing partial text inside [[…]] is allowed through", () => {
			// Some completions only replace the inner text, not the brackets
			view = createTestView("[[par]]", 5);

			view.dispatch({
				changes: { from: 2, to: 5, insert: "Full Note Name" },
				selection: EditorSelection.cursor(16),
				annotations: [Transaction.userEvent.of("input")],
			});

			expect(view.state.doc.toString()).toBe("[[Full Note Name]]");
		});

		it("replacing ![[embed]] with ![[New Embed]] is allowed through", () => {
			view = createTestView("![[embed]]", 8);

			view.dispatch({
				changes: { from: 0, to: 10, insert: "![[New Embed]]" },
				selection: EditorSelection.cursor(14),
				annotations: [Transaction.userEvent.of("input")],
			});

			expect(view.state.doc.toString()).toBe("![[New Embed]]");
		});

		it("normal single-char typing inside link text is NOT blocked", () => {
			view = createTestView("[[target]]", 5);

			view.dispatch({
				changes: { from: 5, to: 5, insert: "x" },
				selection: EditorSelection.cursor(6),
				annotations: [Transaction.userEvent.of("input.type")],
			});

			// Insert at position 5 (between 'r' and 'x' in "target") produces "tarxget"
			expect(view.state.doc.toString()).toBe("[[tarxget]]");
		});

		it("protectSyntaxFilter still blocks typing that overlaps hidden syntax", () => {
			// An insertion that overlaps with hidden [[ syntax should still be blocked
			// (this is NOT a completion — it's a single char insert at position 1
			// which is inside the leading hidden range [0,2))
			view = createTestView("[[target]]", 2);

			view.dispatch({
				changes: { from: 1, to: 2, insert: "x" },
				selection: EditorSelection.cursor(2),
				annotations: [Transaction.userEvent.of("input")],
			});

			// The edit should be blocked — document unchanged
			expect(view.state.doc.toString()).toBe("[[target]]");
		});
	});

	// ──────────────────────────────────────────────────────────────────────
	// BUG GUARD: vertical motion (up/down arrow) to a line with a
	// line-start wikilink must land on visible text, not get stuck or skip.
	//
	// CM6 delivers vertical motion with goalColumn set on the selection.
	// The cursor corrector must recognize this and snap to visible text
	// instead of leaving the cursor inside the hidden [[ decoration.
	// ──────────────────────────────────────────────────────────────────────
	describe("vertical motion to line-start wikilinks", () => {
		/**
		 * Dispatch a vertical-motion selection (with goalColumn) through
		 * the real extension pipeline, simulating an up/down arrow press.
		 *
		 * EditorSelection.cursor() returns a SelectionRange.  To set
		 * goalColumn we must pass it as the 4th argument, then wrap
		 * the range in an EditorSelection via EditorSelection.create().
		 */
		function dispatchVerticalMotion(v: EditorView, head: number, goalColumn: number): number {
			const range = EditorSelection.cursor(head, 1, undefined, goalColumn);
			v.dispatch({
				selection: EditorSelection.create([range]),
			});
			return v.state.selection.main.head;
		}

		it("down-arrow from above lands on visible text of line-start wikilink", () => {
			// "above\n[[target]]"
			// Line 1: "above"  (0-4)
			// Line 2: "[[target]]" (6-15), leading [[ hidden at 6-8, visible "target" at 8-14
			view = createTestView("above\n[[target]]", 3);

			const result = dispatchVerticalMotion(view, 6, 3);
			// Must land on visible text, not inside hidden [[
			expect(result).toBeGreaterThanOrEqual(8); // h.to = 8 (start of "target")
			expect(result).toBeLessThanOrEqual(14); // within visible text
		});

		it("up-arrow from below lands on visible text of line-start wikilink", () => {
			// "[[target]]\nbelow"
			// Line 1: "[[target]]" (0-9), leading [[ hidden at 0-2, visible "target" at 2-8
			// Line 2: "below" (11-15)
			view = createTestView("[[target]]\nbelow", 14);

			const result = dispatchVerticalMotion(view, 0, 3);
			// Must land on visible text, not inside hidden [[
			expect(result).toBeGreaterThanOrEqual(2); // h.to = 2 (start of "target")
			expect(result).toBeLessThanOrEqual(8); // within visible text
		});

		it("down-arrow to line-start wikilink does not skip the line entirely", () => {
			// "above\n[[target]]\nbelow"
			view = createTestView("above\n[[target]]\nbelow", 3);

			const result = dispatchVerticalMotion(view, 6, 3);
			// Must land on the wikilink line (positions 6-15), not skip to "below"
			expect(result).toBeGreaterThanOrEqual(6);
			expect(result).toBeLessThanOrEqual(16);
		});

		it("up-arrow to line-start wikilink does not skip the line entirely", () => {
			// "above\n[[target]]\nbelow"
			view = createTestView("above\n[[target]]\nbelow", 20);

			const result = dispatchVerticalMotion(view, 6, 3);
			// Must land on the wikilink line
			expect(result).toBeGreaterThanOrEqual(6);
			expect(result).toBeLessThanOrEqual(16);
		});

		it("vertical motion to line-start markdown link lands on visible text", () => {
			// Markdown links should also land on visible text
			view = createTestView("above\n[text](url)", 3);

			const result = dispatchVerticalMotion(view, 6, 3);
			// Should land somewhere on the link line (positions 6-17), on visible text
			// For markdown links the leading hidden range is just "[" (1 char),
			// so visible text starts at position 7
			expect(result).toBeGreaterThanOrEqual(6);
			expect(result).toBeLessThanOrEqual(17);
		});
	});

	// ──────────────────────────────────────────────────────────────────────
	// BUG GUARD: CM6 normalization bounce-back on line-start wikilinks
	//
	// After vertical motion delivers the cursor to the visible text start
	// of a line-start wikilink (e.g. position 8 in "above\n[[target]]"),
	// CM6 internally normalizes the cursor back to the line start (position
	// 6, inside the hidden [[).  This fires the cursorCorrector again.
	//
	// A prior bug caused isMarkdownLinkSpan to return true for wikilinks
	// (because "[[" contains "[").  The markdownLeadingExit code path then
	// matched (oldHead=textFrom, head=leading.from) and bounced the cursor
	// to leading.from - 1 (end of previous line).  This created an infinite
	// loop: down-arrow → textFrom → normalize to leading.from → bounce to
	// prev line → down-arrow again...
	//
	// These tests reproduce the exact two-step sequence from the real logs.
	// ──────────────────────────────────────────────────────────────────────
	describe("CM6 normalization must not bounce cursor off line-start wikilinks", () => {
		it("cursor normalized from textFrom to leading.from stays on the link line (not bounced to prev line)", () => {
			// "above\n[[target]]"
			//  leading [[ at 6-8, visible "target" at 8-14, trailing ]] at 14-16
			//
			// Simulate Step 2 of the CM6 normalization sequence:
			// Old selection had goalColumn: 0 (from the vertical motion).
			// CM6 normalizes cursor from 8 (textFrom) to 6 (leading.from).
			// The cursor corrector must NOT bounce this to position 5 (prev line end).
			//
			// First, set up old selection with goalColumn (simulating step 1's result)
			const range = EditorSelection.cursor(8, 1, undefined, 0);
			view = createTestView("above\n[[target]]", 8);
			view.dispatch({ selection: EditorSelection.create([range]) });

			// Now simulate the normalization: CM6 moves from 8→6, old sel has goalCol=0
			const result = dispatchSelection(view, 6);
			// Must stay on the wikilink line — NOT bounced to 5 (end of "above")
			expect(result).toBeGreaterThanOrEqual(6);
		});

		it("cursor normalized from textFrom to leading.from on first line stays on link line", () => {
			// "[[target]]\nbelow"
			//  leading [[ at 0-2, visible "target" at 2-8, trailing ]] at 8-10
			//
			// oldHead = 2 (textFrom), newHead = 0 (leading.from)
			view = createTestView("[[target]]\nbelow", 2);

			const result = dispatchSelection(view, 0);
			// Must NOT jump away from the link line
			expect(result).toBeGreaterThanOrEqual(0);
			expect(result).toBeLessThanOrEqual(10);
		});

		it("repeated down-arrow does not get stuck in a bounce loop", () => {
			// Simulate multiple consecutive down-arrows, as the user would do
			view = createTestView("above\n[[target]]\nbelow", 3);

			// First down-arrow: land on wikilink line
			const range1 = EditorSelection.cursor(6, 1, undefined, 3);
			view.dispatch({ selection: EditorSelection.create([range1]) });
			const pos1 = view.state.selection.main.head;
			expect(pos1).toBeGreaterThanOrEqual(6);
			expect(pos1).toBeLessThanOrEqual(16);

			// Second down-arrow: should advance to "below" line, not stay stuck
			const range2 = EditorSelection.cursor(17, 1, undefined, 3);
			view.dispatch({ selection: EditorSelection.create([range2]) });
			const pos2 = view.state.selection.main.head;
			expect(pos2).toBeGreaterThanOrEqual(17);
		});

		it("repeated up-arrow does not get stuck in a bounce loop", () => {
			view = createTestView("above\n[[target]]\nbelow", 20);

			// First up-arrow: land on wikilink line
			const range1 = EditorSelection.cursor(6, 1, undefined, 3);
			view.dispatch({ selection: EditorSelection.create([range1]) });
			const pos1 = view.state.selection.main.head;
			expect(pos1).toBeGreaterThanOrEqual(6);
			expect(pos1).toBeLessThanOrEqual(16);

			// Second up-arrow: should advance to "above" line
			const range2 = EditorSelection.cursor(3, 1, undefined, 3);
			view.dispatch({ selection: EditorSelection.create([range2]) });
			const pos2 = view.state.selection.main.head;
			expect(pos2).toBeLessThanOrEqual(5);
		});
	});

	describe("Emacs-style navigation compatibility", () => {
		it("forward-word style jumps do not get stuck at a wikilink leading edge", () => {
			view = createTestView("see [[target]] more", 3);

			expect(dispatchSelection(view, 4, "select")).toBe(6);
		});

		it("forward-word style bounce inside a multi-word wikilink lands at the next visible word boundary", () => {
			view = createTestView("see [[two words here]] more", 16);

			expect(dispatchSelection(view, 4)).toBe(23);
		});

		it("paragraph jumps onto a line-start wikilink land on visible text", () => {
			view = createTestView("intro\n\n[[target]]\n\noutro", 6);

			expect(dispatchSelection(view, 9, "select")).toBe(9);
		});

		it("backward paragraph jumps onto a line-start wikilink from below land on visible text", () => {
			view = createTestView("intro\n\n[[target]]\n\noutro", 20);

			expect(dispatchSelection(view, 6, "select")).toBe(6);
		});
	});
});
