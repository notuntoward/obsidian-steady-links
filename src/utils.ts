import { TFile, Pos } from "obsidian";

/**
 * Check if a destination string is valid for a WikiLink format
 * 
 * WikiLink validation rules:
 * 1. Cannot be a URL (starts with http:// or https://)
 * 2. Cannot contain angle brackets or parentheses
 * 3. Filename portion (before #) cannot contain:
 *    - Obsidian forbidden characters: | ^ : %% [[ ]]
 *    - OS forbidden characters: * " ? \ /
 * 4. Heading/block reference (after #) validation:
 *    - Block references (starting with ^) can only contain alphanumeric and hyphens
 *    - Heading references cannot contain [[ ]] | %%
 */
export function isValidWikiLink(dest: string): boolean {
	if (!dest) return false;

	// WikiLinks don't support URLs
	if (/^https?:\/\//.test(dest)) return false;

	// WikiLinks don't support angle brackets or parens
	if (dest.includes("<") || dest.includes(">") || dest.includes("(") || dest.includes(")")) 
		return false;

	// Check for invalid characters in the filename portion
	// Split by # to separate filename from heading/block reference
	const parts = dest.split("#");
	const filename = parts[0];

	// Filename portion cannot contain: | ^ : %% [[ ]]
	// These are Obsidian's forbidden filename characters
	if (filename.includes("|")) return false;
	if (filename.includes("^")) return false;
	if (filename.includes(":")) return false;
	if (filename.includes("%%")) return false;
	if (filename.includes("[[") || filename.includes("]]")) return false;

	// Also check OS-level forbidden characters
	if (filename.includes("*") || filename.includes('"') || filename.includes("?")) return false;
	if (filename.includes("\\") || filename.includes("/")) return false;

	// If there's a heading/block reference part (after #), validate it
	if (parts.length > 1) {
		const reference = parts.slice(1).join("#"); // Rejoin in case # appears in heading

		// Block reference (starts with ^)
		if (reference.startsWith("^")) {
			const blockId = reference.slice(1);
			// Block IDs should only contain alphanumeric and hyphens
			if (!/^[a-zA-Z0-9-]+$/.test(blockId)) return false;
		} 
		// Heading reference - headings can contain most characters except [[ ]] | %%
		else {
			if (reference.includes("[[") || reference.includes("]]")) return false;
			if (reference.includes("|")) return false;
			if (reference.includes("%%")) return false;
		}
	}

	return true;
}

/**
 * Check if a destination string is valid for a Markdown link format
 * 
 * Markdown link validation rules:
 * 1. URLs are always valid, including:
 *    - Full URLs (http:// or https://)
 *    - Bare URLs (www.example.com)
 * 2. Double angle brackets (<< >>) are invalid
 * 3. Single angle brackets (< >) are valid for paths with spaces, but:
 *    - Cannot contain nested angle brackets inside
 * 4. Unwrapped paths:
 *    - Cannot contain unencoded spaces (must use %20)
 *    - Caret (^) must be encoded as %5E, except when used in block reference pattern (#^)
 *      at the end of the string
 */
export function isValidMarkdownLink(dest: string): boolean {
	if (!dest) return false;

	// Valid if it's a URL (including bare URLs like www.example.com)
	if (/^https?:\/\/\S+$|^www\.\S+$/i.test(dest)) return true;

	// Check for double angle brackets (invalid)
	if (dest.startsWith("<<") || dest.endsWith(">>")) return false;

	// Check if wrapped in single angle brackets (valid for paths with spaces)
	if (dest.startsWith("<") && dest.endsWith(">")) {
		// Must not have double brackets
		const inner = dest.slice(1, -1);
		if (inner.includes("<") || inner.includes(">")) return false;
		return true;
	}

	// Not wrapped - check for problematic unencoded characters
	// Spaces must be encoded
	if (dest.includes(" ")) return false;

	// Check for unencoded ^ (must be %5E)
	// But allow it in the pattern filename#^ where it's part of block reference syntax
	if (dest.includes("^")) {
		// Must be properly encoded as %5E or be part of #^ pattern at the very end
		if (!dest.includes("%5E") && !dest.match(/#\^[a-zA-Z0-9-]*$/)) return false;
	}

	return true;
}

/**
 * Convert a WikiLink destination to Markdown link format
 */
export function wikiToMarkdown(dest: string): string {
	if (!dest) return dest;

	// If it's already a URL (including bare URLs), return as-is
	if (/^https?:\/\/\S+$|^www\.\S+$/i.test(dest)) return dest;

	// If it already has angle brackets, return as-is (already converted)
	if (dest.startsWith("<") && dest.endsWith(">")) return dest;

	// Encode special characters for markdown
	const encoded = dest.replace(/ /g, "%20").replace(/\^/g, "%5E");
	return encoded;
}

/**
 * Convert a Markdown link destination to WikiLink format
 */
export function markdownToWiki(dest: string): string | null {
	if (!dest) return dest;

	// Remove angle brackets if present
	let cleaned = dest;
	if (dest.startsWith("<") && dest.endsWith(">")) {
		cleaned = dest.slice(1, -1);
	}

	// Decode URL encoding
	try {
		cleaned = decodeURIComponent(cleaned);
	} catch (e) {
		// If decode fails, manually decode common cases
		cleaned = cleaned.replace(/%20/g, " ").replace(/%5E/gi, "^");
	}

	// If it's a URL (including bare URLs), cannot convert to wikilink
	if (/^https?:\/\/\S+$|^www\.\S+$/i.test(cleaned)) return null;

	return cleaned;
}

/**
 * Parse a wiki link from text and extract text and destination
 * WikiLink format: [[filename|display text]] or [[filename]]
 */
export function parseWikiLink(text: string): { text: string; destination: string; isEmbed: boolean } | null {
	if (!text) return null;

	// Check if it starts with ! for embed
	const isEmbed = text.startsWith('![[');
	const linkStart = isEmbed ? 3 : 2;

	// Must start with [[ or ![[
	if (!text.startsWith('[[') && !text.startsWith('![[')) return null;

	// Must end with ]]
	if (!text.endsWith(']]')) return null;

	// Extract content between brackets
	const innerContent = text.slice(linkStart, -2); // Remove ![[/[[ and ]]

	// Find the last pipe to separate destination from display text
	const lastPipeIndex = innerContent.lastIndexOf('|');

	let destination, linkText;
	if (lastPipeIndex === -1) {
		// No display text, just destination
		destination = innerContent.trim();
		linkText = destination;
	} else {
		// Split at the last pipe to get destination and display text
		destination = innerContent.substring(0, lastPipeIndex).trim();
		linkText = innerContent.substring(lastPipeIndex + 1).trim();
	}

	return { text: linkText, destination, isEmbed };
}

/**
 * Parse a markdown link from text and extract text and destination
 * Markdown link format: [display text](destination)
 */
export function parseMarkdownLink(text: string): { text: string; destination: string; isEmbed: boolean } | null {
	if (!text) return null;

	// Check if it starts with ! for embed
	const isEmbed = text.startsWith('![');

	// Match markdown link pattern: [display text](destination) (or with ! prefix)
	const pattern = isEmbed ? /^!\[([^\]]*)\]\(([^)]+)\)$/ : /^\[([^\]]*)\]\(([^)]+)\)$/;

	// Match markdown link pattern: [display text](destination)
	const markdownLinkMatch = text.match(pattern);

	if (!markdownLinkMatch) return null;

	const linkText = markdownLinkMatch[1].trim();
	const destination = markdownLinkMatch[2].trim();

	return { text: linkText, destination, isEmbed };
}

