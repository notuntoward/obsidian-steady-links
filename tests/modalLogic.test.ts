import { describe, it, expect } from 'vitest';
import {
	parseClipboardFlags,
	determineInitialFocus,
	handleDestChange,
	computeConversionNotice,
	validateSubmission,
	determineInitialLinkType,
	buildLinkText,
	computeCloseCursorPosition,
	computeSkipCursorPosition,
} from '../src/modalLogic';

// ============================================================================
// parseClipboardFlags Tests
// ============================================================================
describe('parseClipboardFlags', () => {
	it('should return false/false for null notice', () => {
		expect(parseClipboardFlags(null)).toEqual({
			clipboardUsedText: false,
			clipboardUsedDest: false,
		});
	});

	it('should return false/false for undefined notice', () => {
		expect(parseClipboardFlags(undefined)).toEqual({
			clipboardUsedText: false,
			clipboardUsedDest: false,
		});
	});

	it('should return false/false for empty string', () => {
		expect(parseClipboardFlags('')).toEqual({
			clipboardUsedText: false,
			clipboardUsedDest: false,
		});
	});

	it('should detect "text & destination" notice', () => {
		expect(parseClipboardFlags('Used text & destination from link in clipboard')).toEqual({
			clipboardUsedText: true,
			clipboardUsedDest: true,
		});
	});

	it('should detect "text" only notice', () => {
		expect(parseClipboardFlags('Used text from link in clipboard')).toEqual({
			clipboardUsedText: true,
			clipboardUsedDest: false,
		});
	});

	it('should detect "destination" only notice', () => {
		expect(parseClipboardFlags('Used destination from link in clipboard')).toEqual({
			clipboardUsedText: false,
			clipboardUsedDest: true,
		});
	});

	it('should return false/false for unrecognized notice', () => {
		expect(parseClipboardFlags('URL converted: www.x.com → https://www.x.com')).toEqual({
			clipboardUsedText: false,
			clipboardUsedDest: false,
		});
	});

	it('should prioritize "text & destination" over partial matches', () => {
		// "text & destination" contains both "text" and "destination"
		// but the check for "text & destination" should match first
		const result = parseClipboardFlags('text & destination');
		expect(result.clipboardUsedText).toBe(true);
		expect(result.clipboardUsedDest).toBe(true);
	});
});

// ============================================================================
// determineInitialFocus Tests
// ============================================================================
describe('determineInitialFocus', () => {
	it('should focus text when text is empty', () => {
		expect(determineInitialFocus('', 'dest', false)).toBe('text-focus');
	});

	it('should focus dest when dest is empty and text has content', () => {
		expect(determineInitialFocus('Link Text', '', false)).toBe('dest-focus');
	});

	it('should select dest when dest is very long (>500)', () => {
		const longDest = 'a'.repeat(501);
		expect(determineInitialFocus('Text', longDest, false)).toBe('dest-select');
	});

	it('should select dest when dest looks like an almost-URL', () => {
		expect(determineInitialFocus('Text', 'htp://example.com', false)).toBe('dest-select');
	});

	it('should select text when shouldSelectText is true', () => {
		expect(determineInitialFocus('Text', 'dest', true)).toBe('text-select');
	});

	it('should select text by default when both fields have content', () => {
		expect(determineInitialFocus('Text', 'dest', false)).toBe('text-select');
	});

	it('should prefer dest-select over text-select for almost-URLs even if shouldSelectText is true', () => {
		expect(determineInitialFocus('Text', 'htp://example.com', true)).toBe('dest-select');
	});
});

// ============================================================================
// handleDestChange Tests
// ============================================================================
describe('handleDestChange', () => {
	it('should auto-switch from wiki to markdown when dest is a URL', () => {
		const result = handleDestChange('https://example.com', true);
		expect(result.isWiki).toBe(false);
		expect(result.wasUrl).toBe(true);
	});

	it('should keep wiki when dest is not a URL', () => {
		const result = handleDestChange('my-note', true);
		expect(result.isWiki).toBe(true);
		expect(result.wasUrl).toBe(false);
	});

	it('should keep markdown when dest is a URL', () => {
		const result = handleDestChange('https://example.com', false);
		expect(result.isWiki).toBe(false);
		expect(result.wasUrl).toBe(true);
	});

	it('should keep markdown when dest is not a URL', () => {
		const result = handleDestChange('file.md', false);
		expect(result.isWiki).toBe(false);
		expect(result.wasUrl).toBe(false);
	});

	it('should detect www URLs', () => {
		const result = handleDestChange('www.example.com', true);
		expect(result.isWiki).toBe(false);
		expect(result.wasUrl).toBe(true);
	});

	it('should not treat non-URLs as URLs', () => {
		const result = handleDestChange('example.com', true);
		expect(result.isWiki).toBe(true);
		expect(result.wasUrl).toBe(false);
	});

	it('should handle empty dest', () => {
		const result = handleDestChange('', true);
		expect(result.isWiki).toBe(true);
		expect(result.wasUrl).toBe(false);
	});
});

