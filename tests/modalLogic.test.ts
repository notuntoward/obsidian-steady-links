import { describe, it, expect } from 'vitest';
import {
	parseClipboardFlags,
	determineInitialFocus,
	handleDestChange,
	computeConversionNotice,
	validateSubmission,
	determineInitialLinkType,
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
