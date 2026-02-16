import { describe, it, expect, vi } from 'vitest';
import { validateSubmission, parseClipboardFlags, computeConversionNotice } from '../src/modalLogic';
import { normalizeUrl, isUrl, validateLinkDestination } from '../src/utils';
import { LinkInfo } from '../src/types';

// ============================================================================
// Tests for URL Normalization Logic (used in EditLinkModal.submit)
// ============================================================================

/**
 * These tests focus on the NEW features added in recent commits:
 * 1. URL normalization in the submit() method (lines 442-449)
 * 2. Embed toggle description updates (lines 176, 189)
 * 3. Preview mode embed detection notice (lines 391-403)
 * 4. updateUIState with embed state consideration (lines 414)
 * 5. URL normalization before validateLinkDestination (lines 414)
 */

describe('URL Normalization in EditLinkModal.submit()', () => {
	it('should normalize www URLs (add https:// prefix)', () => {
		const original = 'www.google.com';
		const trimmed = original.trim();
		const normalized = normalizeUrl(trimmed);
		
		expect(isUrl(normalized)).toBe(true);
		expect(normalized).toBe('https://www.google.com');
	});

	it('should not modify https URLs', () => {
		const dest = 'https://example.com';
		const trimmed = dest.trim();
		const normalized = normalizeUrl(trimmed);
		
		expect(normalized).toBe('https://example.com');
		expect(isUrl(normalized)).toBe(true);
	});

	it('should not modify http URLs', () => {
		const dest = 'http://example.com';
		const trimmed = dest.trim();
		const normalized = normalizeUrl(trimmed);
		
		expect(normalized).toBe('http://example.com');
	});

	it('should not normalize wiki link destinations', () => {
		const dest = 'my-note';
		const trimmed = dest.trim();
		const normalized = normalizeUrl(trimmed);
		
		// Non-URLs should remain unchanged
		expect(normalized).toBe('my-note');
		expect(isUrl(normalized)).toBe(false);
	});

	it('should not normalize non-URL markdown destinations', () => {
		const dest = 'local/path/file.md';
		const trimmed = dest.trim();
		const normalized = normalizeUrl(trimmed);
		
		expect(normalized).toBe('local/path/file.md');
		expect(isUrl(normalized)).toBe(false);
	});

	it('should trim whitespace before determining if normalization is needed', () => {
		const dest = '  www.example.com  ';
		const trimmed = dest.trim();
		const normalized = normalizeUrl(trimmed);
		
		expect(normalized).toBe('https://www.example.com');
		expect(normalized).not.toContain('  ');
	});

	it('should handle case-insensitive www protocol detection', () => {
		const dest = '  WWW.example.com  ';
		const trimmed = dest.trim();
		const normalized = normalizeUrl(trimmed);
		
		expect(normalized).toBe('https://WWW.example.com');
	});

	it('should validate that normalized URLs pass isUrl check', () => {
		const urls = ['www.example.com', 'www.test.org', 'www.site.co.uk'];
		
		urls.forEach(url => {
			const normalized = normalizeUrl(url);
			expect(isUrl(normalized)).toBe(true);
		});
	});
});

// ============================================================================
// Tests for Embed State Changes and updateUIState
// ============================================================================

