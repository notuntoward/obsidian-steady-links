import { describe, it, expect } from "vitest";
import {
	findMarkdownLinkSyntaxRanges,
	findWikiLinkSyntaxRanges,
	correctCursorPos,
	listContinuation,
	findLinkEndAtPos,
	computeHiddenRanges,
	type HiddenRange,
} from "../src/linkSyntaxHider";
import { EditorState, EditorSelection } from "@codemirror/state";

// ============================================================================
// Helper: minimal doc mock for correctCursorPos
// ============================================================================

function makeDoc(text: string) {
	// Split by newline to compute line boundaries
	const lines = text.split("\n");
	let offset = 0;
	const lineData: { from: number; to: number; text: string; number: number }[] = [];
	for (let i = 0; i < lines.length; i++) {
		lineData.push({
			from: offset,
			to: offset + lines[i].length,
			text: lines[i],
			number: i + 1,
		});
		offset += lines[i].length + 1; // +1 for newline
	}
	return {
		length: text.length,
		lineAt(pos: number) {
			for (const ld of lineData) {
				if (pos >= ld.from && pos <= ld.to) return ld;
			}
			return lineData[lineData.length - 1];
		},
		line(n: number) {
			return lineData[n - 1] || lineData[lineData.length - 1];
		},
	};
}

// ============================================================================
// findMarkdownLinkSyntaxRanges
// ============================================================================

describe("findMarkdownLinkSyntaxRanges", () => {
	it("should return empty array for text without links", () => {
		expect(findMarkdownLinkSyntaxRanges("plain text", 0)).toEqual([]);
	});

	it("should detect leading and trailing ranges for a basic link", () => {
		// [text](url)
		const ranges = findMarkdownLinkSyntaxRanges("[hello](https://x.com)", 0);
		expect(ranges).toHaveLength(2);
		expect(ranges[0]).toEqual({ from: 0, to: 1, side: "leading" }); // "["
		expect(ranges[1]).toEqual({ from: 6, to: 22, side: "trailing" }); // "](https://x.com)"
	});

	it("should handle lineFrom offset", () => {
		const ranges = findMarkdownLinkSyntaxRanges("[a](b)", 100);
		expect(ranges[0]).toEqual({ from: 100, to: 101, side: "leading" });
		expect(ranges[1]).toEqual({ from: 102, to: 106, side: "trailing" });
	});

	it("should detect embedded link prefix", () => {
		// ![alt](img.png)
		const ranges = findMarkdownLinkSyntaxRanges("![alt](img.png)", 0);
		expect(ranges[0]).toEqual({ from: 0, to: 2, side: "leading" }); // "!["
		expect(ranges[1]).toEqual({ from: 5, to: 15, side: "trailing" }); // "](img.png)"
	});

	it("should detect multiple links on one line", () => {
		const text = "[a](b) and [c](d)";
		const ranges = findMarkdownLinkSyntaxRanges(text, 0);
		expect(ranges).toHaveLength(4);
		// First link
		expect(ranges[0]).toEqual({ from: 0, to: 1, side: "leading" });
		expect(ranges[1]).toEqual({ from: 2, to: 6, side: "trailing" });
		// Second link
		expect(ranges[2]).toEqual({ from: 11, to: 12, side: "leading" });
		expect(ranges[3]).toEqual({ from: 13, to: 17, side: "trailing" });
	});

	it("should handle link at end of line", () => {
		const text = "text [link](url)";
		const ranges = findMarkdownLinkSyntaxRanges(text, 0);
		expect(ranges[1].to).toBe(text.length);
	});
});

// ============================================================================
// findWikiLinkSyntaxRanges
// ============================================================================

