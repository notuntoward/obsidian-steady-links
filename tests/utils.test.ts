import { describe, it, expect } from 'vitest';
import {
	isValidWikiLink,
	isValidMarkdownLink,
	wikiToMarkdown,
	markdownToWiki,
	parseWikiLink,
	parseMarkdownLink,
	parseClipboardLink,
	isUrl,
	normalizeUrl,
	isAlmostUrl,
	urlAtCursor,
	detectMarkdownLinkAtCursor,
	detectWikiLinkAtCursor,
	detectLinkAtCursor,
	determineLinkFromContext,
	validateLinkDestination,
} from '../src/utils';

// ============================================================================
// isValidWikiLink Tests
// ============================================================================
describe('isValidWikiLink', () => {
	it('should reject empty string', () => {
		expect(isValidWikiLink('')).toBe(false);
	});

	it('should reject URLs', () => {
		expect(isValidWikiLink('https://example.com')).toBe(false);
		expect(isValidWikiLink('http://example.com')).toBe(false);
	});

	it('should reject destinations with angle brackets', () => {
		expect(isValidWikiLink('file<name>')).toBe(false);
		expect(isValidWikiLink('file>name')).toBe(false);
		expect(isValidWikiLink('<file>')).toBe(false);
	});

	it('should reject destinations with parentheses', () => {
		expect(isValidWikiLink('file(name)')).toBe(false);
		expect(isValidWikiLink('(file)')).toBe(false);
	});

	it('should reject Obsidian forbidden characters in filename', () => {
		expect(isValidWikiLink('file|name')).toBe(false);
		expect(isValidWikiLink('file^name')).toBe(false);
		expect(isValidWikiLink('file:name')).toBe(false);
		expect(isValidWikiLink('file%%name')).toBe(false);
		expect(isValidWikiLink('[[file]]')).toBe(false);
		expect(isValidWikiLink('file[[name')).toBe(false);
	});

	it('should reject OS forbidden characters in filename', () => {
		expect(isValidWikiLink('file*name')).toBe(false);
		expect(isValidWikiLink('file"name')).toBe(false);
		expect(isValidWikiLink('file?name')).toBe(false);
		expect(isValidWikiLink('file\\name')).toBe(false);
		expect(isValidWikiLink('file/name')).toBe(false);
	});

	it('should accept valid wikilink filenames', () => {
		expect(isValidWikiLink('MyFile')).toBe(true);
		expect(isValidWikiLink('my-file')).toBe(true);
		expect(isValidWikiLink('my_file')).toBe(true);
		expect(isValidWikiLink('file 123')).toBe(true);
	});

	it('should handle heading references', () => {
		expect(isValidWikiLink('file#heading')).toBe(true);
		expect(isValidWikiLink('file#my heading')).toBe(true);
		expect(isValidWikiLink('file#heading|text')).toBe(false);
		expect(isValidWikiLink('file#heading%%text')).toBe(false);
		expect(isValidWikiLink('file#[[embedded]]')).toBe(false);
	});

	it('should handle block references', () => {
		expect(isValidWikiLink('file#^block-id')).toBe(true);
		expect(isValidWikiLink('file#^abc123')).toBe(true);
		expect(isValidWikiLink('file#^block_id')).toBe(false);
		expect(isValidWikiLink('file#^block-id-123')).toBe(true);
	});

	it('should handle multiple # characters', () => {
		expect(isValidWikiLink('file#heading#subheading')).toBe(true);
	});
});

