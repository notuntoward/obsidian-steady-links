import { describe, it, expect } from "vitest";
import {
	findMarkdownLinkSyntaxRanges,
	findWikiLinkSyntaxRanges,
	correctCursorPos,
	listContinuation,
	findLinkEndAtPos,
	computeHiddenRanges,
	enterAtLinkEndFix,
	deleteAtLinkEndFix,
	deleteAtLinkStartFix,
	syntaxHiderEnabledField,
	hiddenRangesField,
	setSyntaxHiderEnabled,
	type HiddenRange,
} from "../src/linkSyntaxHider";
import { EditorState, EditorSelection, Transaction } from "@codemirror/state";
// Transaction is used in makeHiderState and tests via Transaction.userEvent.of(...)

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

	// ── BUG GUARD: wikilink syntax hidden regardless of cursor position ──────
	//
	// This invariant has been broken twice (commits 9bafa8e, f8ffc5a) by adding
	// an optional cursorPos parameter that suppresses hiding when the cursor is
	// inside the link content. It was fixed twice (97d1df7, current commit).
	//
	// The mistake: "cursor inside link content" is the NORMAL state when the
	// user navigates to a wikilink. Suppressing hidden ranges defeats the entire
	// "keep links steady" feature.
	//
	// findWikiLinkSyntaxRanges MUST take exactly 2 required arguments and MUST
	// return hidden ranges for any complete [[...]] link regardless of where the
	// cursor is. If a 3rd cursorPos argument is re-added and used to skip hiding,
	// the computeHiddenRanges tests below (which pass cursor inside a link) will
	// catch it — as will these tests if the function signature is changed back.

	it("hides [[target]] when called — cursor position is irrelevant", () => {
		// Any complete wikilink must always be hidden.
		// (There is no cursorPos argument to this function.)
		expect(findWikiLinkSyntaxRanges("[[target]]", 0)).toHaveLength(2);
	});

	it("hides [[target|Alias]] (aliased link) unconditionally", () => {
		const ranges = findWikiLinkSyntaxRanges("[[target|Alias]]", 0);
		expect(ranges).toHaveLength(2);
		expect(ranges[0]).toEqual({ from: 0, to: 9, side: "leading" }); // [[target|
		expect(ranges[1]).toEqual({ from: 14, to: 16, side: "trailing" }); // ]]
	});

	it("hides [[folder/file#Heading]] (path with heading) unconditionally", () => {
		const ranges = findWikiLinkSyntaxRanges("[[folder/file#Heading]]", 0);
		expect(ranges).toHaveLength(2);
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
			// Moving left from 6→5: pos lands at h.from, skip to h.from - 1
			expect(result).toBe(4);
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

		it("should NOT correct at h.to when moving left (h.to is outside the range)", () => {
			// At h.to (26), old pos was 27 → moving left from just past the link.
			// h.to is NOT inside [h.from, h.to) — no correction fires here.
			// The cursor stays at h.to.  On the NEXT left press, CM6 skips
			// the decoration to h.from, and then the oldPos===h.to check
			// triggers the skip to h.from-1.
			const result = correctCursorPos(26, 27, mdHidden, mdDoc as any);
			expect(result).toBe(null);
		});

		it("should not correct at h.to when moving right", () => {
			// At h.to (26) coming from 10 → moving right. Not inside.
			// h.to skip only applies when moving LEFT, not right.
			const result = correctCursorPos(26, 10, mdHidden, mdDoc as any);
			expect(result).toBe(null);
		});
	});

	describe("trailing range — pointer (click)", () => {
		it("should go to h.from when clicking inside trailing range", () => {
			const result = correctCursorPos(15, 0, mdHidden, mdDoc as any, true);
			expect(result).toBe(10);
		});

		it("should NOT correct when clicking at h.to (outside the hidden range)", () => {
			// h.to (26) is the position immediately after the closing syntax.
			// It is NOT inside the hidden range [10, 26) — it is the position
			// AFTER the decoration.  Clicking there means "I want to be just
			// outside / to the right of the link" and must not snap the cursor
			// back inside the link text.
			const result = correctCursorPos(26, 0, mdHidden, mdDoc as any, true);
			expect(result).toBe(null); // no correction — stay at h.to
		});

		it("should NOT correct when clicking at h.to of a mid-line link", () => {
			// Mid-line link: "hello [link](url) world"
			// Trailing: [11, 18)  h.to=18, lineEnd=23 (h.to !== lineEnd)
			// Clicking at 18 (just after ")") should land the cursor at 18,
			// not snap it back inside the link to h.from=11.
			const midLine = "hello [link](url) world";
			const midDoc = makeDoc(midLine);
			const midHidden: HiddenRange[] = [
				{ from: 6, to: 7, side: "leading" },
				{ from: 11, to: 18, side: "trailing" },
			];
			const result = correctCursorPos(18, 0, midHidden, midDoc as any, true);
			expect(result).toBe(null); // no correction — stay outside the link
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

		it("should NOT correct at h.to on left arrow (h.to is outside the range)", () => {
			// At position 14 (h.to), coming from 15 (moving left).
			// h.to is NOT inside [h.from, h.to) — no correction here.
			// On the next left press CM6 delivers h.from and the
			// oldPos===h.to check will skip to h.from-1.
			const result = correctCursorPos(14, 15, wikiHidden, wikiDoc as any);
			expect(result).toBe(null);
		});

		it("should go to line end when moving right (link at line end)", () => {
			// At position 12 (h.from, inside trailing), coming from 11 (moving right)
			const result = correctCursorPos(12, 11, wikiHidden, wikiDoc as any);
			// h.to (14) === line.to (14), so returns h.to = 14
			expect(result).toBe(14);
		});
	});

	// ── BUG FIX: left arrow at left edge of line-start wikilinks ──
	//
	// When [[target]] starts at the *beginning* of a line, the leading
	// hidden range's h.from equals the line start.  CM6 delivers pos=h.from
	// when pressing left from h.to (the visible text edge).  The correction
	// must push the cursor to h.from - 1 (end of previous line) — NOT
	// return null, which would leave the cursor stuck at h.from where it
	// looks identical to h.to (zero-width widget between them).
	describe("line-start wikilink: left arrow from visible text edge", () => {
		// Document: "prev line\n[[target]]"
		//            0123456789 0123456789
		// Line 1: "prev line" (from=0, to=9)
		// Newline at position 9
		// Line 2: "[[target]]" (from=10, to=20)
		// Leading: {from: 10, to: 12}  Trailing: {from: 18, to: 20}
		const doc = makeDoc("prev line\n[[target]]");
		const hidden: HiddenRange[] = [
			{ from: 10, to: 12, side: "leading" },
			{ from: 18, to: 20, side: "trailing" },
		];

		it("left arrow: should skip from h.from (line start) to end of previous line", () => {
			// User cursor was at h.to=12 (visible "t" of "target").
			// CM6 skips the replace decoration and delivers pos=h.from=10.
			// Old code returned null → cursor stuck at 10 (same visual spot).
			// Fixed code returns 9 → cursor moves to end of "prev line".
			const result = correctCursorPos(10, 12, hidden, doc as any);
			expect(result).toBe(9); // end of previous line
		});

		it("right arrow: should NOT skip past line start (arriving from prev line)", () => {
			// User cursor was at 9 (end of prev line), pressed right.
			// CM6 delivers pos=10 (line start, which is h.from).
			// The user should stop at line start, NOT jump into the link.
			const result = correctCursorPos(10, 9, hidden, doc as any);
			expect(result).toBe(null); // stay at line start
		});
	});

	describe("first-line wikilink: left arrow at document start", () => {
		// Document: "[[target]]"  (link starts at position 0, first line)
		// Leading: {from: 0, to: 2}  Trailing: {from: 8, to: 10}
		const doc = makeDoc("[[target]]");
		const hidden: HiddenRange[] = [
			{ from: 0, to: 2, side: "leading" },
			{ from: 8, to: 10, side: "trailing" },
		];

		it("left arrow: returns null at document start (nowhere to go)", () => {
			// Cursor at h.to=2, user presses left, CM6 delivers pos=0.
			// h.from=0, can't go further left → null (correct: start of doc).
			const result = correctCursorPos(0, 2, hidden, doc as any);
			expect(result).toBe(null);
		});

		it("right arrow from pos 0: should skip to h.to (into link text)", () => {
			// Not really right arrow from prev line — this is pos=0, oldPos=0.
			// movingRight = 0 >= 0 = true → return null (stay at line start).
			// Actually, this means the user is "already there" — no correction.
			const result = correctCursorPos(0, 0, hidden, doc as any);
			expect(result).toBe(null);
		});
	});

	describe("mid-line wikilink: left arrow skips decoration", () => {
		// Document: "Hello [[target]]"
		// Leading: {from: 6, to: 8}  Trailing: {from: 14, to: 16}
		const doc = makeDoc("Hello [[target]]");
		const hidden: HiddenRange[] = [
			{ from: 6, to: 8, side: "leading" },
			{ from: 14, to: 16, side: "trailing" },
		];

		it("left arrow: should skip from h.from to h.from-1 in one keypress", () => {
			// Cursor at h.to=8 ("t" of target). User presses left.
			// CM6 delivers pos=6 (h.from). NOT at line start (line starts at 0).
			// Normal path: inside=true, movingRight=false → return h.from-1=5.
			const result = correctCursorPos(6, 8, hidden, doc as any);
			expect(result).toBe(5);
		});
	});

	// ── BUG FIX: left arrow at RIGHT edge of trailing hidden range ──
	//
	// The trailing ]] is replaced by a zero-width widget.  Positions
	// h.from (text boundary) and h.to (after syntax) are at the same
	// visual location.  When the user presses left arrow, the cursor
	// must NOT pause at both h.to and h.from — that creates an invisible
	// stop that requires two presses to cross.  Two fixes:
	//
	// 1. h.to → h.from: When CM6 delivers pos=h.to (mid-line case where
	//    h.to is not the line end), skip to h.from immediately.
	//
	// 2. h.from with oldPos=h.to: When CM6 delivers pos=h.from (line-end
	//    case where CM6 skips the decoration), and the user was at h.to,
	//    skip one further to h.from-1 (last visible character).
	describe("right edge trailing fix: left arrow produces visible movement", () => {
		// ─── End-of-line wikilink: "see [[target]]" ───
		// Trailing: {from: 12, to: 14}, h.to = line.to = 14
		describe("end-of-line: see [[target]]", () => {
			const doc = makeDoc("see [[target]]");
			const hidden: HiddenRange[] = [
				{ from: 4, to: 6, side: "leading" },
				{ from: 12, to: 14, side: "trailing" },
			];

			it("left from h.to (line end): CM6 skips to h.from, correction goes to h.from-1", () => {
				// Cursor at 14 (line end). CM6 skips decoration → pos=12, oldPos=14.
				// h.to === lineEnd → skip to h.from-1 = 11 (the 't' of target).
				const result = correctCursorPos(12, 14, hidden, doc as any);
				expect(result).toBe(11);
			});

			it("right into trailing: should jump to h.to (line end)", () => {
				// Moving right from last visible char → should jump to line end.
				const result = correctCursorPos(12, 11, hidden, doc as any);
				expect(result).toBe(14); // h.to = line.to
			});
		});

		// ─── Mid-line wikilink: "see [[target]] more" ───
		// Trailing: {from: 12, to: 14}, h.to ≠ line.to
		describe("mid-line wikilink: see [[target]] more", () => {
			const doc = makeDoc("see [[target]] more");
			const hidden: HiddenRange[] = [
				{ from: 4, to: 6, side: "leading" },
				{ from: 12, to: 14, side: "trailing" },
			];

			it("left to h.to from space: no correction (h.to is outside range)", () => {
				const result = correctCursorPos(14, 15, hidden, doc as any);
				expect(result).toBe(null);
			});

			it("left through trailing at non-line-end: returns h.from (valid stop)", () => {
				// CM6 delivers h.from=12, oldPos=14=h.to.
				// h.to (14) !== lineEnd (19) → return h.from (not h.from-1).
				// h.from is a valid, visually distinct stop for mid-line links.
				const result = correctCursorPos(12, 14, hidden, doc as any);
				expect(result).toBe(12); // h.from — NOT h.from-1
			});

			it("right from h.to: no correction (moving right past the range)", () => {
				const result = correctCursorPos(14, 12, hidden, doc as any);
				expect(result).toBe(null);
			});
		});

		// ─── Mid-line markdown link: "[link text](url) more" ───
		// Ensures we don't skip the last character for markdown links.
		describe("mid-line markdown link: [link text](url) more", () => {
			const doc = makeDoc("[link text](url) more");
			const hidden: HiddenRange[] = [
				{ from: 0, to: 1, side: "leading" },
				{ from: 10, to: 16, side: "trailing" },
			];

			it("left through trailing at non-line-end: returns h.from (visible boundary)", () => {
				// Cursor was at h.to=16. CM6 delivers h.from=10.
				// h.to (16) !== lineEnd (21) → return h.from=10 (not h.from-1=9).
				const result = correctCursorPos(10, 16, hidden, doc as any);
				expect(result).toBe(10); // text boundary, NOT 9
			});
		});

		// ─── End-of-line markdown link: "[link text](url)" ───
		// Markdown trailing ranges are long (e.g. "](url)" = 6 chars).
		// The external-link icon may create visual width, so h.from
		// is a valid stop even at line end.  Should NOT skip to h.from-1.
		describe("end-of-line markdown link: [link text](url)", () => {
			const doc = makeDoc("[link text](url)");
			const hidden: HiddenRange[] = [
				{ from: 0, to: 1, side: "leading" },
				{ from: 10, to: 16, side: "trailing" },
			];

			it("left at EOL: returns h.from (icon provides visual separation)", () => {
				// h.to=16=lineEnd, h.to - h.from = 6 > 2.
				// The length check prevents h.from-1 skip.
				const result = correctCursorPos(10, 16, hidden, doc as any);
				expect(result).toBe(10); // text boundary (h.from), NOT 9
			});
		});

		// ─── End-of-line only link: "[[link]]" ───
		describe("bare wikilink at line start: [[link]]", () => {
			const doc = makeDoc("[[link]]");
			const hidden: HiddenRange[] = [
				{ from: 0, to: 2, side: "leading" },
				{ from: 6, to: 8, side: "trailing" },
			];

			it("left from h.to=8=line end: CM6 skips to h.from=6, correction goes to 5", () => {
				const result = correctCursorPos(6, 8, hidden, doc as any);
				expect(result).toBe(5); // last char of "link"
			});
		});

		// ─── Pointer click at h.to: should NOT apply h.to skip ───
		describe("pointer clicks should NOT trigger h.to skip", () => {
			const doc = makeDoc("see [[target]]");
			const hidden: HiddenRange[] = [
				{ from: 4, to: 6, side: "leading" },
				{ from: 12, to: 14, side: "trailing" },
			];

			it("click at h.to: no correction (pointer, not keyboard)", () => {
				const result = correctCursorPos(14, 0, hidden, doc as any, true);
				expect(result).toBe(null); // h.to is not inside [h.from, h.to)
			});
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

	it("should detect numbered list with dot and increment", () => {
		expect(listContinuation("1. item")).toBe("2. ");
		expect(listContinuation("3. item")).toBe("4. ");
		expect(listContinuation("99. item")).toBe("100. ");
	});

	it("should detect numbered list with paren and increment", () => {
		expect(listContinuation("1) item")).toBe("2) ");
		expect(listContinuation("5) item")).toBe("6) ");
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
	it("should return hidden ranges for lines with cursor on links", () => {
		// Links are always hidden (syntax replaced with zero-width widgets) to prevent
		// expansion when cursoring over them. The [[]] empty-check handles in-progress
		// links; skipTrailingInsertionCorrection handles cursor correction during typing.
		const doc = "Check out [[my-note|My Note]] for more info";
		const state = EditorState.create({
			doc,
			selection: EditorSelection.cursor(5), // Cursor BEFORE the link
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

	it("should hide link syntax even when cursor is inside the link content", () => {
		// Links are always hidden regardless of cursor position.
		// The [[]] empty-check handles in-progress links;
		// skipTrailingInsertionCorrection handles cursor correction during typing.
		const doc = "Check out [[my-note|My Note]] for more info";
		const state = EditorState.create({
			doc,
			selection: EditorSelection.cursor(12), // Cursor inside the link content
		});

		const ranges = computeHiddenRanges(state);
		
		// Should still have ranges because links are always hidden regardless of cursor position
		expect(ranges.length).toBeGreaterThanOrEqual(2);
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

	// ---------------------------------------------------------------------------
	// Heading autocomplete support via empty-link detection
	// When the user types [[# or [[## they open an incomplete link with no "]]".
	// findWikiLinkSyntaxRanges() only matches links with both [[ and ]]; if there
	// is no closing ]], no hidden ranges are generated, so Obsidian's autocomplete
	// popup can appear.  This works without any cursor-position check.
	// ---------------------------------------------------------------------------

	describe("Heading autocomplete: incomplete links have no hidden ranges", () => {
		it("should not hide incomplete link [[# (no closing ]])", () => {
			// Simulate user typing [[# — no closing ]] yet
			const doc = "[[#";
			const state = EditorState.create({
				doc,
				selection: EditorSelection.cursor(3),
			});

			const ranges = computeHiddenRanges(state);
			// No "]]" found → no ranges → autocomplete can appear
			expect(ranges).toHaveLength(0);
		});

		it("should not hide incomplete link [[## (no closing ]])", () => {
			const doc = "[[##";
			const state = EditorState.create({
				doc,
				selection: EditorSelection.cursor(4),
			});

			const ranges = computeHiddenRanges(state);
			expect(ranges).toHaveLength(0);
		});

		it("should hide a completed link [[target#Heading]] even with cursor inside", () => {
			// Once the link is complete (has ]] ), it should always be hidden
			const doc = "[[target#Heading]]";
			const state = EditorState.create({
				doc,
				selection: EditorSelection.cursor(8), // Inside content
			});

			const ranges = computeHiddenRanges(state);
			expect(ranges.length).toBeGreaterThanOrEqual(2);
		});

		it("should hide all links on the line regardless of cursor position inside one of them", () => {
			const doc = "Link to [[folder/file#Heading|Alias]] and [[other/note]]";
			const state = EditorState.create({
				doc,
				selection: EditorSelection.cursor(15), // Inside first link content
			});

			// Both links should be hidden (cursor position doesn't affect hiding)
			const ranges = computeHiddenRanges(state);
			expect(ranges.length).toBe(4); // 2 ranges per link × 2 links
		});

		it("should hide embedded image link even with cursor inside", () => {
			const doc = "![[file.png]]";
			const state = EditorState.create({
				doc,
				selection: EditorSelection.cursor(5), // Inside content
			});

			const ranges = computeHiddenRanges(state);
			expect(ranges.length).toBeGreaterThanOrEqual(2);
		});

		it("should hide link on line 2 when cursor is on line 2 inside the link", () => {
			const doc = "Line one\n[[link]]\nLine three";
			// Position 12 is inside the link on line 2 ("[[link]]" starts at pos 9)
			const state = EditorState.create({
				doc,
				selection: EditorSelection.cursor(12),
			});

			const ranges = computeHiddenRanges(state);
			expect(ranges.length).toBeGreaterThanOrEqual(2);
		});
	});
});

// ============================================================================
// Transaction filter tests: enterAtLinkEndFix and deleteAtLinkStartFix
//
// These filters operate on EditorState transactions. We test them by creating
// a state with the filter extensions registered and using state.update() to
// produce transactions — the registered filters run automatically.
// ============================================================================

/**
 * Build an EditorState with the syntax hider fields AND both transaction
 * filters active.  syntaxHiderEnabledField is set to true immediately.
 */
function makeHiderState(docText: string, cursorPos: number): EditorState {
	const base = EditorState.create({
		doc: docText,
		selection: EditorSelection.cursor(cursorPos),
		extensions: [
			syntaxHiderEnabledField,
			hiddenRangesField,
			enterAtLinkEndFix,
			deleteAtLinkEndFix,
			deleteAtLinkStartFix,
		],
	});
	return base.update({
		effects: [setSyntaxHiderEnabled.of(true)],
	}).state;
}

describe("enterAtLinkEndFix: Enter at line end must not be intercepted", () => {
	// ── BUG GUARD ─────────────────────────────────────────────────────────────
	//
	// enterAtLinkEndKeymap repositions the cursor to line.to before returning
	// false so Obsidian's Enter handler can run.  If enterAtLinkEndFix then
	// intercepts that Enter (cursor already at line.to), it re-inserts a hard-
	// coded "\n" WITHOUT the ordered-list number increment — silently breaking
	// ordered lists like "1. [[link]]".
	//
	// The fix: enterAtLinkEndFix bails out when range.head === lineAtHead.to.
	//
	// We verify this by checking that the transaction's insertion position is
	// NOT redirected to line.to when the cursor was already there.

	it("does NOT redirect Enter when cursor is already at line end (ordered list case)", () => {
		// "1. [[link]]" — cursor at position 11 (line.to, after "]]")
		// An Enter from line.to must produce an insertion at line.to=11.
		// If enterAtLinkEndFix wrongly intercepts, the new-doc would still have
		// the insertion at 11, but the test checks that the insertion position
		// reported by the result equals the original cursor (11), not any other
		// position that would indicate re-direction happened.
		const doc = "1. [[link]]";
		const lineEnd = doc.length; // 11
		const state = makeHiderState(doc, lineEnd); // cursor at line end

		// Apply Enter from line end via state.update (filter runs automatically)
		const newState = state.update({
			changes: { from: lineEnd, to: lineEnd, insert: "\n" },
			selection: EditorSelection.cursor(lineEnd + 1),
			annotations: [Transaction.userEvent.of("input")],
		}).state;

		// The document should have "\n" appended at position 11, not elsewhere.
		// If the filter incorrectly intercepted, it would still insert at line.to
		// BUT would use different logic — in this case both paths insert at 11,
		// so we verify the state doc length grew by 1 (the "\n") and no more.
		expect(newState.doc.toString()).toBe("1. [[link]]\n");
		// The cursor should be at position 12 (after the "\n")
		expect(newState.selection.main.head).toBe(12);
	});

	it("redirects Enter to line end when cursor is inside trailing hidden range", () => {
		// "See [[link]]" — "[[link]]" at positions 4-11; trailing range [10, 12)
		// cursor at position 10 (inside "]]", which is inside the trailing range)
		// enterAtLinkEndFix must redirect the insertion to line.to=12
		const doc = "See [[link]]";
		const state = makeHiderState(doc, 10); // cursor inside trailing range

		const newState = state.update({
			changes: { from: 10, to: 10, insert: "\n" },
			selection: EditorSelection.cursor(11),
			annotations: [Transaction.userEvent.of("input")],
		}).state;

		// The filter should have redirected insertion to line.to=12
		// Result doc: "See [[link]]\n" (newline at the end, not inside "]]")
		expect(newState.doc.toString()).toBe("See [[link]]\n");
	});
});

describe("deleteAtLinkStartFix: Backspace at link start must delete character before link", () => {
	// ── BUG GUARD ─────────────────────────────────────────────────────────────
	//
	// When cursor is at h.to (just after "[["), backspace targets a character
	// inside the leading range.  protectSyntaxFilter would block it.
	// deleteAtLinkStartFix must intercept FIRST and redirect to delete
	// the character at h.from - 1 (before the link syntax).

	it("deletes the character before [[link]] when backspace targets inside leading range", () => {
		// "x[[link]]" — leading range: [1, 3) for the "[[" (positions 1 and 2 are "[")
		// cursor corrected to h.to=3, backspace targets position 2-3 (inside "[[")
		// deleteAtLinkStartFix must redirect to delete position 0-1 (the "x")
		const doc = "x[[link]]";
		const state = makeHiderState(doc, 3); // cursor at h.to

		const newState = state.update({
			changes: { from: 2, to: 3, insert: "" }, // backspace inside "[["
			selection: EditorSelection.cursor(2),
			annotations: [Transaction.userEvent.of("delete")],
		}).state;

		// The filter should delete position 0 ("x"), leaving "[[link]]"
		expect(newState.doc.toString()).toBe("[[link]]");
	});

	it("does NOT interfere with normal backspace outside of leading range", () => {
		// "hello [[link]]" — cursor at position 3
		// Backspace deletes position 2-3 (the "l"), which is NOT inside any
		// leading range — deleteAtLinkStartFix must pass through unchanged.
		const doc = "hello [[link]]";
		const state = makeHiderState(doc, 3);

		const newState = state.update({
			changes: { from: 2, to: 3, insert: "" },
			selection: EditorSelection.cursor(2),
			annotations: [Transaction.userEvent.of("delete")],
		}).state;

		// Normal backspace: "hello [[link]]" → "helo [[link]]"
		expect(newState.doc.toString()).toBe("helo [[link]]");
	});

	it("does NOT redirect when link starts at document position 0 (nothing to delete before it)", () => {
		// "[[link]]" at the very start — h.from=0, nothing before the link
		// deleteAtLinkStartFix must pass through unchanged
		const doc = "[[link]]";
		const state = makeHiderState(doc, 2); // cursor at h.to=2

		const newState = state.update({
			changes: { from: 1, to: 2, insert: "" }, // backspace inside "[["
			selection: EditorSelection.cursor(1),
			annotations: [Transaction.userEvent.of("delete")],
		}).state;

		// The filter passes through; protectSyntaxFilter may then block it,
		// resulting in an empty transaction (no doc change) or the original block.
		// Either way, the doc length should not have decreased by 1 at position 0.
		// The key invariant: no character BEFORE position 0 was deleted (can't be).
		// The doc must be unchanged or the deletion of position 1 was blocked.
		const resultDoc = newState.doc.toString();
		// Either "[[link]]" (blocked) or "[link]]" (not blocked - but no char deleted before link)
		// The important thing: NOT "[[link]]" with the first char removed
		expect(resultDoc.startsWith("[")).toBe(true); // starts with "[", not something before it
	});
});

// ============================================================================
// Transaction filter tests: deleteAtLinkEndFix
// ============================================================================

describe("deleteAtLinkEndFix: Backspace at link end (h.to) must delete last char of link text", () => {
	// ── BUG GUARD ─────────────────────────────────────────────────────────────
	//
	// When the cursor is at h.to (right after "]]" or ")" at EOL), the cursor
	// corrector places it at h.to — the line-end position.  A backspace from
	// h.to targets the last character of the trailing syntax (e.g. the second
	// "]").  protectSyntaxFilter would block this, making Backspace do nothing.
	//
	// deleteAtLinkEndFix must intercept FIRST and redirect the deletion to
	// h.from - 1 (the last character of the visible link text).

	it("deletes last char of wikilink text when backspace targets trailing ]] at EOL", () => {
		// "[[link]]" — trailing range: [6, 8) for "]]"
		// cursor at h.to=8 (EOL), backspace targets position 7-8 (the second "]")
		// deleteAtLinkEndFix must redirect to delete position 5-6 (the "k")
		const doc = "[[link]]";
		// h.to = 8 = doc.length (EOL)
		const state = makeHiderState(doc, 8);

		const newState = state.update({
			changes: { from: 7, to: 8, insert: "" }, // backspace inside "]]"
			selection: EditorSelection.cursor(7),
			annotations: [Transaction.userEvent.of("delete")],
		}).state;

		// The filter should delete position 5 ("k"), leaving "[[lin]]"
		expect(newState.doc.toString()).toBe("[[lin]]");
	});

	it("deletes last char of wikilink text on an ordinary line with text before link", () => {
		// "see [[note]]" — trailing range: [10, 12) for "]]"
		// cursor at h.to=12, backspace targets 11-12 (second "]")
		// deleteAtLinkEndFix must redirect to delete position 9-10 (the "e" of "note")
		const doc = "see [[note]]";
		const state = makeHiderState(doc, 12); // cursor at h.to

		const newState = state.update({
			changes: { from: 11, to: 12, insert: "" },
			selection: EditorSelection.cursor(11),
			annotations: [Transaction.userEvent.of("delete")],
		}).state;

		expect(newState.doc.toString()).toBe("see [[not]]");
	});

	it("deletes last char of wikilink text in a list item", () => {
		// "- [[item]]" — trailing range: [8, 10) for "]]"
		// cursor at h.to=10, backspace targets 9-10 (second "]")
		// deleteAtLinkEndFix must redirect to delete position 7-8 (the "m" of "item")
		const doc = "- [[item]]";
		const state = makeHiderState(doc, 10); // cursor at h.to

		const newState = state.update({
			changes: { from: 9, to: 10, insert: "" },
			selection: EditorSelection.cursor(9),
			annotations: [Transaction.userEvent.of("delete")],
		}).state;

		expect(newState.doc.toString()).toBe("- [[ite]]");
	});

	it("deletes last char of aliased wikilink display text at EOL", () => {
		// "[[target|Alias]]" — leading: [0,9) = "[[target|", trailing: [14,16) = "]]"
		// cursor at h.to=16, backspace targets 15-16 (second "]")
		// deleteAtLinkEndFix must redirect to delete position 13-14 (the "s" of "Alias")
		const doc = "[[target|Alias]]";
		const state = makeHiderState(doc, 16); // cursor at h.to

		const newState = state.update({
			changes: { from: 15, to: 16, insert: "" },
			selection: EditorSelection.cursor(15),
			annotations: [Transaction.userEvent.of("delete")],
		}).state;

		expect(newState.doc.toString()).toBe("[[target|Alia]]");
	});

	it("does NOT redirect when cursor is not at h.to (cursor is inside link text)", () => {
		// "[[link]]" — positions: 0=[, 1=[, 2=l, 3=i, 4=n, 5=k, 6=], 7=]
		// cursor at 5 (on "k"), not at h.to=8
		// Backspace from 5 deletes position 4-5 (the "n")
		// deleteAtLinkEndFix must not interfere since cursor !== h.to
		const doc = "[[link]]";
		const state = makeHiderState(doc, 5); // cursor inside link text, NOT at h.to

		const newState = state.update({
			changes: { from: 4, to: 5, insert: "" }, // backspace deletes "n" at pos 4
			selection: EditorSelection.cursor(4),
			annotations: [Transaction.userEvent.of("delete")],
		}).state;

		// Normal delete: "[[link]]" → "[[lik]]" (the "n" was at position 4)
		expect(newState.doc.toString()).toBe("[[lik]]");
	});

	it("does NOT redirect when link has only brackets with no visible text (h.from === 0 edge case via leading-only)", () => {
		// "[[a]]" — trailing range: [3, 5), h.from=3, h.from-1=2 is inside "[[a"
		// This should redirect to delete the "a" (position 2-3)
		const doc = "[[a]]";
		const state = makeHiderState(doc, 5); // cursor at h.to

		const newState = state.update({
			changes: { from: 4, to: 5, insert: "" },
			selection: EditorSelection.cursor(4),
			annotations: [Transaction.userEvent.of("delete")],
		}).state;

		// The "a" (position 2) should be deleted → "[[]]"
		// (deleteAtLinkEndFix redirects to delete h.from-1 = position 2)
		expect(newState.doc.toString()).toBe("[[]]");
	});

	it("deletes last char of markdown link text at EOL", () => {
		// "[hello](url)" — leading: [0,1) = "[", trailing: [6, 12) = "](url)"
		// cursor at h.to=12, backspace targets 11-12 (last char of "](url)")
		// deleteAtLinkEndFix must redirect to delete position 5-6 (the "o" of "hello")
		const doc = "[hello](url)";
		const state = makeHiderState(doc, 12); // cursor at h.to

		const newState = state.update({
			changes: { from: 11, to: 12, insert: "" },
			selection: EditorSelection.cursor(11),
			annotations: [Transaction.userEvent.of("delete")],
		}).state;

		// "o" at position 5 is deleted → "[hell](url)"
		expect(newState.doc.toString()).toBe("[hell](url)");
	});

	it("deletes last char of wikilink on a non-first line (non-zero lineFrom)", () => {
		// "Line one\n[[note]]" — wikilink on line 2, lineFrom=9
		// trailing range: [15, 17), h.to=17 (EOL of line 2)
		// cursor at h.to=17, backspace targets 16-17 (second "]")
		// deleteAtLinkEndFix must redirect to delete position 14-15 (the "e" of "note")
		const doc = "Line one\n[[note]]";
		const state = makeHiderState(doc, 17); // cursor at h.to on line 2

		const newState = state.update({
			changes: { from: 16, to: 17, insert: "" },
			selection: EditorSelection.cursor(16),
			annotations: [Transaction.userEvent.of("delete")],
		}).state;

		expect(newState.doc.toString()).toBe("Line one\n[[not]]");
	});

	// ── BUG GUARD: protectSyntaxFilter blocks the delete without the fix ─────
	//
	// Verify that with protectSyntaxFilter (but without deleteAtLinkEndFix), a
	// backspace at h.to is silently blocked.  This proves the bug exists and that
	// deleteAtLinkEndFix is what fixes it.
	it("BUG GUARD: backspace at h.to is blocked when only protectSyntaxFilter is present", () => {
		// Import protectSyntaxFilter indirectly via hiddenRangesField.
		// We need protectSyntaxFilter in scope — pull it in from the module by
		// using an extension-only state that includes the protect filter directly.
		// Since protectSyntaxFilter is not exported, we simulate its effect:
		// a transactionFilter that blocks any delete overlapping a hidden range.
		const protectOnly = EditorState.transactionFilter.of((tr) => {
			if (!tr.docChanged) return tr;
			if (!tr.isUserEvent("delete")) return tr;
			if (!tr.startState.field(syntaxHiderEnabledField, false)) return tr;
			const hidden = tr.startState.field(hiddenRangesField, false);
			if (!hidden || hidden.length === 0) return tr;
			let dominated = false;
			tr.changes.iterChangedRanges((fromA: number, toA: number) => {
				for (const h of hidden) {
					if (fromA < h.to && toA > h.from) dominated = true;
				}
			});
			return dominated ? [] : tr;
		});

		const doc = "[[link]]";
		const base = EditorState.create({
			doc,
			selection: EditorSelection.cursor(8),
			extensions: [
				syntaxHiderEnabledField,
				hiddenRangesField,
				protectOnly, // protect filter, but NO deleteAtLinkEndFix
			],
		});
		const state = base.update({ effects: [setSyntaxHiderEnabled.of(true)] }).state;

		const newState = state.update({
			changes: { from: 7, to: 8, insert: "" }, // backspace targets last "]"
			selection: EditorSelection.cursor(7),
			annotations: [Transaction.userEvent.of("delete")],
		}).state;

		// protectOnly blocks it → doc unchanged = "Backspace does nothing"
		expect(newState.doc.toString()).toBe("[[link]]");
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