// ============================================================================
// computeConversionNotice Tests
// ============================================================================
describe('computeConversionNotice', () => {
	it('should return null when neither field was from clipboard', () => {
		const result = computeConversionNotice(
			'text', 'dest', 'original', 'originalDest', false, false,
		);
		expect(result).toBe(null);
	});

	it('should return null when text was from clipboard but user changed it', () => {
		const result = computeConversionNotice(
			'changed text', 'dest', 'original text', 'dest', true, false,
		);
		expect(result).toBe(null);
	});

	it('should return null when dest was from clipboard but user changed it', () => {
		const result = computeConversionNotice(
			'text', 'changed dest', 'text', 'original dest', false, true,
		);
		expect(result).toBe(null);
	});

	it('should return "text & destination" when both still unchanged', () => {
		const result = computeConversionNotice(
			'original text', 'original dest',
			'original text', 'original dest',
			true, true,
		);
		expect(result).toBe('Used text & destination from link in clipboard');
	});

	it('should return "text" when only text still matches', () => {
		const result = computeConversionNotice(
			'original text', 'changed dest',
			'original text', 'original dest',
			true, true,
		);
		expect(result).toBe('Used text from link in clipboard');
	});

	it('should return "destination" when only dest still matches', () => {
		const result = computeConversionNotice(
			'changed text', 'original dest',
			'original text', 'original dest',
			true, true,
		);
		expect(result).toBe('Used destination from link in clipboard');
	});

	it('should return null when both changed even if flags say clipboard', () => {
		const result = computeConversionNotice(
			'changed text', 'changed dest',
			'original text', 'original dest',
			true, true,
		);
		expect(result).toBe(null);
	});

	it('should show text notice when only text flag is set and text matches', () => {
		const result = computeConversionNotice(
			'clip text', 'any dest',
			'clip text', 'other dest',
			true, false,
		);
		expect(result).toBe('Used text from link in clipboard');
	});

	it('should show dest notice when only dest flag is set and dest matches', () => {
		const result = computeConversionNotice(
			'any text', 'clip dest',
			'other text', 'clip dest',
			false, true,
		);
		expect(result).toBe('Used destination from link in clipboard');
	});
});

// ============================================================================
// validateSubmission Tests
// ============================================================================
describe('validateSubmission', () => {
	it('should reject empty destination', () => {
		const result = validateSubmission('Link Text', '');
		expect(result.valid).toBe(false);
		expect(result.error).toBe('Error: Destination is required.');
	});

	it('should reject whitespace-only destination', () => {
		const result = validateSubmission('Link Text', '   ');
		expect(result.valid).toBe(false);
		expect(result.error).toBe('Error: Destination is required.');
	});

	it('should accept valid text and destination', () => {
		const result = validateSubmission('Link Text', 'my-note');
		expect(result.valid).toBe(true);
		expect(result.finalText).toBe('Link Text');
		expect(result.finalDest).toBe('my-note');
		expect(result.error).toBeUndefined();
	});

	it('should use destination as text when text is empty', () => {
		const result = validateSubmission('', 'my-note');
		expect(result.valid).toBe(true);
		expect(result.finalText).toBe('my-note');
		expect(result.finalDest).toBe('my-note');
	});

	it('should use destination as text when text is whitespace', () => {
		const result = validateSubmission('   ', 'my-note');
		expect(result.valid).toBe(true);
		expect(result.finalText).toBe('my-note');
	});

	it('should trim text and destination', () => {
		const result = validateSubmission('  Link Text  ', '  my-note  ');
		expect(result.valid).toBe(true);
		expect(result.finalText).toBe('Link Text');
		expect(result.finalDest).toBe('my-note');
	});

	it('should handle URL destinations', () => {
		const result = validateSubmission('Google', 'https://google.com');
		expect(result.valid).toBe(true);
		expect(result.finalText).toBe('Google');
		expect(result.finalDest).toBe('https://google.com');
	});
});

