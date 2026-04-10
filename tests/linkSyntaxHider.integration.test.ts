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
	handleHomeKey,
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
			expect(anchor.style.verticalAlign).toBe("-0.2em");
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

		it("cursorCorrector: cursor arriving at h.from from outside the link snaps to h.to (textFrom)", () => {
			// When cursor jumps from outside the link (past span.to) directly
			// to h.from=lineStart (e.g. Emacs Ctrl+A via editor.setCursor),
			// the corrector redirects to span.textFrom so the cursor lands on
			// visible text rather than inside the hidden [[ syntax.
			const doc = "prev line\n[[target]] bob jane";
			view = createTestView(doc, 28);
			expect(dispatchSelection(view, 10)).toBe(12); // snaps to h.to=textFrom
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

	describe("leading range: line-start markdown link Home key (same fix as wikilink)", () => {
		it("cursorCorrector: markdown link at line start snaps to h.to when arriving from outside on same line", () => {
			// Emacs Ctrl+A (or any editor.setCursor to ch:0) from outside the link
			// is caught by the corrector and redirected to h.to=textFrom.
			const doc = "prev line\n[text](url) bob jane";
			view = createTestView(doc, 29);
			expect(dispatchSelection(view, 10)).toBe(11); // snaps to h.to (after "[")
		});
	});

	describe("homeKeyKeymap: handleHomeKey direct tests", () => {
		it("Home key from outside wikilink snaps cursor to h.to (visible text start)", () => {
			// [[target]]: leading {from:10, to:12}
			// Cursor starts at end of "jane" (pos 28), outside the link.
			const doc = "prev line\n[[target]] bob jane";
			view = createTestView(doc, 28);

			const handled = handleHomeKey(view, false);
			expect(handled).toBe(true); // keymap consumed the event
			expect(view.state.selection.main.head).toBe(12); // h.to
		});

		it("Home key from outside markdown link snaps to h.to", () => {
			// [text](url): leading {from:10, to:11}
			const doc = "prev line\n[text](url) bob jane";
			view = createTestView(doc, 29);

			const handled = handleHomeKey(view, false);
			expect(handled).toBe(true);
			expect(view.state.selection.main.head).toBe(11); // h.to (after "[")
		});

		it("Home key from inside link does NOT fire (returns false)", () => {
			// Cursor inside link text — let CM6 handle it normally.
			const doc = "prev line\n[[target]] bob jane";
			view = createTestView(doc, 13); // inside "target"

			const handled = handleHomeKey(view, false);
			expect(handled).toBe(false);
			expect(view.state.selection.main.head).toBe(13); // unchanged
		});

		it("Home key on line with mid-line link (not at line start) does NOT fire", () => {
			// Link is not at line start — homeKeyKeymap should not intervene.
			const doc = "prev line\nsee [[target]] bob jane";
			view = createTestView(doc, 32);

			const handled = handleHomeKey(view, false);
			expect(handled).toBe(false);
		});

		it("Shift+Home extends selection to h.to", () => {
			const doc = "prev line\n[[target]] bob jane";
			view = createTestView(doc, 28);

			const handled = handleHomeKey(view, true);
			expect(handled).toBe(true);
			const sel = view.state.selection.main;
			expect(sel.anchor).toBe(28);
			expect(sel.head).toBe(12);
		});

		it("two-step: Home snap to h.to then Obsidian normalisation to h.from stays at h.from (not prev line)", () => {
			// Reproduces the exact sequence from the diagnostic log:
			//   935 → 900 (handleHomeKey, userEvent="select")
			//   900 → 870 (Obsidian normalisation, userEvent="(none)")
			// The second step must NOT bounce to 869 (prev line end).
			const doc = "prev line\n[[target]] bob jane";
			// [[target]]: leading {from:10,to:12}, trailing {from:18,to:20}
			view = createTestView(doc, 28);

			// Step 1: Home key snaps to h.to=12 and sets arrivedAtTextFromFromOutside
			handleHomeKey(view, false);
			expect(view.state.selection.main.head).toBe(12);

			// Step 2: Obsidian normalises cursor from h.to=12 back to h.from=10 (no userEvent)
			view.dispatch({ selection: EditorSelection.cursor(10) }); // no userEvent

			// Must redirect to textFrom=12 (visible alias start), NOT stay at
			// h.from=10 (inside hidden [[ syntax) and NOT go to 9 (prev line end)
			expect(view.state.selection.main.head).toBe(12);
		});

		it("left arrow from h.to still goes to prev line (not suppressed)", () => {
			// Without having come from outside the link via Home, a left-arrow
			// from h.to=12 should still correctly go to prev line end = 9.
			const doc = "prev line\n[[target]] bob jane";
			view = createTestView(doc, 12); // cursor at h.to, NO Home key

			// Simulate left-arrow: dispatch to h.from=10 with userEvent="select"
			expect(dispatchSelection(view, 10, "select")).toBe(9);
		});

		it("Emacs Ctrl+A (editor.setCursor to ch:0) from outside link snaps to textFrom then survives Obsidian normalisation", () => {
			// The Emacs plugin calls editor.setCursor({line, ch:0}) which
			// dispatches directly to h.from=10 with no userEvent, bypassing
			// the CM6 keymap entirely.  The corrector must:
			//   1. Redirect 10 → 12 (textFrom) and set arrivedAtTextFromFromOutside
			//   2. Suppress the follow-up Obsidian normalisation (12→10, no userEvent)
			// Net result: cursor stays at 12 (visible text start), not 9 (prev line).
			const doc = "prev line\n[[target]] bob jane";
			view = createTestView(doc, 28); // cursor outside the link

			// Step 1: Emacs dispatches to h.from (no userEvent)
			dispatchSelection(view, 10); // no userEvent
			expect(view.state.selection.main.head).toBe(12); // snapped to textFrom

			// Step 2: Obsidian normalises back to h.from (no userEvent)
			view.dispatch({ selection: EditorSelection.cursor(10) });
			expect(view.state.selection.main.head).toBe(12); // redirected to textFrom, NOT 9 (prev line) or 10 (hidden [[)
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

		it("down-arrow from a blank line above a line-start markdown link lands at column 0 on the link line", () => {
			view = createTestView(
				"\n[dklfsdfg](http://arxiv.org/abs/2602.19141) asdflkjasdlfj\nalsdkfjasldjf",
				0
			);

			const result = dispatchVerticalMotion(view, 1, 0);
			expect(result).toBe(2);
		});

		it("up-arrow from below a line-start markdown link lands at column 0 on the link line", () => {
			view = createTestView(
				"\n[dklfsdfg](http://arxiv.org/abs/2602.19141) asdflkjasdlfj\nalsdkfjasldjf",
				61
			);

			const result = dispatchVerticalMotion(view, 1, 0);
			expect(result).toBe(2);
		});

		it("down-arrow back from the line above returns to link start, not link end, for a line-start wikilink", () => {
			const doc = "#example link\n\n[[test-notes/Note-09.md#Note Nine |Wote Nine]]";
			const linkStart = doc.indexOf("[[test-notes/Note-09.md#Note Nine |Wote Nine]]");
			const visibleStart = doc.indexOf("Wote Nine");
			const visibleEnd = visibleStart + "Wote Nine".length;

			view = createTestView(doc, visibleEnd);

			// Up-arrow from the end of the visible text lands on the blank line above.
			const upResult = dispatchVerticalMotion(view, 14, 9);
			expect(upResult).toBe(14);

			// Down-arrow with the preserved goal column should still land at the
			// start of the link line's visible text, not jump back to the end.
			const downResult = dispatchVerticalMotion(view, linkStart, 9);
			expect(downResult).toBe(visibleStart);
		});

		it("down-arrow back from the line above returns to link start, not link end, for a line-start markdown link", () => {
			const doc = "#example link\n\n[Wote Nine](https://example.com)";
			const linkStart = doc.indexOf("[Wote Nine](https://example.com)");
			const visibleStart = doc.indexOf("Wote Nine");
			const visibleEnd = visibleStart + "Wote Nine".length;

			view = createTestView(doc, visibleEnd);

			const upResult = dispatchVerticalMotion(view, 14, 9);
			expect(upResult).toBe(14);

			const downResult = dispatchVerticalMotion(view, linkStart, 9);
			expect(downResult).toBe(visibleStart);
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

	// ──────────────────────────────────────────────────────────────────────
	// BUG GUARD: Obsidian normalization bounce on line-start MARKDOWN links
	//
	// THIS IS THE EXACT SEQUENCE OBSIDIAN PRODUCES (from real console logs).
	// It has been broken by AI at least 4 times. DO NOT MODIFY without
	// testing in real Obsidian with the markdown below:
	//
	//   (blank line)
	//   [dklfsdfg](http://arxiv.org/abs/2602.19141) asdflkjasdlfj
	//   alsdkfjasldjf
	//
	// The key difference from wikilinks: for markdown links, the leading
	// hidden range is only 1 char wide ("["), so CM6's goalColumn=0 lands
	// DIRECTLY at textFrom (just past the hidden "["), not at leading.from.
	// Obsidian then normalizes textFrom → leading.from (no userEvent).
	// The markdownLeadingExit check matches this same pattern
	// (oldHead=textFrom, head=leading.from) and — if not suppressed —
	// bounces to leading.from-1 (previous line).
	//
	// The Obsidian normalization suppression (arrivedFromOutside) MUST run
	// BEFORE markdownLeadingExit in the cursorCorrector. If the ordering
	// is wrong, these tests will fail.
	// ──────────────────────────────────────────────────────────────────────
	describe("Obsidian normalization must not bounce cursor off line-start markdown links", () => {
		// Helper: simulate the exact Obsidian 3-step sequence for vertical
		// motion to a line-start markdown link.
		//
		// Step 1: CM6 delivers cursor to textFrom (with goalColumn=0).
		//         Our corrector fires arrivedFromOutside.
		// Step 2: Obsidian normalizes textFrom → leading.from (no userEvent).
		//         This must be suppressed — NOT treated as left-arrow.
		// Step 3: If suppression fails, markdownLeadingExit bounces to
		//         leading.from - 1 (previous line). The test detects this.
		function simulateObsidianVerticalThenNormalize(
			v: EditorView,
			textFrom: number,
			leadingFrom: number,
			goalColumn: number
		): number {
			// Step 1: vertical motion delivers cursor to textFrom
			const range = EditorSelection.cursor(textFrom, 1, undefined, goalColumn);
			v.dispatch({ selection: EditorSelection.create([range]) });

			// Step 2: Obsidian normalizes textFrom → leading.from (no userEvent)
			v.dispatch({
				selection: EditorSelection.cursor(leadingFrom),
			});

			return v.state.selection.main.head;
		}

		it("down-arrow to markdown link: Obsidian normalization does not bounce to previous line", () => {
			// "\n[dklfsdfg](http://arxiv.org/abs/2602.19141) asdflkjasdlfj\nalsdkfjasldjf"
			// Line 1: "" (blank, pos 0)
			// Line 2: "[dklfsdfg](...) asdflkjasdlfj" starting at pos 1
			//   leading "[" hidden at {1, 2}, textFrom = 2
			// Cursor starts on blank line (pos 0)
			view = createTestView(
				"\n[dklfsdfg](http://arxiv.org/abs/2602.19141) asdflkjasdlfj\nalsdkfjasldjf",
				0
			);

			const result = simulateObsidianVerticalThenNormalize(view, 2, 1, 0);

			// Must stay on the link line (pos 1-58), NOT bounce to pos 0 (blank line)
			expect(result).toBeGreaterThanOrEqual(1);
			expect(result).toBeLessThanOrEqual(58);
		});

		it("up-arrow to markdown link: Obsidian normalization does not bounce to next line", () => {
			view = createTestView(
				"\n[dklfsdfg](http://arxiv.org/abs/2602.19141) asdflkjasdlfj\nalsdkfjasldjf",
				65
			);

			const result = simulateObsidianVerticalThenNormalize(view, 2, 1, 0);

			// Must stay on the link line, NOT bounce to pos 0
			expect(result).toBeGreaterThanOrEqual(1);
			expect(result).toBeLessThanOrEqual(58);
		});

		it("down-arrow to markdown link: repeated presses do not get stuck", () => {
			// Simulates pressing down-arrow 3 times starting from the blank line
			view = createTestView(
				"\n[dklfsdfg](http://arxiv.org/abs/2602.19141) asdflkjasdlfj\nalsdkfjasldjf",
				0
			);

			// 1st down-arrow: land on link line
			const pos1 = simulateObsidianVerticalThenNormalize(view, 2, 1, 0);
			expect(pos1).toBeGreaterThanOrEqual(1);
			expect(pos1).toBeLessThanOrEqual(58);

			// 2nd down-arrow: should advance to line 3 (pos 59+), not stay stuck
			const range2 = EditorSelection.cursor(59, 1, undefined, 0);
			view.dispatch({ selection: EditorSelection.create([range2]) });
			const pos2 = view.state.selection.main.head;
			expect(pos2).toBeGreaterThanOrEqual(59);
		});

		it("left-arrow from textFrom still exits to previous line (not suppressed)", () => {
			// This is the OPPOSITE case: a genuine left-arrow from textFrom to
			// leading.from should still bounce to the previous line.
			// The difference: no arrivedFromOutside marker, and userEvent="select".
			view = createTestView(
				"\n[dklfsdfg](http://arxiv.org/abs/2602.19141) asdflkjasdlfj\nalsdkfjasldjf",
				2 // start at textFrom
			);

			// Simulate left-arrow: moves from textFrom (2) to leading.from (1)
			// WITH a userEvent (genuine user action)
			const result = dispatchSelection(view, 1, "select");

			// Should exit to end of previous line (pos 0)
			expect(result).toBe(0);
		});

		it("wikilink vertical motion still works after markdown link fix", () => {
			// Ensure the markdown link fix did not break wikilinks.
			// "\n[[target]]\nbelow"
			// leading [[ at {1, 3}, textFrom = 3
			view = createTestView("\n[[target]]\nbelow", 0);

			const result = simulateObsidianVerticalThenNormalize(view, 3, 1, 0);

			// Must stay on the wikilink line
			expect(result).toBeGreaterThanOrEqual(1);
			expect(result).toBeLessThanOrEqual(11);
		});
	});

	// ──────────────────────────────────────────────────────────────────────
	// BUG GUARD: Obsidian normalisation suppression MUST redirect to textFrom
	//
	// When Obsidian normalises from textFrom back to leading.from after
	// vertical motion, the suppression MUST redirect to textFrom (visible
	// alias start), NOT stay at leading.from (hidden [[ syntax).
	//
	// If the cursor stays at leading.from:
	//   - The visible-cursor plugin renders a garbled block cursor on the
	//     hidden [[ character instead of the visible alias character
	//   - Two right-arrow presses are needed to move off the first visible
	//     character (because the real selection is on hidden syntax)
	//   - coordsAtPos() at leading.from returns ~1px width (collapsed syntax)
	//
	// This has been broken by AI at least 5 times.  If you modify the
	// suppression logic in cursorCorrector, run these tests.  If they
	// fail, you have regressed the fix.
	// ──────────────────────────────────────────────────────────────────────
	describe("Obsidian normalisation suppression must redirect to textFrom", () => {
		it("wikilink: suppression redirects to textFrom, not leading.from", () => {
			// "\n[[target]]\nbelow" — blank line, then wikilink at line start
			// leading [[ at {1, 3}, textFrom = 3, visible "target" at 3-9
			view = createTestView("\n[[target]]\nbelow", 0);

			// Step 1: vertical motion delivers cursor to textFrom=3
			const range = EditorSelection.cursor(3, 1, undefined, 0);
			view.dispatch({ selection: EditorSelection.create([range]) });
			expect(view.state.selection.main.head).toBe(3);

			// Step 2: Obsidian normalises textFrom=3 → leading.from=1 (no userEvent)
			view.dispatch({ selection: EditorSelection.cursor(1) });

			// MUST be at textFrom=3 (visible alias start), NOT leading.from=1
			expect(view.state.selection.main.head).toBe(3);
		});

		it("wikilink with alias: suppression redirects to textFrom, not leading.from", () => {
			// Piped wikilink: [[path|Alias Text]]
			// leading [[ at {1, ...}, textFrom = after the pipe
			view = createTestView("\n[[test-notes/Note-09.md#Note Nine |Wote Nine]]\nAfter", 0);

			const doc = view.state.doc.toString();
			const aliasStart = doc.indexOf("Wote Nine");
			expect(aliasStart).toBeGreaterThan(0);

			// Step 1: vertical motion to textFrom (alias start)
			const range = EditorSelection.cursor(aliasStart, 1, undefined, 0);
			view.dispatch({ selection: EditorSelection.create([range]) });

			// Step 2: Obsidian normalises to leading.from=1
			view.dispatch({ selection: EditorSelection.cursor(1) });

			// MUST be at textFrom (alias start), NOT at leading.from=1
			expect(view.state.selection.main.head).toBe(aliasStart);
		});

		it("markdown link: suppression redirects to textFrom, not leading.from", () => {
			view = createTestView(
				"\n[dklfsdfg](http://arxiv.org/abs/2602.19141) asdflkjasdlfj\nalsdkfjasldjf",
				0
			);

			// Step 1: vertical motion to textFrom=2
			const range = EditorSelection.cursor(2, 1, undefined, 0);
			view.dispatch({ selection: EditorSelection.create([range]) });

			// Step 2: Obsidian normalises to leading.from=1
			view.dispatch({ selection: EditorSelection.cursor(1) });

			// MUST be at textFrom=2, NOT leading.from=1
			expect(view.state.selection.main.head).toBe(2);
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