/**
 * Parse clipboard content to extract link information
 * Returns null if clipboard doesn't contain a valid link
 */
export function parseClipboardLink(clipboardText: string): { text: string; destination: string; isWiki: boolean; isEmbed: boolean } | null {
	if (!clipboardText) return null;

	const trimmed = clipboardText.trim();

	// Try to parse as wiki link first
	const wikiLink = parseWikiLink(trimmed);
	if (wikiLink) {
		return { ...wikiLink, isWiki: true };
	}

	// Try to parse as markdown link
	const markdownLink = parseMarkdownLink(trimmed);
	if (markdownLink) {
		return { ...markdownLink, isWiki: false };
	}

	return null;
}

// ============================================================================
// NEW: Refactored functions for improved testability
// ============================================================================

/**
 * Check if a string is a URL
 */
export function isUrl(str: string): boolean {
	if (!str) return false;
	const trimmed = str.trim();
	return /^https?:\/\/\S+$|^www\.\S+$/i.test(trimmed);
}

/**
 * Normalize a URL (add https:// prefix if needed)
 */
export function normalizeUrl(str: string): string {
	if (!str) return str;
	const trimmed = str.trim();
	if (/^https?:\/\//i.test(trimmed)) return trimmed;
	if (/^www\./i.test(trimmed)) return "https://" + trimmed;
	return trimmed;
}

/**
 * Check if a string looks like a URL but may have typos
 */
export function isAlmostUrl(str: string): boolean {
	if (!str) return false;
	const trimmed = str.trim();
        // Check for common typos: htp, htps, http, https, www
        return /^(htp|htps|http|https|www)[:.a-zA-Z0-9-]/i.test(trimmed);
}

/**
 * Find URL at a specific cursor position in text
 */
export function urlAtCursor(text: string, pos: number): string | null {
	const urlRegex = /https?:\/\/[^\s]+|www\.[^\s]+/gi;
	let match;
	while ((match = urlRegex.exec(text)) !== null) {
		if (pos >= match.index && pos <= match.index + match[0].length) {
			return match[0];
		}
	}
	return null;
}

/**
 * Result of link detection at cursor
 */
export interface LinkAtCursor {
	link: {
		text: string;
		destination: string;
		isWiki: boolean;
		isEmbed: boolean;
	};
	start: number;
	end: number;
	enteredFromLeft: boolean;
}

/**
 * Detect if there's a Markdown link at the cursor position
 */
export function detectMarkdownLinkAtCursor(line: string, cursorCh: number): LinkAtCursor | null {
	const mdRegex = /(!?)\[([^\]]+)\]\(([^)]+)\)/g;
	let match: RegExpExecArray | null;

	while ((match = mdRegex.exec(line)) !== null) {
		const hasEmbedPrefix = match[1] === '!';
		const start = match.index;
		const end = match.index + match[0].length;

		// The actual link content starts after the ! if present
		const linkContentStart = hasEmbedPrefix ? start + 1 : start;
		const isEmbed = hasEmbedPrefix;
		const actualStart = start; // Include the ! in the range

		// Check if cursor is within the link (including the ! prefix)
		// We check a wider range to handle cases where cursor is on the embed prefix
		if (cursorCh >= start && cursorCh <= end) {

			return {
				link: {
					text: match[2], // Updated index due to new capture group
					destination: match[3], // Updated index due to new capture group
					isWiki: false,
					isEmbed: isEmbed
				},
				start: start,
				end: end,
				enteredFromLeft: cursorCh <= (start + end) / 2
			};
		}
	}

	return null;
}