// ============================================================================
// isValidMarkdownLink Tests
// ============================================================================
describe('isValidMarkdownLink', () => {
	it('should reject empty string', () => {
		expect(isValidMarkdownLink('')).toBe(false);
	});

	it('should accept URLs', () => {
		expect(isValidMarkdownLink('https://example.com')).toBe(true);
		expect(isValidMarkdownLink('http://example.com')).toBe(true);
		expect(isValidMarkdownLink('www.example.com')).toBe(true);
	});

	it('should reject double angle brackets', () => {
		expect(isValidMarkdownLink('<<file>>')).toBe(false);
		expect(isValidMarkdownLink('<<file')).toBe(false);
		expect(isValidMarkdownLink('file>>')).toBe(false);
	});

	it('should accept single angle brackets with valid content', () => {
		expect(isValidMarkdownLink('<file path>')).toBe(true);
		expect(isValidMarkdownLink('<path/to/file>')).toBe(true);
	});

	it('should reject nested angle brackets', () => {
		expect(isValidMarkdownLink('<file<nested>>')).toBe(false);
		expect(isValidMarkdownLink('<file>nested>')).toBe(false);
	});

	it('should reject unencoded spaces', () => {
		expect(isValidMarkdownLink('path with spaces')).toBe(false);
		expect(isValidMarkdownLink('my file.md')).toBe(false);
	});

	it('should accept encoded spaces', () => {
		expect(isValidMarkdownLink('path%20with%20spaces')).toBe(true);
		expect(isValidMarkdownLink('my%20file.md')).toBe(true);
	});

	it('should accept unencoded caret in block reference pattern', () => {
		expect(isValidMarkdownLink('file#^blockid')).toBe(true);
		expect(isValidMarkdownLink('file#^abc-123')).toBe(true);
	});

	it('should require encoded caret outside block reference', () => {
		expect(isValidMarkdownLink('file^name')).toBe(false);
		expect(isValidMarkdownLink('my^file.md')).toBe(false);
		expect(isValidMarkdownLink('file%5Ename')).toBe(true);
	});

	it('should accept simple file paths', () => {
		expect(isValidMarkdownLink('file.md')).toBe(true);
		expect(isValidMarkdownLink('path/to/file.md')).toBe(true);
		expect(isValidMarkdownLink('../file.md')).toBe(true);
	});
});

// ============================================================================
// wikiToMarkdown Tests
// ============================================================================
describe('wikiToMarkdown', () => {
	it('should return empty string unchanged', () => {
		expect(wikiToMarkdown('')).toBe('');
	});

	it('should return URLs unchanged', () => {
		expect(wikiToMarkdown('https://example.com')).toBe('https://example.com');
		expect(wikiToMarkdown('www.example.com')).toBe('www.example.com');
	});

	it('should return angle bracket wrapped paths unchanged', () => {
		expect(wikiToMarkdown('<file path>')).toBe('<file path>');
	});

	it('should encode spaces as %20', () => {
		expect(wikiToMarkdown('file with spaces')).toBe('file%20with%20spaces');
		expect(wikiToMarkdown('my file name.md')).toBe('my%20file%20name.md');
	});

	it('should encode caret as %5E', () => {
		expect(wikiToMarkdown('file^name')).toBe('file%5Ename');
		expect(wikiToMarkdown('my^file^name')).toBe('my%5Efile%5Ename');
	});

	it('should encode both spaces and carets', () => {
		expect(wikiToMarkdown('my file^name')).toBe('my%20file%5Ename');
	});

	it('should handle simple filenames without encoding', () => {
		expect(wikiToMarkdown('simple.md')).toBe('simple.md');
		expect(wikiToMarkdown('file-name_v1')).toBe('file-name_v1');
	});
});

// ============================================================================
// markdownToWiki Tests
// ============================================================================
describe('markdownToWiki', () => {
	it('should return empty string unchanged', () => {
		expect(markdownToWiki('')).toBe('');
	});

	it('should return URLs as null', () => {
		expect(markdownToWiki('https://example.com')).toBe(null);
		expect(markdownToWiki('www.example.com')).toBe(null);
	});

	it('should remove angle brackets', () => {
		expect(markdownToWiki('<file path>')).toBe('file path');
		expect(markdownToWiki('<path/to/file.md>')).toBe('path/to/file.md');
	});

	it('should decode %20 as spaces', () => {
		expect(markdownToWiki('file%20name')).toBe('file name');
		expect(markdownToWiki('my%20file%20name')).toBe('my file name');
	});

	it('should decode %5E as caret', () => {
		expect(markdownToWiki('file%5Ename')).toBe('file^name');
		expect(markdownToWiki('my%5Efile%5Ename')).toBe('my^file^name');
	});

	it('should handle mixed angle brackets and encoding', () => {
		expect(markdownToWiki('<file%20name>')).toBe('file name');
		expect(markdownToWiki('<my%5Efile>')).toBe('my^file');
	});

	it('should handle simple filenames without decoding', () => {
		expect(markdownToWiki('simple.md')).toBe('simple.md');
		expect(markdownToWiki('file-name')).toBe('file-name');
	});

	it('should handle filenames with heading references', () => {
		expect(markdownToWiki('file#heading')).toBe('file#heading');
		expect(markdownToWiki('file#^blockid')).toBe('file#^blockid');
	});
});