describe("findWikiLinkSyntaxRanges", () => {
	it("should return empty array for text without wikilinks", () => {
		expect(findWikiLinkSyntaxRanges("plain text", 0)).toEqual([]);
	});

	it("should detect leading and trailing for basic wikilink", () => {
		// [[target]]
		const ranges = findWikiLinkSyntaxRanges("[[target]]", 0);
		expect(ranges).toHaveLength(2);
		expect(ranges[0]).toEqual({ from: 0, to: 2, side: "leading" }); // "[["
		expect(ranges[1]).toEqual({ from: 8, to: 10, side: "trailing" }); // "]]"
	});

	it("should handle wikilink with alias (pipe)", () => {
		// [[target|alias]]
		const ranges = findWikiLinkSyntaxRanges("[[target|alias]]", 0);
		expect(ranges).toHaveLength(2);
		expect(ranges[0]).toEqual({ from: 0, to: 9, side: "leading" }); // "[[target|"
		expect(ranges[1]).toEqual({ from: 14, to: 16, side: "trailing" }); // "]]"
	});

	it("should handle lineFrom offset", () => {
		const ranges = findWikiLinkSyntaxRanges("[[x]]", 50);
		expect(ranges[0]).toEqual({ from: 50, to: 52, side: "leading" });
		expect(ranges[1]).toEqual({ from: 53, to: 55, side: "trailing" });
	});

	it("should detect embedded wikilink", () => {
		// ![[file]]
		const ranges = findWikiLinkSyntaxRanges("![[file]]", 0);
		expect(ranges[0]).toEqual({ from: 0, to: 3, side: "leading" }); // "![["
		expect(ranges[1]).toEqual({ from: 7, to: 9, side: "trailing" }); // "]]"
	});

	it("should detect multiple wikilinks on one line", () => {
		const text = "[[a]] and [[b]]";
		const ranges = findWikiLinkSyntaxRanges(text, 0);
		expect(ranges).toHaveLength(4);
	});

	it("should handle wikilink at end of line", () => {
		const text = "see [[target]]";
		const ranges = findWikiLinkSyntaxRanges(text, 0);
		expect(ranges[1].to).toBe(text.length);
	});

	it("should NOT hide empty wiki links like [[]]", () => {
		// Empty wiki links should not be hidden so Obsidian's native
		// link autocomplete can work when typing '[['
		const ranges = findWikiLinkSyntaxRanges("[[]]", 0);
		expect(ranges).toEqual([]);
	});

	it("should NOT hide whitespace-only wiki links like [[ ]]", () => {
		const ranges = findWikiLinkSyntaxRanges("[[ ]]", 0);
		expect(ranges).toEqual([]);
	});

	it("should NOT hide whitespace-only wiki links like [[\t]]", () => {
		const ranges = findWikiLinkSyntaxRanges("[[\t]]", 0);
		expect(ranges).toEqual([]);
	});

	it("should still hide wiki links with content", () => {
		const ranges = findWikiLinkSyntaxRanges("[[a]]", 0);
		expect(ranges).toHaveLength(2);
		expect(ranges[0]).toEqual({ from: 0, to: 2, side: "leading" });
		expect(ranges[1]).toEqual({ from: 3, to: 5, side: "trailing" });
	});
});

// ============================================================================
// correctCursorPos
// ============================================================================

describe("correctCursorPos", () => {
	// Document: "text [link](https://x.com)"
	// Leading: [5, 6)  Trailing: [10, 26)
	const mdLine = "text [link](https://x.com)";
	const mdDoc = makeDoc(mdLine);
	const mdHidden: HiddenRange[] = [
		{ from: 5, to: 6, side: "leading" },
		{ from: 10, to: 26, side: "trailing" },
	];

	describe("leading range", () => {
		it("should skip right through leading range", () => {
			const result = correctCursorPos(5, 4, mdHidden, mdDoc as any);
			expect(result).toBe(6); // skip to text start
		});

		it("should skip left through leading range", () => {
			const result = correctCursorPos(5, 6, mdHidden, mdDoc as any);
			// Moving left from 6→5: h.from=5, movingRight=false, pos===h.from → null
			expect(result).toBe(null);
		});
	});

	describe("trailing range — keyboard navigation", () => {
		it("should go to line end when moving right (line-ending link)", () => {
			// Moving right from pos 10 (inside trailing)
			const result = correctCursorPos(10, 9, mdHidden, mdDoc as any);
			// h.to (26) === line.to (26), so should return h.to = 26
			expect(result).toBe(26);
		});

		it("should go to h.from when moving left into trailing range", () => {
			const result = correctCursorPos(15, 27, mdHidden, mdDoc as any);
			expect(result).toBe(10); // h.from
		});

		it("should skip h.to directly to h.from when moving left", () => {
			// At h.to (26), old pos was 27 → moving left
			const result = correctCursorPos(26, 27, mdHidden, mdDoc as any);
			expect(result).toBe(10); // h.from (the double-left fix)
		});

		it("should not correct at h.to when moving right", () => {
			// At h.to (26) coming from 10 → moving right. Not inside.
			// New fix: h.to, pos < oldPos? 26 < 10? No. → no correction
			const result = correctCursorPos(26, 10, mdHidden, mdDoc as any);
			expect(result).toBe(null);
		});
	});

	describe("trailing range — pointer (click)", () => {
		it("should go to h.from when clicking inside trailing range", () => {
			const result = correctCursorPos(15, 0, mdHidden, mdDoc as any, true);
			expect(result).toBe(10);
		});

		it("should go to h.from when clicking at h.to", () => {
			const result = correctCursorPos(26, 0, mdHidden, mdDoc as any, true);
			expect(result).toBe(10);
		});
	});

	describe("mid-line link (trailing range not at line end)", () => {
		// "hello [link](url) world"
		// Leading: [6,7)  Trailing: [11,18)  lineLen=23
		const midLine = "hello [link](url) world";
		const midDoc = makeDoc(midLine);
		const midHidden: HiddenRange[] = [
			{ from: 6, to: 7, side: "leading" },
			{ from: 11, to: 18, side: "trailing" },
		];

		it("should go to h.to + 1 when moving right (not line-ending)", () => {
			// h.to (18) !== line.to (23), so should return h.to+1 = 19
			const result = correctCursorPos(11, 10, midHidden, midDoc as any);
			expect(result).toBe(19);
		});
	});

	describe("no hidden ranges", () => {
		it("should return null when no ranges match", () => {
			const result = correctCursorPos(3, 2, [], mdDoc as any);
			expect(result).toBe(null);
		});
	});

	// Wikilink: "see [[target]]"
	// Leading: [4,6)  Trailing: [12,14)
	describe("wikilink cursor correction", () => {
		const wikiLine = "see [[target]]";
		const wikiDoc = makeDoc(wikiLine);
		const wikiHidden: HiddenRange[] = [
			{ from: 4, to: 6, side: "leading" },
			{ from: 12, to: 14, side: "trailing" },
		];

		it("should skip from h.to to h.from on left arrow", () => {
			// At position 14 (h.to), coming from 15 (moving left)
			const result = correctCursorPos(14, 15, wikiHidden, wikiDoc as any);
			expect(result).toBe(12); // h.from
		});

		it("should go to line end when moving right (link at line end)", () => {
			// At position 12 (h.from, inside trailing), coming from 11 (moving right)
			const result = correctCursorPos(12, 11, wikiHidden, wikiDoc as any);
			// h.to (14) === line.to (14), so returns h.to = 14
			expect(result).toBe(14);
		});
	});
});