/**
 * Detect if there's a WikiLink at the cursor position
 */
export function detectWikiLinkAtCursor(line: string, cursorCh: number): LinkAtCursor | null {
	const wikiLinkMatches = [];
	let startIndex = 0;

	// Find all wikilinks in the line (including optional ! prefix)
	while (true) {
		const openIndex = line.indexOf('[[', startIndex);
		if (openIndex === -1) break;

		const closeIndex = line.indexOf(']]', openIndex);
		if (closeIndex === -1) break;

		// Check if this is an embedded link (starts with !)
		const isEmbed = openIndex > 0 && line.charAt(openIndex - 1) === '!';
		
		// Include the ! in the match range if present
		const matchStart = isEmbed ? openIndex - 1 : openIndex;
		const fullMatch = line.substring(matchStart, closeIndex + 2);
		const innerContent = line.substring(openIndex + 2, closeIndex);
		const lastPipeIndex = innerContent.lastIndexOf('|');

		let destination, text;
		if (lastPipeIndex === -1) {
			destination = innerContent.trim();
			text = destination;
		} else {
			destination = innerContent.substring(0, lastPipeIndex).trim();
			text = innerContent.substring(lastPipeIndex + 1).trim();
		}

		wikiLinkMatches.push({
			index: matchStart, // Start includes ! if present
			match: fullMatch,
			groups: [destination, text],
			isEmbed: isEmbed
		});

		startIndex = closeIndex + 2;
	}

	// Check if cursor is within any of the found wikilinks
	for (const wikiMatch of wikiLinkMatches) {
		const start = wikiMatch.index;
		const end = wikiMatch.index + wikiMatch.match.length;

		// Check if cursor is within the link (including the ! prefix)
		if (cursorCh >= start && cursorCh <= end) {

			return {
				link: {
					destination: wikiMatch.groups[0],
					text: wikiMatch.groups[1],
					isWiki: true,
					isEmbed: wikiMatch.isEmbed,
				},
				start: start,
				end: end,
				enteredFromLeft: cursorCh <= (start + end) / 2
			};
		}
	}

	return null;
}