// ============================================================================
// parseWikiLink Tests
// ============================================================================
describe('parseWikiLink', () => {
	it('should return null for empty string', () => {
		expect(parseWikiLink('')).toBe(null);
	});

	it('should return null for non-wikilink text', () => {
		expect(parseWikiLink('regular text')).toBe(null);
		expect(parseWikiLink('[markdown]')).toBe(null);
		expect(parseWikiLink(']not[valid')).toBe(null);
	});

	it('should parse basic wikilink', () => {
		const result = parseWikiLink('[[file.md]]');
		expect(result).toEqual({
			text: 'file.md',
			destination: 'file.md',
			isEmbed: false
		});
	});

	it('should parse wikilink with display text', () => {
		const result = parseWikiLink('[[file.md|My Display Text]]');
		expect(result).toEqual({
			text: 'My Display Text',
			destination: 'file.md',
			isEmbed: false
		});
	});

	it('should parse embedded wikilink', () => {
		const result = parseWikiLink('![[file.md]]');
		expect(result).toEqual({
			text: 'file.md',
			destination: 'file.md',
			isEmbed: true
		});
	});

	it('should parse embedded wikilink with display text', () => {
		const result = parseWikiLink('![[file.md|Display]]');
		expect(result).toEqual({
			text: 'Display',
			destination: 'file.md',
			isEmbed: true
		});
	});

	it('should handle paths with pipes', () => {
		const result = parseWikiLink('[[path/file|display]]');
		expect(result).toEqual({
			text: 'display',
			destination: 'path/file',
			isEmbed: false
		});
	});

	it('should use last pipe as separator', () => {
		const result = parseWikiLink('[[file|part1|part2]]');
		expect(result).toEqual({
			text: 'part2',
			destination: 'file|part1',
			isEmbed: false
		});
	});

	it('should handle wikilink with heading reference', () => {
		const result = parseWikiLink('[[file#heading]]');
		expect(result).toEqual({
			text: 'file#heading',
			destination: 'file#heading',
			isEmbed: false
		});
	});

	it('should trim whitespace', () => {
		const result = parseWikiLink('[[  file.md  |  Display  ]]');
		expect(result).toEqual({
			text: 'Display',
			destination: 'file.md',
			isEmbed: false
		});
	});
});

// ============================================================================
// parseMarkdownLink Tests
// ============================================================================
describe('parseMarkdownLink', () => {
	it('should return null for empty string', () => {
		expect(parseMarkdownLink('')).toBe(null);
	});

	it('should return null for non-markdown-link text', () => {
		expect(parseMarkdownLink('regular text')).toBe(null);
		expect(parseMarkdownLink('[[wikilink]]')).toBe(null);
	});

	it('should parse basic markdown link', () => {
		const result = parseMarkdownLink('[display](destination)');
		expect(result).toEqual({
			text: 'display',
			destination: 'destination',
			isEmbed: false
		});
	});

	it('should parse embedded markdown link', () => {
		const result = parseMarkdownLink('![alt text](image.png)');
		expect(result).toEqual({
			text: 'alt text',
			destination: 'image.png',
			isEmbed: true
		});
	});

	it('should handle empty display text', () => {
		const result = parseMarkdownLink('[](destination)');
		expect(result).toEqual({
			text: '',
			destination: 'destination',
			isEmbed: false
		});
	});

	it('should handle URLs', () => {
		const result = parseMarkdownLink('[Google](https://google.com)');
		expect(result).toEqual({
			text: 'Google',
			destination: 'https://google.com',
			isEmbed: false
		});
	});

	it('should trim whitespace', () => {
		const result = parseMarkdownLink('[  display  ](  destination  )');
		expect(result).toEqual({
			text: 'display',
			destination: 'destination',
			isEmbed: false
		});
	});

	it('should handle URLs with special characters', () => {
		const result = parseMarkdownLink('[link](https://example.com/path?query=value#anchor)');
		expect(result).toEqual({
			text: 'link',
			destination: 'https://example.com/path?query=value#anchor',
			isEmbed: false
		});
	});
});