// ============================================================================
// determineInitialLinkType Tests
// ============================================================================
describe('determineInitialLinkType', () => {
	it('should force markdown for URL destination', () => {
		const result = determineInitialLinkType('https://example.com', true);
		expect(result.isWiki).toBe(false);
		expect(result.wasUrl).toBe(true);
	});

	it('should keep wiki for non-URL destination when originally wiki', () => {
		const result = determineInitialLinkType('my-note', true);
		expect(result.isWiki).toBe(true);
		expect(result.wasUrl).toBe(false);
	});

	it('should keep markdown for non-URL destination when originally markdown', () => {
		const result = determineInitialLinkType('my-note', false);
		expect(result.isWiki).toBe(false);
		expect(result.wasUrl).toBe(false);
	});

	it('should force markdown for www URLs', () => {
		const result = determineInitialLinkType('www.example.com', true);
		expect(result.isWiki).toBe(false);
		expect(result.wasUrl).toBe(true);
	});

	it('should handle empty destination', () => {
		const result = determineInitialLinkType('', true);
		expect(result.isWiki).toBe(true);
		expect(result.wasUrl).toBe(false);
	});

	it('should handle empty destination with markdown', () => {
		const result = determineInitialLinkType('', false);
		expect(result.isWiki).toBe(false);
		expect(result.wasUrl).toBe(false);
	});
});

// ============================================================================
// buildLinkText Tests
// ============================================================================
describe('buildLinkText', () => {
	it('should build markdown link', () => {
		expect(buildLinkText({
			text: 'click here', destination: 'https://example.com',
			isWiki: false, isEmbed: false,
		})).toBe('[click here](https://example.com)');
	});

	it('should build wiki link with display text', () => {
		expect(buildLinkText({
			text: 'display', destination: 'my-note',
			isWiki: true, isEmbed: false,
		})).toBe('[[my-note|display]]');
	});

	it('should build wiki link without display text when text equals destination', () => {
		expect(buildLinkText({
			text: 'my-note', destination: 'my-note',
			isWiki: true, isEmbed: false,
		})).toBe('[[my-note]]');
	});

	it('should add embed prefix for markdown embed', () => {
		expect(buildLinkText({
			text: 'alt text', destination: 'image.png',
			isWiki: false, isEmbed: true,
		})).toBe('![alt text](image.png)');
	});

	it('should add embed prefix for wiki embed', () => {
		expect(buildLinkText({
			text: 'photo.png', destination: 'photo.png',
			isWiki: true, isEmbed: true,
		})).toBe('![[photo.png]]');
	});

	it('should add embed prefix for wiki embed with display text', () => {
		expect(buildLinkText({
			text: 'my photo', destination: 'photo.png',
			isWiki: true, isEmbed: true,
		})).toBe('![[photo.png|my photo]]');
	});
});