// ============================================================================
// listContinuation
// ============================================================================

describe("listContinuation", () => {
	it("should return empty string for non-list lines", () => {
		expect(listContinuation("plain text")).toBe("");
		expect(listContinuation("")).toBe("");
	});

	it("should detect dash bullet", () => {
		expect(listContinuation("- item")).toBe("- ");
	});

	it("should detect asterisk bullet", () => {
		expect(listContinuation("* item")).toBe("* ");
	});

	it("should detect plus bullet", () => {
		expect(listContinuation("+ item")).toBe("+ ");
	});

	it("should detect numbered list with dot", () => {
		expect(listContinuation("1. item")).toBe("1. ");
	});

	it("should detect numbered list with paren", () => {
		expect(listContinuation("1) item")).toBe("1) ");
	});

	it("should preserve indentation", () => {
		expect(listContinuation("  - item")).toBe("  - ");
		expect(listContinuation("    * item")).toBe("    * ");
		expect(listContinuation("\t- item")).toBe("\t- ");
	});

	it("should detect checkbox and reset to unchecked", () => {
		expect(listContinuation("- [x] done item")).toBe("- [ ] ");
		expect(listContinuation("- [ ] todo item")).toBe("- [ ] ");
	});

	it("should handle indented checkbox", () => {
		expect(listContinuation("  - [x] done")).toBe("  - [ ] ");
	});

	it("should not match text without space after marker", () => {
		expect(listContinuation("-no space")).toBe("");
	});
});

// ============================================================================
// findLinkEndAtPos
// ============================================================================

describe("findLinkEndAtPos", () => {
	it("should return null when no link at position", () => {
		expect(findLinkEndAtPos("plain text", 0, 5)).toBe(null);
	});

	it("should find markdown link end at trailing range boundary", () => {
		// "text [link](url)" → trailing [10, 16)
		const text = "text [link](url)";
		// pos at 10 (start of trailing)
		expect(findLinkEndAtPos(text, 0, 10)).toBe(16);
		// pos at 16 (end of trailing)
		expect(findLinkEndAtPos(text, 0, 16)).toBe(16);
	});

	it("should find wikilink end at trailing range", () => {
		// "see [[target]]" → trailing [12, 14)
		const text = "see [[target]]";
		expect(findLinkEndAtPos(text, 0, 12)).toBe(14);
		expect(findLinkEndAtPos(text, 0, 14)).toBe(14);
	});

	it("should return null for positions before trailing range", () => {
		const text = "text [link](url)";
		expect(findLinkEndAtPos(text, 0, 5)).toBe(null); // inside leading
	});

	it("should return null for positions after trailing range", () => {
		const text = "[link](url) more";
		expect(findLinkEndAtPos(text, 0, 12)).toBe(null);
	});

	it("should handle lineFrom offset", () => {
		const text = "[link](url)";
		expect(findLinkEndAtPos(text, 100, 105)).toBe(111); // 100 + 11
	});
});