// ============================================================================
// parseClipboardLink Tests
// ============================================================================
describe('parseClipboardLink', () => {
	it('should return null for empty string', () => {
		expect(parseClipboardLink('')).toBe(null);
	});

	it('should parse wiki link from clipboard', () => {
		const result = parseClipboardLink('[[file]]');
		expect(result).toEqual({
			text: 'file',
			destination: 'file',
			isWiki: true,
			isEmbed: false
		});
	});

	it('should parse markdown link from clipboard', () => {
		const result = parseClipboardLink('[text](dest)');
		expect(result).toEqual({
			text: 'text',
			destination: 'dest',
			isWiki: false,
			isEmbed: false
		});
	});

	it('should trim clipboard text', () => {
		const result = parseClipboardLink('  [[file]]  \n');
		expect(result).toEqual({
			text: 'file',
			destination: 'file',
			isWiki: true,
			isEmbed: false
		});
	});

	it('should return null for non-link text', () => {
		expect(parseClipboardLink('just regular text')).toBe(null);
	});
});

// ============================================================================
// isUrl Tests
// ============================================================================
describe('isUrl', () => {
	it('should return false for empty string', () => {
		expect(isUrl('')).toBe(false);
	});

	it('should detect https URLs', () => {
		expect(isUrl('https://example.com')).toBe(true);
		expect(isUrl('https://www.example.com')).toBe(true);
	});

	it('should detect http URLs', () => {
		expect(isUrl('http://example.com')).toBe(true);
	});

	it('should detect www URLs', () => {
		expect(isUrl('www.example.com')).toBe(true);
		expect(isUrl('www.example.co.uk')).toBe(true);
	});

	it('should reject non-URLs', () => {
		expect(isUrl('example.com')).toBe(false);
		expect(isUrl('not a url')).toBe(false);
		expect(isUrl('ftp://example.com')).toBe(false);
	});

	it('should trim whitespace', () => {
		expect(isUrl('  https://example.com  ')).toBe(true);
		expect(isUrl('\thttps://example.com\n')).toBe(true);
	});
});

// ============================================================================
// normalizeUrl Tests
// ============================================================================
describe('normalizeUrl', () => {
	it('should return empty string unchanged', () => {
		expect(normalizeUrl('')).toBe('');
	});

	it('should return https URLs unchanged', () => {
		expect(normalizeUrl('https://example.com')).toBe('https://example.com');
	});

	it('should return http URLs unchanged', () => {
		expect(normalizeUrl('http://example.com')).toBe('http://example.com');
	});

	it('should add https to www URLs', () => {
		expect(normalizeUrl('www.example.com')).toBe('https://www.example.com');
	});

	it('should trim whitespace and return as-is for non-URLs', () => {
		expect(normalizeUrl('  example.com  ')).toBe('example.com');
	});

	it('should be case insensitive for protocols', () => {
		expect(normalizeUrl('HTTPS://example.com')).toBe('HTTPS://example.com');
		expect(normalizeUrl('WWW.example.com')).toBe('https://WWW.example.com');
	});
});

// ============================================================================
// isAlmostUrl Tests
// ============================================================================
describe('isAlmostUrl', () => {
	it('should return false for empty string', () => {
		expect(isAlmostUrl('')).toBe(false);
	});

	it('should detect common URL typos', () => {
		expect(isAlmostUrl('htp://example.com')).toBe(true);
		expect(isAlmostUrl('htps://example.com')).toBe(true);
		expect(isAlmostUrl('http://example.com')).toBe(true);
		expect(isAlmostUrl('https://example.com')).toBe(true);
	});

	it('should detect www without full URL', () => {
		expect(isAlmostUrl('www:example.com')).toBe(true);
		expect(isAlmostUrl('www.example.com')).toBe(true);
	});

	it('should reject non-URL-like strings', () => {
		expect(isAlmostUrl('example.com')).toBe(false);
		expect(isAlmostUrl('random text')).toBe(false);
	});

	it('should be case insensitive', () => {
		expect(isAlmostUrl('HTTPS://example.com')).toBe(true);
		expect(isAlmostUrl('WWW.example.com')).toBe(true);
	});
});