// ============================================================================
// computeCloseCursorPosition Tests
// ============================================================================
describe('computeCloseCursorPosition', () => {
	// Helper to build params with sensible defaults
	function params(overrides: Partial<Parameters<typeof computeCloseCursorPosition>[0]>) {
		return {
			linkStart: 5,
			linkEnd: 20,
			lineLength: 30,
			line: 3,
			preferRight: false,
			lineCount: 10,
			prevLineLength: 15,
			...overrides,
		};
	}

	// ── Prefer left (enteredFromLeft = true) ────────────────────────────

	describe('preferRight = false (entered from left)', () => {
		it('should place cursor one before the link start', () => {
			// Line: "Hello [text](dest) more"
			//        ^    ^             ^
			//        0    5=linkStart   20=linkEnd, lineLength=30
			const result = computeCloseCursorPosition(params({
				linkStart: 5, linkEnd: 20, lineLength: 30, preferRight: false,
			}));
			expect(result).toEqual({ line: 3, ch: 4 }); // start - 1
		});

		it('should fall back to right side when link starts at column 0', () => {
			// Line: "[text](dest) more"
			//        ^           ^    ^
			//        0=start     12   17=lineLength
			const result = computeCloseCursorPosition(params({
				linkStart: 0, linkEnd: 12, lineLength: 17, preferRight: false,
			}));
			expect(result).toEqual({ line: 3, ch: 13 }); // linkEnd + 1
		});
	});

	// ── Prefer right (entered from right or alwaysMoveToEnd) ────────────

	describe('preferRight = true (entered from right / alwaysMoveToEnd)', () => {
		it('should place cursor one past the link end', () => {
			// Line: "Hello [text](dest) more"
			const result = computeCloseCursorPosition(params({
				linkStart: 5, linkEnd: 20, lineLength: 30, preferRight: true,
			}));
			expect(result).toEqual({ line: 3, ch: 21 }); // linkEnd + 1
		});

		it('should fall back to left side when link ends at end of line', () => {
			// Line: "Hello [text](dest)"
			//        ^    ^             ^
			//        0    5=start       18=linkEnd=lineLength
			const result = computeCloseCursorPosition(params({
				linkStart: 5, linkEnd: 18, lineLength: 18, preferRight: true,
			}));
			expect(result).toEqual({ line: 3, ch: 4 }); // start - 1
		});
	});

	// ── Link spans entire line ──────────────────────────────────────────

	describe('link spans entire line', () => {
		it('should move to next line when available', () => {
			// Line 3 is entirely a link, e.g. "[[my note]]"
			const result = computeCloseCursorPosition(params({
				linkStart: 0, linkEnd: 11, lineLength: 11,
				line: 3, lineCount: 10,
			}));
			expect(result).toEqual({ line: 4, ch: 0 });
		});

		it('should move to previous line when on last line', () => {
			// Last line of document is entirely a link
			const result = computeCloseCursorPosition(params({
				linkStart: 0, linkEnd: 14, lineLength: 14,
				line: 9, lineCount: 10, prevLineLength: 20,
			}));
			expect(result).toEqual({ line: 8, ch: 20 });
		});

		it('should move to end of previous line (respecting its length)', () => {
			const result = computeCloseCursorPosition(params({
				linkStart: 0, linkEnd: 8, lineLength: 8,
				line: 5, lineCount: 6, prevLineLength: 0,
			}));
			expect(result).toEqual({ line: 4, ch: 0 }); // prev line is empty
		});

		it('should use best-effort for single-line document', () => {
			// Only line in the document is entirely a link
			const result = computeCloseCursorPosition(params({
				linkStart: 0, linkEnd: 12, lineLength: 12,
				line: 0, lineCount: 1, prevLineLength: 0,
			}));
			expect(result).toEqual({ line: 0, ch: 12 }); // best effort
		});
	});

	// ── Edge cases ──────────────────────────────────────────────────────

	describe('edge cases', () => {
		it('should handle link at start with text after (prefer left → falls to right)', () => {
			const result = computeCloseCursorPosition(params({
				linkStart: 0, linkEnd: 10, lineLength: 20, preferRight: false,
			}));
			expect(result).toEqual({ line: 3, ch: 11 }); // can't go left, go right
		});

		it('should handle link at end with text before (prefer right → falls to left)', () => {
			const result = computeCloseCursorPosition(params({
				linkStart: 10, linkEnd: 25, lineLength: 25, preferRight: true,
			}));
			expect(result).toEqual({ line: 3, ch: 9 }); // can't go right, go left
		});

		it('should prefer next line over previous line for full-line links', () => {
			// When both adjacent lines exist, prefer next line
			const result = computeCloseCursorPosition(params({
				linkStart: 0, linkEnd: 15, lineLength: 15,
				line: 5, lineCount: 10, prevLineLength: 25,
			}));
			expect(result).toEqual({ line: 6, ch: 0 }); // next line, not previous
		});

		it('should handle first line that spans entirely with next line available', () => {
			const result = computeCloseCursorPosition(params({
				linkStart: 0, linkEnd: 20, lineLength: 20,
				line: 0, lineCount: 5, prevLineLength: 0,
			}));
			expect(result).toEqual({ line: 1, ch: 0 });
		});

		it('should handle short link in middle of line (prefer left)', () => {
			// "Abc [[x]] def"  — link from 4 to 9, line length 13
			const result = computeCloseCursorPosition(params({
				linkStart: 4, linkEnd: 9, lineLength: 13, preferRight: false,
			}));
			expect(result).toEqual({ line: 3, ch: 3 }); // start - 1
		});

		it('should handle short link in middle of line (prefer right)', () => {
			// "Abc [[x]] def"  — link from 4 to 9, line length 13
			const result = computeCloseCursorPosition(params({
				linkStart: 4, linkEnd: 9, lineLength: 13, preferRight: true,
			}));
			expect(result).toEqual({ line: 3, ch: 10 }); // linkEnd + 1
		});
	});
});