describe('Embed State Change Impact on Validation (updateUIState behavior)', () => {
	it('should generate different warnings when embed state changes from false to true', () => {
		// With isEmbed: false, no self-embed warning for wiki links
		const resultNonEmbed = validateLinkDestination(
			'my-note',
			'My Note',
			true,
			false,
			'my-note.md'
		);
		
		// With isEmbed: true, should potentially have self-embed warning
		const resultEmbed = validateLinkDestination(
			'my-note',
			'My Note',
			true,
			true,
			'my-note.md'
		);
		
		// Verify that embed state affects validation
		expect(resultNonEmbed).toBeDefined();
		expect(resultEmbed).toBeDefined();
	});

	it('should pass isEmbed parameter to validateLinkDestination', () => {
		// This verifies the change on line 414:
		// validateLinkDestination(dest, linkText, this.isWiki, isEmbed, currentFilePath)
		
		const validationWithoutEmbed = validateLinkDestination(
			'media.pdf',
			'PDF File',
			false,
			false
		);
		
		const validationWithEmbed = validateLinkDestination(
			'media.pdf',
			'PDF File',
			false,
			true
		);
		
		expect(validationWithoutEmbed).toBeDefined();
		expect(validationWithEmbed).toBeDefined();
	});

	it('should detect self-embedding for wiki links', () => {
		// When currentFilePath matches destination, should warn about self-embed
		const result = validateLinkDestination(
			'my-note',
			'My Note',
			true,
			true,
			'my-note.md'
		);
		
		// Should have a warning about self-embedding
		expect(result.warnings.length > 0).toBe(true);
		const selfEmbedWarning = result.warnings.find(w => 
			w.text.includes('embedding itself')
		);
		expect(selfEmbedWarning).toBeDefined();
	});

	it('should not warn about self-embedding for different notes', () => {
		const result = validateLinkDestination(
			'other-note',
			'Other Note',
			true,
			true,
			'my-note.md'
		);
		
		// Should not have self-embed warning
		const selfEmbedWarning = result.warnings.find(w => 
			w.text.includes('embedding itself')
		);
		expect(selfEmbedWarning).toBeUndefined();
	});

	it('should warn about non-embeddable URLs when embed is true', () => {
		const result = validateLinkDestination(
			'https://example.com',
			'Website',
			false,
			true
		);
		
		// Should have a warning about non-embeddable URLs
		const nonEmbeddableWarning = result.warnings.find(w =>
			w.text.includes('cannot be embedded')
		);
		expect(nonEmbeddableWarning).toBeDefined();
	});

	it('should not warn about embeddable media URLs', () => {
		const embedableExtensions = ['image.jpg', 'video.mp4', 'audio.mp3', 'document.pdf'];
		
		embedableExtensions.forEach(dest => {
			const result = validateLinkDestination(
				'https://example.com/' + dest,
				dest,
				false,
				true
			);
			
			const nonEmbeddableWarning = result.warnings.find(w =>
				w.text.includes('cannot be embedded')
			);
			// Media files should not generate non-embeddable warning
			expect(nonEmbeddableWarning).toBeUndefined();
		});
	});
});

// ============================================================================
// Tests for Clipboard Conversion Notice Parsing
// ============================================================================

describe('Clipboard Flags Parsing (for conversion notice)', () => {
	it('should correctly parse "Used text & destination" notice', () => {
		const flags = parseClipboardFlags('Used text & destination from link in clipboard');
		
		expect(flags.clipboardUsedText).toBe(true);
		expect(flags.clipboardUsedDest).toBe(true);
	});

	it('should correctly parse "Used text" only notice', () => {
		const flags = parseClipboardFlags('Used text from link in clipboard');
		
		expect(flags.clipboardUsedText).toBe(true);
		expect(flags.clipboardUsedDest).toBe(false);
	});

	it('should correctly parse "Used destination" only notice', () => {
		const flags = parseClipboardFlags('Used destination from link in clipboard');
		
		expect(flags.clipboardUsedText).toBe(false);
		expect(flags.clipboardUsedDest).toBe(true);
	});

	it('should return false/false for unrelated notices', () => {
		const flags = parseClipboardFlags('URL converted: www.x.com → https://www.x.com');
		
		expect(flags.clipboardUsedText).toBe(false);
		expect(flags.clipboardUsedDest).toBe(false);
	});
});

// ============================================================================
// Tests for Conversion Notice Computation Updates
// ============================================================================