// ============================================================================
// urlAtCursor Tests
// ============================================================================
describe('urlAtCursor', () => {
	it('should return null if no URL at cursor', () => {
		expect(urlAtCursor('Some text without url', 5)).toBe(null);
	});

	it('should find https URL at cursor position', () => {
		const text = 'Visit https://example.com for more';
		expect(urlAtCursor(text, 10)).toBe('https://example.com');
		expect(urlAtCursor(text, 20)).toBe('https://example.com');
	});

	it('should find www URL at cursor position', () => {
		const text = 'Check www.example.com now';
		expect(urlAtCursor(text, 10)).toBe('www.example.com');
	});

	it('should return null if cursor is outside URL bounds', () => {
		const text = 'Visit https://example.com later';
		expect(urlAtCursor(text, 0)).toBe(null);
		expect(urlAtCursor(text, 30)).toBe(null);
	});

	it('should handle multiple URLs in text', () => {
		const text = 'Visit https://a.com or www.b.com';
		expect(urlAtCursor(text, 10)).toBe('https://a.com');
		expect(urlAtCursor(text, 25)).toBe('www.b.com');
	});

	it('should handle URL boundaries correctly', () => {
		const text = 'https://example.com/path';
		expect(urlAtCursor(text, 0)).toBe('https://example.com/path');
		expect(urlAtCursor(text, 10)).toBe('https://example.com/path');
		expect(urlAtCursor(text, text.length)).toBe('https://example.com/path');
	});
});

// ============================================================================
// detectMarkdownLinkAtCursor Tests
// ============================================================================
describe('detectMarkdownLinkAtCursor', () => {
	it('should return null if no link at cursor', () => {
		expect(detectMarkdownLinkAtCursor('No links here', 5)).toBe(null);
	});

	it('should detect markdown link at cursor', () => {
		const line = 'Click [here](https://example.com) to continue';
		const result = detectMarkdownLinkAtCursor(line, 15);
		expect(result?.link.text).toBe('here');
		expect(result?.link.destination).toBe('https://example.com');
		expect(result?.link.isWiki).toBe(false);
		expect(result?.link.isEmbed).toBe(false);
	});

	it('should detect embedded markdown link', () => {
		const line = 'Image: ![alt](image.png) here';
		const result = detectMarkdownLinkAtCursor(line, 10);
		expect(result?.link.text).toBe('alt');
		expect(result?.link.destination).toBe('image.png');
		expect(result?.link.isEmbed).toBe(true);
	});

	it('should detect link at start position', () => {
		const line = '[link](dest) and more';
		const result = detectMarkdownLinkAtCursor(line, 0);
		expect(result?.link.text).toBe('link');
		expect(result?.link.destination).toBe('dest');
	});

	it('should return null if cursor is outside link', () => {
		const line = 'Text [link](dest) text';
		expect(detectMarkdownLinkAtCursor(line, 0)).toBe(null);
		expect(detectMarkdownLinkAtCursor(line, 20)).toBe(null);
	});

	it('should set enteredFromLeft for cursor near start', () => {
		const line = '[link](dest)';
		const result = detectMarkdownLinkAtCursor(line, 1);
		expect(result?.enteredFromLeft).toBe(true);
	});

	it('should calculate correct start and end positions', () => {
		const line = 'prefix [link](dest) suffix';
		const result = detectMarkdownLinkAtCursor(line, 12);
		expect(result?.start).toBe(7);
		expect(result?.end).toBe(19); // '[link](dest)' is 12 chars, 7 + 12 = 19
	});

	it('should handle embedded link position correctly', () => {
		const line = 'prefix ![alt](img.png) suffix';
		const result = detectMarkdownLinkAtCursor(line, 8);
		expect(result?.start).toBe(7);
		expect(result?.link.isEmbed).toBe(true);
	});

	// Tests for fix: embed detection when cursor is on the ! prefix
	it('should detect embedded markdown link when cursor is on the ! prefix', () => {
		const line = '![alt](image.png)';
		const result = detectMarkdownLinkAtCursor(line, 0);
		expect(result).not.toBeNull();
		expect(result?.link.isEmbed).toBe(true);
		expect(result?.link.text).toBe('alt');
		expect(result?.link.destination).toBe('image.png');
		expect(result?.start).toBe(0);
	});

	it('should detect embedded markdown link when cursor is at start of ! prefix with surrounding text', () => {
		const line = 'See ![img](pic.png) here';
		const result = detectMarkdownLinkAtCursor(line, 4); // Position of !
		expect(result).not.toBeNull();
		expect(result?.link.isEmbed).toBe(true);
		expect(result?.start).toBe(4);
	});

	it('should include ! in the detected range for embedded markdown links', () => {
		const line = 'text ![alt](dest) more';
		const result = detectMarkdownLinkAtCursor(line, 5); // On the !
		expect(result?.start).toBe(5); // Should start at !, not at [
		// ![alt](dest) is 12 chars: ! + [ + alt + ] + ( + dest + ) = 1+1+3+1+1+4+1 = 12
		expect(result?.end).toBe(17); // 5 + 12 = 17
		expect(result?.link.isEmbed).toBe(true);
	});
});