/**
 * Detect any link (Markdown or WikiLink) at cursor position
 */
export function detectLinkAtCursor(line: string, cursorCh: number): LinkAtCursor | null {
	// Try Markdown first
	const mdLink = detectMarkdownLinkAtCursor(line, cursorCh);
	if (mdLink) return mdLink;

	// Try WikiLink
	return detectWikiLinkAtCursor(line, cursorCh);
}

/**
 * Result of computing displayed text range for a link.
 * The displayed text is what the user sees in live preview (without syntax).
 */
export interface DisplayedTextRange {
	/** Start of the full link (including syntax) */
	linkStart: number;
	/** End of the full link (including syntax) */
	linkEnd: number;
	/** Start of the displayed text (after leading syntax) */
	displayedTextStart: number;
	/** End of the displayed text (before trailing syntax) */
	displayedTextEnd: number;
}

/**
 * Compute the displayed text range for a link at the given position.
 * This is used by the "Skip Link" command to determine where to position the cursor.
 *
 * For Markdown links like `[text](dest)`:
 *   - Full link: `[text](dest)`
 *   - Displayed text: `text`
 *
 * For WikiLinks like `[[dest|text]]` or `[[dest]]`:
 *   - Full link: `[[dest|text]]` or `[[dest]]`
 *   - Displayed text: `text` or `dest`
 *
 * @param line The line text
 * @param cursorCh The cursor position
 * @returns The displayed text range, or null if no link at cursor
 */
export function computeDisplayedTextRange(line: string, cursorCh: number): DisplayedTextRange | null {
	// Try Markdown link first
	const mdLink = detectMarkdownLinkAtCursor(line, cursorCh);
	if (mdLink) {
		// Markdown: [text](dest)
		// Full link: mdLink.start to mdLink.end
		// Displayed text starts after '[' and ends before ']('
		const hasEmbedPrefix = mdLink.link.isEmbed;
		const prefixLen = hasEmbedPrefix ? 2 : 1; // '![' or '['
		const displayedTextStart = mdLink.start + prefixLen;
		const displayedTextEnd = displayedTextStart + mdLink.link.text.length;
		
		return {
			linkStart: mdLink.start,
			linkEnd: mdLink.end,
			displayedTextStart,
			displayedTextEnd
		};
	}

	// Try WikiLink
	const wikiLink = detectWikiLinkAtCursor(line, cursorCh);
	if (wikiLink) {
		// WikiLink: [[dest|text]] or [[dest]]
		// Full link: wikiLink.start to wikiLink.end
		// Displayed text is after the pipe, or the whole destination if no pipe
		const hasEmbedPrefix = wikiLink.link.isEmbed;
		const prefixLen = hasEmbedPrefix ? 3 : 2; // '![' or '[['
		
		// Find the opening [[ position
		const openIndex = hasEmbedPrefix 
			? wikiLink.start + 1  // Skip the '!'
			: wikiLink.start;
		
		// The inner content is between [[ and ]]
		const innerStart = openIndex + 2;
		const innerContent = line.substring(innerStart, wikiLink.end - 2);
		
		const lastPipeIndex = innerContent.lastIndexOf('|');
		let displayedTextStart: number;
		let displayedTextEnd: number;
		
		if (lastPipeIndex === -1) {
			// No pipe: [[dest]] - displayed text is the destination
			displayedTextStart = innerStart;
			displayedTextEnd = wikiLink.end - 2;
		} else {
			// Has pipe: [[dest|text]] - displayed text is after the pipe
			displayedTextStart = innerStart + lastPipeIndex + 1;
			displayedTextEnd = wikiLink.end - 2;
		}
		
		return {
			linkStart: wikiLink.start,
			linkEnd: wikiLink.end,
			displayedTextStart,
			displayedTextEnd
		};
	}

	return null;
}

/**
 * Context for determining link from user input
 */
export interface LinkContext {
	selection: string;
	clipboardText: string;
	cursorUrl: string | null;
	line: string;
	cursorCh: number;
}

