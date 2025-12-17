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
	if (/^https?:\/\//i.test(dest)) return false;

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
	if (filename.includes("*") || filename.includes('\"') || filename.includes("?")) return false;
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
	
	// Match wiki link pattern: [[filename|display text]] or [[filename]]
	// Using a more specific pattern to correctly handle the pipe character
	// We need to find the last pipe before the closing brackets to separate destination from display text
	const innerContent = text.slice(linkStart, -2); // Remove ![[/[[ and ]]
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
	const pattern = isEmbed ? /^!\[([^\]]+)\]\(([^)]+)\)$/ : /^\[([^\]]+)\]\(([^)]+)\)$/;
	
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
