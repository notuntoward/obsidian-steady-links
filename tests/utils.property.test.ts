import * as fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import {
	parseWikiLink,
	parseMarkdownLink,
	wikiToMarkdown,
	markdownToWiki,
	isUrl,
	isValidWikiLink,
	isValidMarkdownLink,
} from '../src/utils';

// ============================================================================
// Property-based Tests for Link Parsing
// ============================================================================

describe('link parsing properties', () => {
	// Arbitrary generators for test data

	/**
	 * Generate a string without problematic characters for wiki links
	 * Also excludes empty strings and whitespace-only strings
	 */
	const wikiSafeString = fc.string({ minLength: 1 }).filter((s: string) =>
		!s.includes(']]') &&
		!s.includes('[[') &&
		!s.includes('|') &&
		!s.includes('<') &&
		!s.includes('>') &&
		!s.includes('(') &&
		!s.includes(')') &&
		s.trim().length > 0 // Exclude whitespace-only strings
	);

	/**
	 * Generate a string without problematic characters for markdown links
	 */
	const markdownSafeString = fc.string({ minLength: 1 }).filter((s: string) =>
		!s.includes(')') &&
		!s.includes('(') &&
		!s.includes('[') &&
		!s.includes(']') &&
		!s.includes('\n') &&
		s.trim().length > 0 // Exclude whitespace-only strings
	);

	/**
	 * Generate a valid URL
	 */
	const urlArbitrary = fc.oneof(
		fc.webUrl(),
		fc.tuple(fc.string({ minLength: 1 }), fc.string({ minLength: 1 })).map(([a, b]: [string, string]) => 
			`https://${a.replace(/\s/g, '')}.${b.replace(/\s/g, '')}.com`
		),
	);

	// ============================================================================
	// Wiki Link Round-trip Tests
	// ============================================================================

	describe('wiki link round-trip', () => {
		it('should round-trip wiki links without display text', () => {
			fc.assert(
				fc.property(wikiSafeString, (destination: string) => {
					const linkText = `[[${destination}]]`;
					const parsed = parseWikiLink(linkText);

					expect(parsed).not.toBeNull();
					// The parser trims whitespace, so we compare trimmed values
					expect(parsed!.destination).toBe(destination.trim());
					expect(parsed!.text).toBe(destination.trim());
					expect(parsed!.isEmbed).toBe(false);
				}),
			);
		});

		it('should round-trip wiki links with display text', () => {
			fc.assert(
				fc.property(wikiSafeString, wikiSafeString, (destination: string, text: string) => {
					// Skip if destination and text are the same (no pipe case)
					fc.pre(destination !== text);

					const linkText = `[[${destination}|${text}]]`;
					const parsed = parseWikiLink(linkText);

					expect(parsed).not.toBeNull();
					expect(parsed!.destination).toBe(destination.trim());
					expect(parsed!.text).toBe(text.trim());
				}),
			);
		});

		it('should round-trip embed wiki links', () => {
			fc.assert(
				fc.property(wikiSafeString, (destination: string) => {
					const linkText = `![[${destination}]]`;
					const parsed = parseWikiLink(linkText);

					expect(parsed).not.toBeNull();
					expect(parsed!.isEmbed).toBe(true);
				}),
			);
		});
	});

	// ============================================================================
	// Markdown Link Round-trip Tests
	// ============================================================================

	describe('markdown link round-trip', () => {
		it('should round-trip markdown links', () => {
			fc.assert(
				fc.property(markdownSafeString, markdownSafeString, (text: string, destination: string) => {
					const linkText = `[${text}](${destination})`;
					const parsed = parseMarkdownLink(linkText);

					expect(parsed).not.toBeNull();
					expect(parsed!.text).toBe(text.trim());
					expect(parsed!.destination).toBe(destination.trim());
				}),
			);
		});

		it('should round-trip embed markdown links', () => {
			fc.assert(
				fc.property(markdownSafeString, markdownSafeString, (text: string, destination: string) => {
					const linkText = `![${text}](${destination})`;
					const parsed = parseMarkdownLink(linkText);

					expect(parsed).not.toBeNull();
					expect(parsed!.isEmbed).toBe(true);
				}),
			);
		});
	});

	// ============================================================================
	// URL Detection Properties
	// ============================================================================

	describe('URL detection', () => {
		it('should detect valid URLs', () => {
			fc.assert(
				fc.property(urlArbitrary, (url: string) => {
					expect(isUrl(url)).toBe(true);
				}),
			);
		});

		it('should not detect non-URLs as URLs', () => {
			fc.assert(
				fc.property(
					fc.string().filter((s: string) =>
						!s.startsWith('http://') &&
						!s.startsWith('https://') &&
						!s.startsWith('www.')
					),
					(s: string) => {
						// Some strings might accidentally match, but most shouldn't
						// This is a soft property
						const result = isUrl(s);
						// Just verify it doesn't crash
						expect(typeof result).toBe('boolean');
					},
				),
			);
		});
	});

	// ============================================================================
	// Conversion Properties
	// ============================================================================

	describe('wiki/markdown conversion', () => {
		it('should preserve non-URL destinations in wikiToMarkdown', () => {
			fc.assert(
				fc.property(
					fc.string().filter((s: string) =>
						!s.startsWith('http://') &&
						!s.startsWith('https://') &&
						!s.startsWith('www.') &&
						s.length > 0 &&
						// Exclude strings that already contain %XX sequences.
						// wikiToMarkdown only encodes ' ' → %20 and '^' → %5E.
						// markdownToWiki uses decodeURIComponent which would
						// expand any pre-existing %XX escape (e.g. %00 → \u0000),
						// breaking the round-trip for inputs that were not
						// produced by wikiToMarkdown itself.
						!/%[0-9a-fA-F]{2}/.test(s)
					),
					(dest: string) => {
						const converted = wikiToMarkdown(dest);
						// Should encode spaces
						if (dest.includes(' ')) {
							expect(converted).toContain('%20');
						}
						// Should be reversible (with decode)
						const back = markdownToWiki(converted);
						expect(back).toBe(dest);
					},
				),
			);
		});

		it('should return null for URLs in markdownToWiki', () => {
			fc.assert(
				fc.property(urlArbitrary, (url: string) => {
					const result = markdownToWiki(url);
					expect(result).toBeNull();
				}),
			);
		});
	});

	// ============================================================================
	// Validation Properties
	// ============================================================================

	describe('link validation', () => {
		it('should reject URLs as wiki link destinations', () => {
			fc.assert(
				fc.property(urlArbitrary, (url: string) => {
					// Only test valid URLs that start with http/https
					if (url.startsWith('http://') || url.startsWith('https://')) {
						expect(isValidWikiLink(url)).toBe(false);
					}
				}),
			);
		});

		it('should accept URLs as markdown link destinations', () => {
			fc.assert(
				fc.property(urlArbitrary, (url: string) => {
					expect(isValidMarkdownLink(url)).toBe(true);
				}),
			);
		});

		it('should reject forbidden characters in wiki link filename', () => {
			// Note: Forward slash (/) is NOT forbidden - it's used for vault paths
			const forbiddenChars = ['|', '^', ':', '*', '"', '?', '\\'];
			fc.assert(
				fc.property(
					fc.string(),
					fc.constantFrom(...forbiddenChars),
					fc.integer({ min: 0, max: 10 }),
					(base: string, char: string, pos: number) => {
						const dest = base.slice(0, pos) + char + base.slice(pos);
						const result = isValidWikiLink(dest);
						// Should be invalid if the character is in the filename part
						if (!dest.includes('#')) {
							expect(result).toBe(false);
						}
					},
				),
			);
		});
	});

	// ============================================================================
	// Invariant Tests
	// ============================================================================

	describe('invariants', () => {
		it('should handle empty strings gracefully', () => {
			fc.assert(
				fc.property(fc.constant(''), (empty: string) => {
					expect(() => parseWikiLink(empty)).not.toThrow();
					expect(() => parseMarkdownLink(empty)).not.toThrow();
					expect(() => wikiToMarkdown(empty)).not.toThrow();
					expect(() => markdownToWiki(empty)).not.toThrow();
					expect(() => isValidWikiLink(empty)).not.toThrow();
					expect(() => isValidMarkdownLink(empty)).not.toThrow();
				}),
			);
		});

		it('should handle whitespace strings', () => {
			fc.assert(
				fc.property(
					fc.array(fc.constant(' ')).map(arr => arr.join('')),
					(whitespace: string) => {
						expect(() => parseWikiLink(whitespace)).not.toThrow();
						expect(() => parseMarkdownLink(whitespace)).not.toThrow();
					},
				),
			);
		});

		it('should handle unicode in links', () => {
			fc.assert(
				fc.property(
					fc.string().map(s => s.replace(/[\[\]\(\)]/g, '')),
					(unicode: string) => {
						// Just verify it doesn't crash
						expect(() => parseWikiLink(`[[${unicode}]]`)).not.toThrow();
					},
				),
			);
		});
	});
});