/**
 * Result of determining link from context
 */
export interface LinkFromContext {
	text: string;
	destination: string;
	isWiki: boolean;
	shouldSelectText: boolean;
	conversionNotice: string | null;
	start: number;
	end: number;
}

/**
 * Determine link information from various context sources
 * (selection, clipboard, URL at cursor)
 */
export function determineLinkFromContext(context: LinkContext): LinkFromContext {
	const { selection, clipboardText, cursorUrl, line, cursorCh } = context;

	const isSelectionUrl = isUrl(selection);
	const isClipboardUrl = isUrl(clipboardText);

	let linkText = "";
	let linkDest = "";
	let shouldBeMarkdown = false;
	let shouldSelectText = false;
	let conversionNotice: string | null = null;
	let start = cursorCh;
	let end = cursorCh;

	// If cursor is on a URL but not within a link, use that URL
	if (cursorUrl && !isSelectionUrl) {
		const original = cursorUrl.trim();
		const normalized = normalizeUrl(original);

		// If clipboard has non-link text, use it as the link text
		const parsedLink = parseClipboardLink(clipboardText);
		if (clipboardText && !parsedLink && !isUrl(clipboardText)) {
			linkText = clipboardText;
		} else {
			linkText = original;
		}

		linkDest = normalized;
		shouldBeMarkdown = true;
		shouldSelectText = true;

		if (original !== normalized) {
			conversionNotice = `URL converted: ${original} → ${normalized}`;
		}

		// Find the URL boundaries to set start/end
		const urlStart = line.indexOf(cursorUrl);
		const urlEnd = urlStart + cursorUrl.length;
		start = urlStart;
		end = urlEnd;
	} 
	// Selection is a URL
	else if (isSelectionUrl) {
		const original = selection.trim();
		const normalized = normalizeUrl(original);
		linkText = original;
		linkDest = normalized;
		shouldBeMarkdown = true;
		shouldSelectText = true;

		if (original !== normalized) {
			conversionNotice = `URL converted: ${original} → ${normalized}`;
		}
	} 
	// Have selection (but not a URL)
	else if (selection) {
		linkText = selection;

		if (isClipboardUrl) {
			const original = clipboardText;
			const normalized = normalizeUrl(original);
			linkDest = normalized;
			shouldBeMarkdown = true;

			if (original !== normalized) {
				conversionNotice = `URL converted: ${original} → ${normalized}`;
			}
		} else {
			// Check if clipboard contains a valid link (wiki or markdown)
			const parsedLink = parseClipboardLink(clipboardText);
			if (parsedLink) {
				linkDest = parsedLink.destination;
				shouldBeMarkdown = !parsedLink.isWiki;
				conversionNotice = `Used destination from link in clipboard`;
			} else {
				linkDest = clipboardText;
				shouldBeMarkdown = false;
			}
		}
	} 
	// No selection, clipboard has URL
	else if (isClipboardUrl) {
		const original = clipboardText;
		const normalized = normalizeUrl(original);
		linkText = normalized;
		linkDest = normalized;
		shouldSelectText = true;
		shouldBeMarkdown = true;

		if (original !== normalized) {
			conversionNotice = `URL converted: ${original} → ${normalized}`;
		}
	} 
	// No selection, clipboard might have link or text
	else {
		// Check if clipboard contains a valid link (wiki or markdown)
		const parsedLink = parseClipboardLink(clipboardText);
		if (parsedLink) {
			linkText = parsedLink.text;
			linkDest = parsedLink.destination;
			shouldBeMarkdown = !parsedLink.isWiki;
			conversionNotice = `Used text & destination from link in clipboard`;
		} else {
			// If clipboard doesn't contain a valid link, use it as link text only
			linkText = clipboardText;
			linkDest = "";
			shouldBeMarkdown = false;
		}
	}

	return {
		text: linkText,
		destination: linkDest,
		isWiki: !shouldBeMarkdown,
		shouldSelectText,
		conversionNotice,
		start,
		end
	};
}

/**
 * Validation warning
 */
export interface ValidationWarning {
	text: string;
	severity: 'error' | 'caution';
}

/**
 * Result of link validation
 */
export interface ValidationResult {
	isValid: boolean;
	warnings: ValidationWarning[];
	shouldHighlightDest: boolean;
	shouldHighlightText: boolean;
}