// ============================================================================
// detectWikiLinkAtCursor Tests
// ============================================================================
describe('detectWikiLinkAtCursor', () => {
	it('should return null if no link at cursor', () => {
		expect(detectWikiLinkAtCursor('No links here', 5)).toBe(null);
	});

	it('should detect basic wiki link at cursor', () => {
		const line = 'See [[Notes]] for details';
		const result = detectWikiLinkAtCursor(line, 8);
		expect(result?.link.text).toBe('Notes');
		expect(result?.link.destination).toBe('Notes');
		expect(result?.link.isWiki).toBe(true);
		expect(result?.link.isEmbed).toBe(false);
	});

	it('should detect wiki link with display text', () => {
		const line = 'Go to [[file|display text]] now';
		const result = detectWikiLinkAtCursor(line, 15);
		expect(result?.link.destination).toBe('file');
		expect(result?.link.text).toBe('display text');
	});

	it('should detect embedded wiki link', () => {
		const line = 'Image ![[photo.png]] here';
		const result = detectWikiLinkAtCursor(line, 10);
		expect(result?.link.isEmbed).toBe(true);
		expect(result?.link.destination).toBe('photo.png');
	});

	it('should detect wiki link with heading reference', () => {
		const line = 'Link [[file#heading]] text';
		const result = detectWikiLinkAtCursor(line, 10);
		expect(result?.link.destination).toBe('file#heading');
	});

	it('should handle multiple wiki links', () => {
		const line = '[[first]] and [[second]]';
		const result1 = detectWikiLinkAtCursor(line, 3);
		const result2 = detectWikiLinkAtCursor(line, 18);
		expect(result1?.link.destination).toBe('first');
		expect(result2?.link.destination).toBe('second');
	});

	it('should calculate correct start and end positions', () => {
		const line = 'prefix [[link]] suffix';
		const result = detectWikiLinkAtCursor(line, 10);
		expect(result?.start).toBe(7);
		expect(result?.end).toBe(15); // '[[link]]' is 8 chars, 7 + 8 = 15
	});

	it('should set enteredFromLeft for cursor near start', () => {
		const line = '[[link]]';
		const result = detectWikiLinkAtCursor(line, 2);
		expect(result?.enteredFromLeft).toBe(true);
	});

	it('should return null if cursor is outside link', () => {
		const line = 'Text [[link]] text';
		expect(detectWikiLinkAtCursor(line, 0)).toBe(null);
		expect(detectWikiLinkAtCursor(line, 15)).toBe(null);
	});

	// Tests for fix: embed detection when cursor is on the ! prefix
	it('should detect embedded wiki link when cursor is on the ! prefix', () => {
		const line = '![[image.png]]';
		const result = detectWikiLinkAtCursor(line, 0);
		expect(result).not.toBeNull();
		expect(result?.link.isEmbed).toBe(true);
		expect(result?.link.destination).toBe('image.png');
		expect(result?.start).toBe(0);
	});

	it('should detect embedded wiki link when cursor is at start of ! prefix with surrounding text', () => {
		const line = 'See ![[photo.jpg]] here';
		const result = detectWikiLinkAtCursor(line, 4); // Position of !
		expect(result).not.toBeNull();
		expect(result?.link.isEmbed).toBe(true);
		expect(result?.start).toBe(4);
	});

	it('should include ! in the detected range for embedded wiki links', () => {
		const line = 'text ![[file]] more';
		const result = detectWikiLinkAtCursor(line, 5); // On the !
		expect(result?.start).toBe(5); // Should start at !, not at [[
		expect(result?.end).toBe(14); // Should end after ]]
		expect(result?.link.isEmbed).toBe(true);
	});

	it('should correctly identify non-embedded wiki link at start of line', () => {
		const line = '[[regular-link]]';
		const result = detectWikiLinkAtCursor(line, 0);
		expect(result).not.toBeNull();
		expect(result?.link.isEmbed).toBe(false);
		expect(result?.start).toBe(0);
	});

	it('should detect embedded wiki link with display text when cursor on !', () => {
		const line = '![[file.md|Display Text]]';
		const result = detectWikiLinkAtCursor(line, 0);
		expect(result).not.toBeNull();
		expect(result?.link.isEmbed).toBe(true);
		expect(result?.link.destination).toBe('file.md');
		expect(result?.link.text).toBe('Display Text');
	});
});