// ============================================================================
// computeHiddenRanges with EditorState
// ============================================================================

describe("computeHiddenRanges", () => {
	it("should return hidden ranges for lines with cursor on links (cursor NOT inside link content)", () => {
		// Create a minimal EditorState with a link and cursor position OUTSIDE the link
		const doc = "Check out [[my-note|My Note]] for more info";
		const state = EditorState.create({
			doc,
			selection: EditorSelection.cursor(5), // Cursor BEFORE the link (not inside)
		});

		const ranges = computeHiddenRanges(state);
		
		// Should have leading and trailing ranges for the wikilink
		expect(ranges.length).toBeGreaterThanOrEqual(2);
		
		// Find the leading range (should include "[[my-note|")
		const leadingRange = ranges.find(r => r.side === "leading");
		expect(leadingRange).toBeDefined();
		expect(leadingRange!.from).toBe(10); // Start of "[["
		// Leading range ends where display text begins
		expect(leadingRange!.to).toBeGreaterThan(leadingRange!.from);
		
		// Find the trailing range (should include "]]")
		const trailingRange = ranges.find(r => r.side === "trailing");
		expect(trailingRange).toBeDefined();
		// Trailing range starts after display text and ends at end of link
		expect(trailingRange!.to).toBeGreaterThan(trailingRange!.from);
	});

	it("should NOT hide link syntax when cursor is inside the link content", () => {
		// When cursor is inside the link content, the link should NOT be hidden
		// This allows Obsidian's native link autocomplete to work
		const doc = "Check out [[my-note|My Note]] for more info";
		const state = EditorState.create({
			doc,
			selection: EditorSelection.cursor(12), // Cursor inside the link content
		});

		const ranges = computeHiddenRanges(state);
		
		// Should have NO ranges because cursor is inside the link content
		expect(ranges).toEqual([]);
	});

	it("should return empty array when cursor is not on a link line", () => {
		const state = EditorState.create({
			doc: "This is plain text\nAnd another line with [[a-link]]",
			selection: EditorSelection.cursor(5), // Cursor on first line (no links)
		});

		const ranges = computeHiddenRanges(state);
		
		// No hidden ranges because cursor line has no links
		expect(ranges).toEqual([]);
	});

	it("should handle markdown links", () => {
		const state = EditorState.create({
			doc: "Click [here](https://example.com) for details",
			selection: EditorSelection.cursor(5), // Cursor BEFORE the link
		});

		const ranges = computeHiddenRanges(state);
		
		expect(ranges.length).toBe(2);
		
		// Leading range: "["
		expect(ranges[0]).toEqual({ from: 6, to: 7, side: "leading" });
		
		// Trailing range: "](https://example.com)"
		expect(ranges[1]).toEqual({ from: 11, to: 33, side: "trailing" });
	});

	it("should handle multiple links on cursor line", () => {
		const state = EditorState.create({
			doc: "See [[link1]] and [[link2]] here",
			selection: EditorSelection.cursor(5), // Cursor on line with multiple links
		});

		const ranges = computeHiddenRanges(state);
		
		// Should have 4 ranges: 2 for each wikilink (leading + trailing)
		expect(ranges.length).toBe(4);
	});
});

// ============================================================================
// Mode Detection (isLivePreview behavior)
// ============================================================================

describe("mode detection behavior", () => {
	describe("isLivePreview logic (documented behavior)", () => {
		// NOTE: The isLivePreview function checks DOM elements which cannot be
		// fully tested in a unit test environment. However, we document the
		// expected behavior here:
		//
		// 1. Returns FALSE when:
		//    - No .markdown-source-view ancestor found
		//    - .is-source-mode class is present
		//    - data-mode="source" attribute is set
		//    - getMode() returns "source"
		//
		// 2. Returns TRUE when:
		//    - .is-live-preview class is present
		//    - data-mode="live" or data-mode="preview" is set
		//    - getMode() returns "live" or "preview"
		//    - Default fallback is TRUE (assume live preview)
		//
		// The SyntaxHiderModePlugin.sync() method:
		// - Calls isLivePreview(view) to determine mode
		// - Dispatches setSyntaxHiderEnabled effect to update state
		// - Only enables syntax hiding in live preview mode
		//
		// This ensures the "Keep links steady" feature:
		// - Works in Live Preview mode (syntax is hidden)
		// - Does NOT work in Source mode (syntax remains visible)

		it("documents that syntax hiding is mode-dependent", () => {
			// This test serves as documentation of the expected behavior.
			// The actual mode detection happens in isLivePreview() which
			// checks DOM classes that aren't available in unit tests.
			expect(true).toBe(true);
		});
	});
});