// ============================================================================
// computeSkipCursorPosition Tests
// ============================================================================
describe('computeSkipCursorPosition', () => {
	// Helper to build params with sensible defaults
	function params(overrides: Partial<Parameters<typeof computeSkipCursorPosition>[0]>) {
		return {
			linkStart: 5,
			linkEnd: 20,
			cursorPos: 10,
			lineLength: 30,
			line: 3,
			lineCount: 10,
			prevLineLength: 15,
			...overrides,
		};
	}

	describe('cursor on left side of link (skip right)', () => {
		it('should skip to position after link when cursor is at link start', () => {
			// Line: "Hello [text](dest) more"
			//        ^    ^             ^    ^
			//        0    5=start,cur   20   30
			const result = computeSkipCursorPosition(params({
				linkStart: 5, linkEnd: 20, cursorPos: 5, lineLength: 30,
			}));
			expect(result).toEqual({ line: 3, ch: 21 }); // linkEnd + 1
		});

		it('should skip to position after link when cursor is in left half', () => {
			// Cursor at position 10 (closer to start at 5 than end at 20)
			const result = computeSkipCursorPosition(params({
				linkStart: 5, linkEnd: 20, cursorPos: 10, lineLength: 30,
			}));
			expect(result).toEqual({ line: 3, ch: 21 }); // linkEnd + 1
		});

		it('should skip to next line when link is at end of line', () => {
			// Line: "Hello [text](dest)"
			//        ^    ^             ^
			//        0    5=start,cur   18=linkEnd=lineLength
			const result = computeSkipCursorPosition(params({
				linkStart: 5, linkEnd: 18, cursorPos: 5, lineLength: 18,
			}));
			expect(result).toEqual({ line: 4, ch: 0 }); // next line
		});

		it('should fall back to left side when link ends at line end on last line', () => {
			const result = computeSkipCursorPosition(params({
				linkStart: 5, linkEnd: 18, cursorPos: 5, lineLength: 18,
				line: 9, lineCount: 10,
			}));
			expect(result).toEqual({ line: 9, ch: 4 }); // linkStart - 1
		});

		it('should skip to position after link when cursor is exactly at center', () => {
			// When exactly at center, treat as left side
			const result = computeSkipCursorPosition(params({
				linkStart: 5, linkEnd: 15, cursorPos: 10, lineLength: 30,
			}));
			expect(result).toEqual({ line: 3, ch: 16 }); // linkEnd + 1
		});
	});

	describe('cursor on right side of link (skip left)', () => {
		it('should skip to position before link when cursor is at link end', () => {
			// Line: "Hello [text](dest) more"
			const result = computeSkipCursorPosition(params({
				linkStart: 5, linkEnd: 20, cursorPos: 20, lineLength: 30,
			}));
			expect(result).toEqual({ line: 3, ch: 4 }); // linkStart - 1
		});

		it('should skip to position before link when cursor is in right half', () => {
			// Cursor at position 15 (closer to end at 20 than start at 5)
			const result = computeSkipCursorPosition(params({
				linkStart: 5, linkEnd: 20, cursorPos: 15, lineLength: 30,
			}));
			expect(result).toEqual({ line: 3, ch: 4 }); // linkStart - 1
		});

		it('should skip to previous line when link is at start of line', () => {
			// Line: "[text](dest) more"
			//        ^           ^
			//        0=start     12=end,cur
			const result = computeSkipCursorPosition(params({
				linkStart: 0, linkEnd: 12, cursorPos: 12, lineLength: 17,
				prevLineLength: 20,
			}));
			expect(result).toEqual({ line: 2, ch: 20 }); // end of prev line
		});

		it('should fall back to right side when link starts at col 0 on first line', () => {
			const result = computeSkipCursorPosition(params({
				linkStart: 0, linkEnd: 12, cursorPos: 12, lineLength: 17,
				line: 0,
			}));
			expect(result).toEqual({ line: 0, ch: 13 }); // linkEnd + 1
		});
	});

	describe('link spans entire line', () => {
		it('should move to next line when cursor on left and next line available', () => {
			// Line: "[[my note]]"
			const result = computeSkipCursorPosition(params({
				linkStart: 0, linkEnd: 11, cursorPos: 0, lineLength: 11,
				line: 3, lineCount: 10,
			}));
			expect(result).toEqual({ line: 4, ch: 0 });
		});

		it('should move to previous line when cursor on right and prev line available', () => {
			// Line: "[[my note]]"
			const result = computeSkipCursorPosition(params({
				linkStart: 0, linkEnd: 11, cursorPos: 11, lineLength: 11,
				line: 3, lineCount: 10, prevLineLength: 25,
			}));
			expect(result).toEqual({ line: 2, ch: 25 });
		});

		it('should fall back to prev line when cursor on left and on last line', () => {
			const result = computeSkipCursorPosition(params({
				linkStart: 0, linkEnd: 11, cursorPos: 0, lineLength: 11,
				line: 9, lineCount: 10, prevLineLength: 20,
			}));
			expect(result).toEqual({ line: 8, ch: 20 });
		});

		it('should fall back to next line when cursor on right and on first line', () => {
			const result = computeSkipCursorPosition(params({
				linkStart: 0, linkEnd: 11, cursorPos: 11, lineLength: 11,
				line: 0, lineCount: 10,
			}));
			expect(result).toEqual({ line: 1, ch: 0 });
		});

		it('should use best effort (end) for single-line doc with cursor on left', () => {
			const result = computeSkipCursorPosition(params({
				linkStart: 0, linkEnd: 11, cursorPos: 0, lineLength: 11,
				line: 0, lineCount: 1,
			}));
			expect(result).toEqual({ line: 0, ch: 11 }); // best effort
		});

		it('should use best effort (start) for single-line doc with cursor on right', () => {
			const result = computeSkipCursorPosition(params({
				linkStart: 0, linkEnd: 11, cursorPos: 11, lineLength: 11,
				line: 0, lineCount: 1,
			}));
			expect(result).toEqual({ line: 0, ch: 0 }); // best effort
		});
	});

	describe('edge cases', () => {
		it('should handle link at start of line with cursor on left (skip right)', () => {
			// Line: "[text](dest) more"
			const result = computeSkipCursorPosition(params({
				linkStart: 0, linkEnd: 12, cursorPos: 0, lineLength: 17,
			}));
			expect(result).toEqual({ line: 3, ch: 13 }); // skip right to linkEnd + 1
		});

		it('should handle link at end of line with cursor on right (skip left)', () => {
			// Line: "Hello [text](dest)"
			const result = computeSkipCursorPosition(params({
				linkStart: 6, linkEnd: 18, cursorPos: 18, lineLength: 18,
			}));
			expect(result).toEqual({ line: 3, ch: 5 }); // skip left to linkStart - 1
		});

		it('should handle short link with cursor just past center', () => {
			// "Abc [[x]] def"  — link from 4 to 9, cursor at 7 (right of center 6.5)
			const result = computeSkipCursorPosition(params({
				linkStart: 4, linkEnd: 9, cursorPos: 7, lineLength: 13,
			}));
			expect(result).toEqual({ line: 3, ch: 3 }); // skip left to linkStart - 1
		});

		it('should handle short link with cursor just before center', () => {
			// "Abc [[x]] def"  — link from 4 to 9, cursor at 6 (left of center 6.5)
			const result = computeSkipCursorPosition(params({
				linkStart: 4, linkEnd: 9, cursorPos: 6, lineLength: 13,
			}));
			expect(result).toEqual({ line: 3, ch: 10 }); // skip right to linkEnd + 1
		});

		it('should prefer next line over previous line for full-line links (skip right)', () => {
			// When both adjacent lines exist and skipping right, prefer next line
			const result = computeSkipCursorPosition(params({
				linkStart: 0, linkEnd: 15, cursorPos: 0, lineLength: 15,
				line: 5, lineCount: 10, prevLineLength: 25,
			}));
			expect(result).toEqual({ line: 6, ch: 0 }); // next line, not previous
		});

		it('should prefer prev line over next line for full-line links (skip left)', () => {
			// When both adjacent lines exist and skipping left, prefer prev line
			const result = computeSkipCursorPosition(params({
				linkStart: 0, linkEnd: 15, cursorPos: 15, lineLength: 15,
				line: 5, lineCount: 10, prevLineLength: 25,
			}));
			expect(result).toEqual({ line: 4, ch: 25 }); // prev line, not next
		});
	});
});