// ============================================================================
// detectLinkAtCursor Tests
// ============================================================================
describe('detectLinkAtCursor', () => {
	it('should detect markdown link', () => {
		const line = 'Visit [example](https://example.com)';
		const result = detectLinkAtCursor(line, 15);
		expect(result?.link.isWiki).toBe(false);
	});

	it('should detect wiki link if markdown not found', () => {
		const line = 'See [[Notes]]';
		const result = detectLinkAtCursor(line, 6);
		expect(result?.link.isWiki).toBe(true);
	});

	it('should return null if no link found', () => {
		expect(detectLinkAtCursor('No links', 2)).toBe(null);
	});

	it('should prefer markdown over wiki link', () => {
		const line = '[text](dest)';
		const result = detectLinkAtCursor(line, 3);
		expect(result?.link.isWiki).toBe(false);
	});
});

// ============================================================================
// determineLinkFromContext Tests
// ============================================================================
describe('determineLinkFromContext', () => {
	it('should use URL from selection', () => {
		const context = {
			selection: 'https://example.com',
			clipboardText: '',
			cursorUrl: null,
			line: '',
			cursorCh: 0
		};
		const result = determineLinkFromContext(context);
		expect(result.destination).toBe('https://example.com');
		expect(result.isWiki).toBe(false);
	});

	it('should normalize www URLs', () => {
		const context = {
			selection: 'www.example.com',
			clipboardText: '',
			cursorUrl: null,
			line: '',
			cursorCh: 0
		};
		const result = determineLinkFromContext(context);
		expect(result.destination).toBe('https://www.example.com');
		expect(result.conversionNotice).toContain('converted');
	});

	it('should use clipboard URL if provided', () => {
		const context = {
			selection: '',
			clipboardText: 'https://example.com',
			cursorUrl: null,
			line: '',
			cursorCh: 0
		};
		const result = determineLinkFromContext(context);
		expect(result.destination).toBe('https://example.com');
		expect(result.text).toBe('https://example.com');
	});

	it('should use cursor URL if available', () => {
		const context = {
			selection: '',
			clipboardText: 'Link text',
			cursorUrl: 'https://example.com',
			line: 'Visit https://example.com now',
			cursorCh: 15
		};
		const result = determineLinkFromContext(context);
		expect(result.destination).toBe('https://example.com');
		expect(result.text).toBe('Link text');
	});

	it('should use selection as link text with clipboard destination', () => {
		const context = {
			selection: 'My Link',
			clipboardText: 'https://example.com',
			cursorUrl: null,
			line: '',
			cursorCh: 0
		};
		const result = determineLinkFromContext(context);
		expect(result.text).toBe('My Link');
		expect(result.destination).toBe('https://example.com');
	});

	it('should parse wiki link from clipboard', () => {
		const context = {
			selection: 'Link text',
			clipboardText: '[[file.md]]',
			cursorUrl: null,
			line: '',
			cursorCh: 0
		};
		const result = determineLinkFromContext(context);
		expect(result.destination).toBe('file.md');
		expect(result.isWiki).toBe(true);
	});

	it('should use clipboard text as destination when no link parsed', () => {
		const context = {
			selection: 'My Link',
			clipboardText: 'simple_destination',
			cursorUrl: null,
			line: '',
			cursorCh: 0
		};
		const result = determineLinkFromContext(context);
		expect(result.text).toBe('My Link');
		expect(result.destination).toBe('simple_destination');
	});

	it('should create wiki link by default', () => {
		const context = {
			selection: '',
			clipboardText: 'Notes',
			cursorUrl: null,
			line: '',
			cursorCh: 0
		};
		const result = determineLinkFromContext(context);
		expect(result.isWiki).toBe(true);
		expect(result.text).toBe('Notes');
	});

	it('should set shouldSelectText flag for URLs', () => {
		const context = {
			selection: 'https://example.com',
			clipboardText: '',
			cursorUrl: null,
			line: '',
			cursorCh: 0
		};
		const result = determineLinkFromContext(context);
		expect(result.shouldSelectText).toBe(true);
	});
});