/**
 * Check if a URL is an embeddable media file
 */
export function isEmbeddableUrl(url: string): boolean {
	if (!isUrl(url)) return false;
	
	// Common embeddable media extensions
	const embeddableExtensions = [
		// Images
		'.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.bmp', '.ico',
		// Videos
		'.mp4', '.webm', '.ogv', '.mov', '.mkv',
		// Audio
		'.mp3', '.wav', '.ogg', '.m4a', '.flac',
		// Documents
		'.pdf'
	];
	
	const lowerUrl = url.toLowerCase();
	return embeddableExtensions.some(ext => lowerUrl.includes(ext));
}

/**
 * Validate link destination based on link type
 */
export function validateLinkDestination(
	dest: string,
	linkText: string,
	isWiki: boolean,
	isEmbed: boolean = false,
	currentFilePath?: string
): ValidationResult {
	const warnings: ValidationWarning[] = [];
	let shouldHighlightDest = false;
	let shouldHighlightText = false;

	const destLength = dest ? dest.length : 0;

	// Check for URL normalization (www.example.com → https://www.example.com)
	if (!isWiki && dest) {
		const trimmed = dest.trim();
		const normalized = normalizeUrl(trimmed);
		if (normalized !== trimmed && isUrl(normalized)) {
			warnings.push({
				text: `URL will be converted: ${trimmed} → ${normalized}`,
				severity: 'caution'
			});
		}
	}

	// WikiLinks cannot link to URLs
	if (isWiki && isUrl(dest)) {
		warnings.push({
			text: "Warning: Wikilinks cannot link to external URLs.",
			severity: 'error'
		});
		shouldHighlightDest = true;
	}

	// Warn about embedding non-media URLs
	if (isEmbed && !isWiki && isUrl(dest) && !isEmbeddableUrl(dest)) {
		warnings.push({
			text: "Warning: Non-media URLs cannot be embedded (only images, audio, video, PDF).",
			severity: 'caution'
		});
		shouldHighlightDest = true;
	}

	// Warn about self-embedding (wikilinks only)
	if (isEmbed && isWiki && currentFilePath && dest) {
		// Extract filename from destination (before # or |)
		const destFile = dest.split('#')[0].split('|')[0].trim();
		// Extract filename from current file path
		const currentFile = currentFilePath.split('/').pop()?.replace(/\.md$/, '') || '';
		
		if (destFile && currentFile && destFile === currentFile) {
			warnings.push({
				text: "Warning: Note is embedding itself (may cause performance issues).",
				severity: 'caution'
			});
			shouldHighlightDest = true;
		}
	}

	// Check destination validity for current link type
	if (dest && !isUrl(dest)) {
		if (isWiki && !isValidWikiLink(dest)) {
			const converted = wikiToMarkdown(dest);
			if (converted !== dest) {
				warnings.push({
					text: "Invalid WikiLink destination. Can toggle to Markdown below.",
					severity: 'caution'
				});
			} else {
				warnings.push({
					text: "Wikilink destination contains forbidden characters (|*\":<>?[] in filename).",
					severity: 'error'
				});
			}
			shouldHighlightDest = true;
		} else if (!isWiki && !isValidMarkdownLink(dest)) {
			const converted = markdownToWiki(dest);
			if (converted !== null) {
				warnings.push({
					text: "Invalid Markdown link destination. Can toggle to Wikilink below.",
					severity: 'caution'
				});
			} else {
				warnings.push({
					text: "Invalid Markdown destination. Encode spaces and wrap them in <...> or toggle to WikiLink",
					severity: 'error'
				});
			}
			shouldHighlightDest = true;
		}
	}

	// Check for almost-URL (typos)
	if (!isUrl(dest) && isAlmostUrl(dest)) {
		warnings.push({
			text: `Warning: Destination looks like a URL but may have typos (check protocol).`,
			severity: 'caution'
		});
		shouldHighlightDest = true;
	}

	// Warn about very long destinations
	if (destLength > 500) {
		warnings.push({
			text: `Warning: Destination is very long (${destLength} chars). Consider shortening for reliability.`,
			severity: 'caution'
		});
		shouldHighlightDest = true;
	}

	const isValid = warnings.filter(w => w.severity === 'error').length === 0;

	return {
		isValid,
		warnings,
		shouldHighlightDest,
		shouldHighlightText
	};
}
