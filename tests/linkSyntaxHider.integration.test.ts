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
function dispatchSelection(
	view: EditorView,
	head: number,
	userEvent?: string,
): number {
	view.dispatch({
		selection: EditorSelection.cursor(head),
		annotations: userEvent
			? [Transaction.userEvent.of(userEvent)]
			: undefined,
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
			expect(anchor.style.pointerEvents).toBe("auto");
			expect(anchor.style.verticalAlign).toBe("text-bottom");
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

		it("selection delivered to trailing h.from is corrected to h.from-1", () => {
			view = createTestView("see [[target]] more", 14);

			expect(dispatchSelection(view, 12)).toBe(11);
		});
	});

	describe("markdown link at end of line: [text](url)", () => {
		it("selection delivered to trailing h.from is corrected to the visible boundary", () => {
			view = createTestView("[link text](https://x.com)", 26);

			expect(dispatchSelection(view, 10)).toBe(10);
		});
	});

	describe("markdown link mid-line: Click [here](https://x.com) for details", () => {
		it("selection delivered to trailing h.from is corrected to h.from", () => {
			view = createTestView("Click [here](https://x.com) for details", 28);

			expect(dispatchSelection(view, 11)).toBe(11);
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

			expect(view.state.doc.toString()).toBe(
				"abcdefg X[[Note-08|test link]] defg",
			);
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
});