// ============================================================================
// validateLinkDestination Tests
// ============================================================================
describe('validateLinkDestination', () => {
	it('should reject URL in wikilink', () => {
		const result = validateLinkDestination('https://example.com', 'Link', true);
		expect(result.isValid).toBe(false);
		expect(result.warnings.some(w => w.severity === 'error')).toBe(true);
		expect(result.shouldHighlightDest).toBe(true);
	});

	it('should accept URL in markdown link', () => {
		const result = validateLinkDestination('https://example.com', 'Link', false);
		expect(result.isValid).toBe(true);
	});

	it('should warn about invalid wiki characters', () => {
		const result = validateLinkDestination('file|name', 'Link', true);
		expect(result.isValid).toBe(false);
		expect(result.shouldHighlightDest).toBe(true);
	});

	it('should suggest format conversion for invalid wikilink dest', () => {
		// 'file^name' is invalid for wikilinks (caret forbidden in filename),
		// but wikiToMarkdown converts it to 'file%5Ename' which is different,
		// so a conversion suggestion should appear.
		const result = validateLinkDestination('file^name', 'Link', true);
		expect(result.shouldHighlightDest).toBe(true);
		expect(result.warnings.some(w => w.severity === 'caution')).toBe(true);
	});

	it('should accept spaces in wikilink destinations', () => {
		// Spaces are valid in wikilinks
		const result = validateLinkDestination('file with spaces', 'Link', true);
		expect(result.isValid).toBe(true);
		expect(result.shouldHighlightDest).toBe(false);
	});

	it('should warn about long destinations', () => {
		const longDest = 'a'.repeat(501);
		const result = validateLinkDestination(longDest, 'Link', false);
		expect(result.warnings.some(w => w.text.includes('very long'))).toBe(true);
		expect(result.shouldHighlightDest).toBe(true);
	});

	it('should warn about almost-URLs', () => {
		const result = validateLinkDestination('htp://example.com', 'Link', false);
		expect(result.warnings.some(w => w.text.includes('typos'))).toBe(true);
	});

	it('should accept valid wikilink destination', () => {
		const result = validateLinkDestination('Notes#heading', 'Link', true);
		expect(result.isValid).toBe(true);
	});

	it('should accept valid markdown destination', () => {
		const result = validateLinkDestination('path/to/file.md', 'Link', false);
		expect(result.isValid).toBe(true);
	});

	it('should not have errors when empty destination', () => {
		const result = validateLinkDestination('', 'Link', true);
		expect(result.isValid).toBe(true);
		expect(result.warnings.length).toBe(0);
	});

	it('should correctly set highlight flags', () => {
		const result = validateLinkDestination('file|name', 'Text', true);
		expect(result.shouldHighlightDest).toBe(true);
		expect(result.shouldHighlightText).toBe(false);
	});
});