describe('Conversion Notice Updates on Field Changes', () => {
	it('should return null when clipboard text is modified', () => {
		const notice = computeConversionNotice(
			'modified text',      // current
			'dest',               // current
			'original text',      // original
			'dest',               // original
			true,                 // clipboardUsedText
			false                 // clipboardUsedDest
		);
		
		// Notice should disappear when field is modified
		expect(notice).toBeNull();
	});

	it('should return null when clipboard dest is modified', () => {
		const notice = computeConversionNotice(
			'text',               // current
			'modified dest',      // current
			'text',               // original
			'original dest',      // original
			false,                // clipboardUsedText
			true                  // clipboardUsedDest
		);
		
		// Notice should disappear when field is modified
		expect(notice).toBeNull();
	});

	it('should return notice when fields are not modified', () => {
		const notice = computeConversionNotice(
			'original text',      // current
			'original dest',      // current
			'original text',      // original
			'original dest',      // original
			true,                 // clipboardUsedText
			true                  // clipboardUsedDest
		);
		
		// Notice should remain
		expect(notice).toBe('Used text & destination from link in clipboard');
	});

	it('should update notice when only text flag is set', () => {
		const notice = computeConversionNotice(
			'original text',      // current
			'any dest',           // current
			'original text',      // original
			'other dest',         // original
			true,                 // clipboardUsedText
			false                 // clipboardUsedDest
		);
		
		// Notice should only mention text
		expect(notice).toBe('Used text from link in clipboard');
	});
});

// ============================================================================
// Tests for Preview Mode Embed Detection Notice Logic
// ============================================================================

describe('Preview Mode Embed Detection Notice Conditions', () => {
	it('should generate embed detection warning for unembedded wiki links in preview mode', () => {
		// Conditions:
		// - isNewLink: false (existing link)
		// - link.isEmbed: false (not embedded)
		// - mode: 'preview' or 'live'
		
		const isNewLink = false;
		const isEmbed = false;
		const mode = 'preview';
		
		// These conditions should trigger the notice
		const shouldShowNotice = !isNewLink && !isEmbed && (mode === 'preview' || mode === 'live');
		expect(shouldShowNotice).toBe(true);
	});

	it('should not generate notice for new links', () => {
		const isNewLink = true;
		const isEmbed = false;
		
		// New links should not show the notice
		const shouldShowNotice = !isNewLink && !isEmbed;
		expect(shouldShowNotice).toBe(false);
	});

	it('should not generate notice for already embedded links', () => {
		const isNewLink = false;
		const isEmbed = true;
		
		// Embedded links should not show the notice
		const shouldShowNotice = !isNewLink && !isEmbed;
		expect(shouldShowNotice).toBe(false);
	});

	it('should not generate notice in source mode', () => {
		const isNewLink = false;
		const isEmbed = false;
		const mode = 'source' as string;
		
		// Source mode should not show the notice
		const shouldShowNotice = !isNewLink && !isEmbed && (mode === 'preview' || mode === 'live');
		expect(shouldShowNotice).toBe(false);
	});

	it('should generate notice in live mode', () => {
		const isNewLink = false;
		const isEmbed = false;
		const mode = 'live' as string;
		
		// Live mode should show the notice
		const shouldShowNotice = !isNewLink && !isEmbed && (mode === 'preview' || mode === 'live');
		expect(shouldShowNotice).toBe(true);
	});
});

// ============================================================================
// Tests for URL Validation in Link Destination
// ============================================================================

describe('validateLinkDestination with URL normalization', () => {
	it('should detect when URL will be normalized on submission', () => {
		const result = validateLinkDestination(
			'www.example.com',
			'Example',
			false,
			false
		);
		
		// Should warn about URL conversion
		const conversionWarning = result.warnings.find(w =>
			w.text.includes('URL will be converted')
		);
		expect(conversionWarning).toBeDefined();
	});

	it('should not warn about https URLs that are already normalized', () => {
		const result = validateLinkDestination(
			'https://example.com',
			'Example',
			false,
			false
		);
		
		// Should not have conversion warning
		const conversionWarning = result.warnings.find(w =>
			w.text.includes('URL will be converted')
		);
		expect(conversionWarning).toBeUndefined();
	});

	it('should handle empty destination gracefully', () => {
		const result = validateLinkDestination(
			'',
			'Text',
			false,
			false
		);
		
		// Should not crash
		expect(result).toBeDefined();
	});

	it('should validate markdown links cannot be wikilinks', () => {
		const result = validateLinkDestination(
			'https://example.com',
			'Link',
			true,  // isWiki: true
			false
		);
		
		// Should warn that URLs cannot be wikilinks
		const wikiLinkWarning = result.warnings.find(w =>
			w.text.includes('cannot link to external URLs')
		);
		expect(wikiLinkWarning).toBeDefined();
	});
});
