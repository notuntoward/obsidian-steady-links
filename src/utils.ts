import { TFile, Pos } from "obsidian";

/**
 * Check if a destination string is valid for a WikiLink format
 * 
 * WikiLink validation rules:
 * 1. Cannot be a URL (starts with http:// or https://)
 * 2. Filename portion (before #) cannot contain:
 *    - Angle brackets or parentheses: < > ( )
 *    - Obsidian forbidden characters: | ^ : %% [[ ]]
 *    - OS forbidden characters: * " ? \ /
 * 3. Heading/block reference (after #) validation:
 *    - Block references (starting with ^) can only contain alphanumeric and hyphens
 *    - Heading references cannot contain [[ ]] | %%
 */
export function isValidWikiLink(dest: string): boolean {
	if (!dest) return false;

	// WikiLinks don't support URLs
	if (/^https?:\/\//.test(dest)) return false;

	// Check for invalid characters in the filename portion
	// Split by # to separate filename from heading/block reference
	const parts = dest.split("#");
	const filename = parts[0];

	// Filename portion cannot contain: < > ( ) | ^ : %% [[ ]]
	// These are Obsidian's forbidden filename characters (plus angle brackets and parens)
	if (filename.includes("<") || filename.includes(">")) return false;
	if (filename.includes("(") || filename.includes(")")) return false;
	if (filename.includes("|")) return false;
	if (filename.includes("^")) return false;
	if (filename.includes(":")) return false;
	if (filename.includes("%%")) return false;
	if (filename.includes("[[") || filename.includes("]]")) return false;

	// Also check OS-level forbidden characters
	// Note: Forward slash (/) is NOT forbidden in Obsidian wikilinks - it's used for vault paths
	if (filename.includes("*") || filename.includes('"') || filename.includes("?")) return false;
	if (filename.includes("\\")) return false;

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
	// - Spaces must be encoded so the markdown link regex doesn't truncate
	// - Caret (^) must be encoded because it is a markdown link syntax character
	// - Parentheses ( ) must be encoded because the markdown link regex uses
	//   [^)]+ to delimit the destination and would stop at the first ).
	//   Headings in Obsidian commonly contain parens, e.g.
	//   [[Note#Heading (with parens)]] which must round-trip through markdown.
	const encoded = dest
		.replace(/ /g, "%20")
		.replace(/\^/g, "%5E")
		.replace(/\(/g, "%28")
		.replace(/\)/g, "%29");
	return encoded;
}

/**
 * Convert a Markdown link destination to WikiLink format
 */
export function markdownToWiki(dest: string): string | null {
	if (!dest) return dest;

	// If the original destination is a URL (including percent-encoded URLs),
	// it cannot be converted to a wikilink — return null immediately.
	// Check BEFORE decoding so that e.g. "http://a.aa/%09" is caught by the
	// https?:// prefix test before decodeURIComponent can turn %09 into a
	// tab character that breaks the \S+ URL regex.
	if (/^https?:\/\//i.test(dest) || /^www\./i.test(dest)) return null;

	// Remove angle brackets if present
	let cleaned = dest;
	if (dest.startsWith("<") && dest.endsWith(">")) {
		cleaned = dest.slice(1, -1);
	}

	// Also reject angle-bracket-wrapped URLs
	if (/^https?:\/\//i.test(cleaned) || /^www\./i.test(cleaned)) return null;

	// Decode URL encoding
	try {
		cleaned = decodeURIComponent(cleaned);
	} catch (e) {
		// If decode fails, manually decode common cases
		cleaned = cleaned
			.replace(/%20/g, " ")
			.replace(/%5E/gi, "^")
			.replace(/%28/g, "(")
			.replace(/%29/g, ")");
	}

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
 * Common file extensions that should NOT be treated as a domain TLD.
 * These guard the bare-domain heuristic so dotted note/file names like
 * `my.notes.md` or `report.final.docx` are not misclassified as URLs.
 */
const FILE_EXTENSION_LABELS = new Set([
	"md", "txt", "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
	"csv", "json", "yaml", "yml", "xml", "html", "htm", "css", "js", "ts",
	"png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico", "tiff",
	"mp3", "mp4", "wav", "mov", "avi", "mkv", "webm", "flac", "ogg",
	"zip", "gz", "tar", "rar", "7z", "exe", "dmg", "app",
	"canvas", "base", "excalidraw",
]);

/**
 * Bare-domain heuristic (no scheme, no www.).
 *
 * Conservatively recognises multi-dot hostnames like
 * `community.cloud.databricks.com` while leaving single-dot names
 * (`example.com`) and dotted file/note names (`my.notes.md`) alone.
 *
 * Rules:
 *   - No whitespace.
 *   - At least TWO dots (3+ labels). Single-dot names stay note names so the
 *     `[[example.com]]` wikilink contract is preserved.
 *   - Each label is 1–63 chars of [a-z0-9-], not starting/ending with `-`.
 *   - The final label (TLD) is purely alphabetic, 2+ chars.
 *   - The final label is not a known file extension.
 */
function isBareDomain(str: string): boolean {
	const trimmed = str.trim();
	if (!trimmed || /\s/.test(trimmed)) return false;

	const labels = trimmed.split(".");
	// Require 3+ labels (2+ dots).
	if (labels.length < 3) return false;

	const tld = labels[labels.length - 1].toLowerCase();
	// TLD must be purely alphabetic and 2+ chars.
	if (!/^[a-z]{2,}$/.test(tld)) return false;
	// Don't treat dotted file names as domains.
	if (FILE_EXTENSION_LABELS.has(tld)) return false;

	// Every label (including the TLD) must be a valid DNS label.
	const labelRe = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/i;
	return labels.every((label) => labelRe.test(label));
}

/**
 * File extensions that Obsidian can link to with wikilink syntax
 * (`[[name.ext]]`). This is the native "Accepted file formats" list from the
 * Obsidian docs plus HTML, which Obsidian also opens directly.
 *
 *   - Markdown:  md
 *   - Bases:     base
 *   - Canvas:    canvas
 *   - PDF:       pdf
 *   - HTML:      html, htm
 *   - Images:    avif, bmp, gif, jpeg, jpg, png, svg, webp
 *   - Audio:     flac, m4a, mp3, ogg, wav, webm, 3gp
 *   - Video:     mkv, mov, mp4, ogv, webm
 */
const LINKABLE_FILE_EXTENSIONS = new Set([
	"md", "base", "canvas", "pdf", "html", "htm",
	"avif", "bmp", "gif", "jpeg", "jpg", "png", "svg", "webp",
	"flac", "m4a", "mp3", "ogg", "wav", "webm", "3gp",
	"mkv", "mov", "mp4", "ogv",
]);

/**
 * Return the file extension (lowercased, without the dot) of a path-like
 * string, or null if it has none. Strips any trailing `#heading`/`^block`.
 */
function fileExtensionOf(token: string): string | null {
	const base = token.split("#")[0];
	const lastDot = base.lastIndexOf(".");
	if (lastDot <= 0 || lastDot === base.length - 1) return null;
	return base.slice(lastDot + 1).toLowerCase();
}

/**
 * Return true if `token` looks like a vault file reference whose extension is
 * one Obsidian can link to (see LINKABLE_FILE_EXTENSIONS). The token may
 * include a vault-relative folder path (e.g. `assets/diagram.canvas`).
 *
 * This does NOT check whether the file exists — callers with vault access do
 * that separately.
 */
export function hasLinkableFileExtension(token: string): boolean {
	if (!token) return false;
	const trimmed = token.trim();
	if (!trimmed) return false;
	const ext = fileExtensionOf(trimmed);
	return ext !== null && LINKABLE_FILE_EXTENSIONS.has(ext);
}

/**
 * Find a bare, whitespace-delimited file-reference token at the cursor whose
 * extension Obsidian can link to. Returns the token (which may include a
 * vault-relative folder path, e.g. `assets/diagram.canvas`) or null.
 *
 * The token is bounded by whitespace and link punctuation, so it never bleeds
 * across surrounding prose or into existing markdown/wikilink syntax. Filenames
 * containing spaces are handled via the selection path, not here — a single
 * cursor position on prose cannot be disambiguated from a space-containing
 * filename without selecting it.
 *
 * The caller only uses this when no link was already detected at the cursor.
 */
export function fileExtTokenAtCursor(text: string, pos: number): string | null {
	// A whitespace/punctuation-delimited run that can form a file reference.
	// Allows letters, digits, dots, dashes, underscores, slashes, #, ^.
	const tokenRe = /[A-Za-z0-9._\-\/\\#^]+/g;
	let m: RegExpExecArray | null;
	while ((m = tokenRe.exec(text)) !== null) {
		const start = m.index;
		const end = start + m[0].length;
		if (pos < start || pos > end) continue;
		if (hasLinkableFileExtension(m[0])) return m[0];
	}
	return null;
}

/**
 * Check if a string is a URL
 */
export function isUrl(str: string): boolean {
	if (!str) return false;
	const trimmed = str.trim();
	if (/^https?:\/\/\S+$|^www\.\S+$/i.test(trimmed)) return true;
	// Bare multi-dot domains (e.g. community.cloud.databricks.com).
	return isBareDomain(trimmed);
}

/**
 * Normalize a URL (add https:// prefix if needed)
 */
export function normalizeUrl(str: string): string {
	if (!str) return str;
	const trimmed = str.trim();
	if (/^https?:\/\//i.test(trimmed)) return trimmed;
	if (/^www\./i.test(trimmed)) return "https://" + trimmed;
	// Bare multi-dot domains get an https:// scheme so they open in the browser
	// rather than resolving to an internal note.
	if (isBareDomain(trimmed)) return "https://" + trimmed;
	return trimmed;
}

/**
 * Inverse of the bare-domain promotion in normalizeUrl().
 *
 * Given a host-only web URL whose host is a bare multi-dot domain
 * (e.g. `https://community.cloud.databricks.com`), return the bare host
 * (`community.cloud.databricks.com`) so it can be used as a wikilink note
 * target. Returns null for anything else — including URLs that carry a path,
 * query, port, or fragment, since those cannot be a note name.
 *
 * This lets the editor offer a one-click "I meant a note" correction when a
 * bare domain was auto-promoted to a web link.
 */
export function bareDomainNoteTargetFromUrl(dest: string): string | null {
	if (!dest) return null;
	const trimmed = dest.trim();

	// Strip an optional http(s):// scheme; the www. form is handled below.
	const schemeMatch = /^https?:\/\/(.*)$/i.exec(trimmed);
	const afterScheme = schemeMatch ? schemeMatch[1] : trimmed;

	// Host-only: no path, query, fragment, port, credentials, or whitespace.
	if (/[\/?#@:\s]/.test(afterScheme)) return null;

	// Drop a leading www. so https://www.a.b.com → a.b.com.
	const host = afterScheme.replace(/^www\./i, "");

	return isBareDomain(host) ? host : null;
}

/**
 * Check if a string looks like a URL but may have typos
 */
export function isAlmostUrl(str: string): boolean {
	if (!str) return false;
	const trimmed = str.trim();
        // Check for common typos: htp, htps, http, https, www
        // Also check for bare URLs like www.nytimes.com
        return /^(htp|htps|http|https|www)[:.a-zA-Z0-9-]|^(www\.)[a-zA-Z0-9-]/i.test(trimmed);
}

/**
 * Find URL at a specific cursor position in text
 */
export function urlAtCursor(text: string, pos: number): string | null {
	// First alternative: scheme/www URLs. Last alternative: a bare token that
	// could be a multi-dot domain — validated below via isBareDomain so dotted
	// note/file names are not matched.
	const urlRegex = /https?:\/\/[^\s]+|www\.[^\s]+|[A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9]/gi;
	let match;
	while ((match = urlRegex.exec(text)) !== null) {
		if (pos >= match.index && pos <= match.index + match[0].length) {
			const token = match[0];
			// Scheme/www matches are returned directly.
			if (/^(https?:\/\/|www\.)/i.test(token)) return token;
			// Otherwise only accept genuine bare multi-dot domains.
			if (isBareDomain(token)) return token;
			// Token at cursor is not a URL; keep scanning for a later match.
		}
	}
	return null;
}

/**
 * Parse clipboard content to extract link information.
 * Handles wiki links [[]], markdown links [text](url), and raw/multi-line
 * URL clipboard content (including custom URI schemes like onenote:, vscode:,
 * etc.) via resolveClipboardToLinkDestination().
 * Returns null if clipboard doesn't contain a valid link.
 */
export function parseClipboardLink(clipboardText: string): { text: string; destination: string; isWiki: boolean; isEmbed: boolean } | null {
	if (!clipboardText) return null;

	const trimmed = clipboardText.trim();

	// Try to parse as wiki link first (only for single-line [[...]] syntax)
	const wikiLink = parseWikiLink(trimmed);
	if (wikiLink) {
		return { ...wikiLink, isWiki: true };
	}

	// Try to parse as markdown link (only for single-line [text](url) syntax)
	const markdownLink = parseMarkdownLink(trimmed);
	if (markdownLink) {
		return { ...markdownLink, isWiki: false };
	}

	// Try resolving as a raw URL or multi-line clipboard with URL schemes.
	// resolveClipboardToLinkDestination() returns null when no recognisable
	// URL is found, so a non-null result is always a genuine URL.
	const resolved = resolveClipboardToLinkDestination(clipboardText);
	if (resolved !== null) {
		return { text: "", destination: resolved, isWiki: false, isEmbed: false };
	}

	return null;
}

// ============================================================================
// NEW: Refactored functions for improved testability
// ============================================================================

/**
 * Strip surrounding double or single quotes from a string if they match.
 * Used to normalise file paths that Windows Explorer copies with quotes.
 */
function stripSurroundingQuotes(s: string): string {
	if (
		(s.startsWith('"') && s.endsWith('"')) ||
		(s.startsWith("'") && s.endsWith("'"))
	) {
		return s.slice(1, -1);
	}
	return s;
}

/**
 * Return true if the string looks like an absolute file-system path.
 * Recognises (after stripping surrounding quotes):
 *   - Windows absolute:  C:\...  or  C:/...
 *   - Windows UNC:       \\server\share  or  //server/share
 *   - Unix/macOS absolute:  /path/...
 */
export function isFilePath(str: string): boolean {
	if (!str) return false;
	const s = stripSurroundingQuotes(str.trim());
	// Windows drive letter path: X:\ or X:/
	if (/^[a-zA-Z]:[/\\]/.test(s)) return true;
	// Windows or Unix UNC: \\ or //
	if (/^[/\\]{2}/.test(s)) return true;
	// Unix / macOS absolute path
	if (s.startsWith("/")) return true;
	return false;
}

/**
 * Resolve raw clipboard text to the best single URL to use as an Obsidian
 * markdown link destination.  Handles three cases:
 *
 *   1. Multi-line clipboard with custom URI scheme lines (onenote:, vscode:, …)
 *      and optional HTTP(S) web-fallback lines.  Custom scheme wins.
 *   2. Single standard HTTP/HTTPS URL — passed through normalizeUrl() as-is.
 *   3. Absolute file-system path (Windows or Unix), optionally quoted.
 *
 * Returns `null` when no recognisable URL or path is found (plain text, etc.).
 * Callers that need a last-resort string must handle `null` themselves.
 *
 * Lines ending with the literal token `&end` have that suffix stripped before
 * evaluation.
 *
 * This function is pure (no side effects, no Obsidian API) and is used by
 * both parseClipboardLink() and determineLinkFromContext().
 */
export function resolveClipboardToLinkDestination(clipboardText: string): string | null {
	if (!clipboardText) return null;

	const trimmed = clipboardText.trim();
	if (!trimmed) return null;

	// Split into non-blank lines, stripping the `&end` trailer from each.
	const lines = trimmed
		.split(/\r?\n/)
		.map((l) => {
			const t = l.trim();
			return t.endsWith("&end") ? t.slice(0, -4).trimEnd() : t;
		})
		.filter((l) => l.length > 0);

	// Matches a URI scheme token of 2+ characters followed by a colon: "scheme:"
	// Single-character "schemes" (e.g. Windows drive letters like C:) are
	// excluded by requiring at least two characters before the colon.
	const customSchemeRe = /^[a-zA-Z][a-zA-Z0-9+\-.]+:/;

	// Standard schemes that should NOT be promoted as "app" link destinations.
	// These are standard protocol schemes that are either unsafe (javascript:,
	// data:, vbscript:) or not useful as Obsidian link targets (mailto:, ftp:,
	// file:).  Blocked regardless of OS so the behaviour is consistent.
	const blockedSchemeRe = /^(file|data|mailto|javascript|vbscript|ftp|ftps|blob):/i;

	// Pass 1: look for a custom (non-http/https) URI scheme line.
	for (const line of lines) {
		if (
			customSchemeRe.test(line) &&
			!/^https?:/i.test(line) &&
			!blockedSchemeRe.test(line)
		) {
			return line;
		}
	}

	// Pass 2: fall back to the first standard http/https line.
	for (const line of lines) {
		if (isUrl(line)) {
			return normalizeUrl(line);
		}
	}

	// Pass 3: absolute file-system path (Windows or Unix), optionally quoted.
	// Strip surrounding quotes so the destination is the bare path.
	for (const line of lines) {
		if (isFilePath(line)) {
			return stripSurroundingQuotes(line);
		}
	}

	// No recognisable URL or path found.
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
	// Note: the display-text group is [^\]]* (zero-or-more) so that empty-text
	// links like [](url) are detected. The destination remains [^)]+ (required).
	const mdRegex = /(!?)\[([^\]]*)\]\(([^)]+)\)/g;
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
 * Opt-in options controlling how much of a wikilink's inner content is
 * treated as "syntax" (hidden) vs. "displayed text" (visible) when there is
 * no alias pipe.
 *
 * These are OFF by default because stock Obsidian does NOT shorten a
 * no-alias wikilink's displayed text — `[[Note#Heading]]` renders as
 * "Note#Heading", not "Heading", when the cursor is off it. Enabling an
 * option here makes Steady Links itself perform that shortening (and keep
 * it steady across cursor movement), which is primarily useful for parity
 * with third-party plugins (e.g. "Short Links") that shorten link display
 * text but only do so while the cursor is *off* the link — causing the link
 * to visually change when the cursor enters it, exactly the inconsistency
 * Steady Links exists to prevent.
 */
export interface WikiLinkHidingOptions {
	/**
	 * Hide the note path and "#"/"#^" marker for heading and block
	 * references without an alias, e.g. `[[Note#Heading]]` -> "Heading" and
	 * `[[Note#^block-id]]` -> "block-id".
	 */
	shortenHeadingLinks?: boolean;
}

/**
 * Given the inner content of a wikilink with no alias pipe (e.g. `dest` in
 * `[[dest]]`), compute the offset (relative to the start of that content)
 * where the shortened display text begins: past the note path and the
 * "#" (or "#^") marker for heading/block references. Returns 0 when there
 * is no "#" (a plain file link, or already just a heading with no note
 * path prefix).
 *
 * Shared by findWikiLinkSyntaxRanges() (linkSyntaxHider.ts) and
 * computeDisplayedTextRange() below so the editor's visual hiding and the
 * skip-link command's boundary never drift out of sync when
 * shortenHeadingLinks is enabled.
 */
export function wikiLinkVisibleTextOffset(innerContent: string): number {
	const hashIdx = innerContent.indexOf('#');
	if (hashIdx === -1) return 0;
	const afterHash = innerContent.substring(hashIdx + 1);
	return hashIdx + 1 + (afterHash.startsWith('^') ? 1 : 0);
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
 * @param options Opt-in wikilink shortening options (see WikiLinkHidingOptions).
 *   Defaults to stock-Obsidian-matching behavior (no shortening).
 * @returns The displayed text range, or null if no link at cursor
 */
export function computeDisplayedTextRange(
	line: string,
	cursorCh: number,
	options: WikiLinkHidingOptions = {}
): DisplayedTextRange | null {
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
			// No pipe: [[dest]] - displayed text is the destination by
			// default, matching stock Obsidian. When shortenHeadingLinks is
			// enabled, skip past the note path and "#"/"#^" marker so this
			// matches the shortened text findWikiLinkSyntaxRanges keeps
			// visible in the editor.
			displayedTextStart = options.shortenHeadingLinks
				? innerStart + wikiLinkVisibleTextOffset(innerContent)
				: innerStart;
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
	/**
	 * Whether `cursorUrl` (when it is a scheme-less bare-domain string) resolves
	 * to an existing note in the vault. Computed by the caller, which has vault
	 * access. When true, a bare domain like `community.cloud.databricks.com` is
	 * treated as a wikilink to that note rather than promoted to a web URL.
	 */
	cursorUrlResolvesToNote?: boolean;
	/**
	 * A bare file-reference token at the cursor (e.g. `assets/diagram.canvas`)
	 * that the caller has confirmed resolves to an existing vault file. When
	 * set, it takes precedence and becomes a wikilink to that file.
	 */
	cursorFileLink?: string | null;
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
	const cursorUrlResolvesToNote = context.cursorUrlResolvesToNote ?? false;
	const cursorFileLink = context.cursorFileLink ?? null;

	const isSelectionUrl = isUrl(selection);
	const isClipboardUrl = isUrl(clipboardText);

	let linkText = "";
	let linkDest = "";
	let shouldBeMarkdown = false;
	let shouldSelectText = false;
	let conversionNotice: string | null = null;
	let start = cursorCh;
	let end = cursorCh;

	// Highest precedence: cursor is on a bare file reference (e.g.
	// diagram.canvas, assets/photo.png) that the caller confirmed exists in the
	// vault. Make a wikilink to that file.
	if (cursorFileLink && !selection) {
		const token = cursorFileLink.trim();
		linkText = token;
		linkDest = token;
		shouldBeMarkdown = false; // wikilink to the file
		shouldSelectText = true;

		const tokenStart = line.indexOf(token);
		if (tokenStart !== -1) {
			start = tokenStart;
			end = tokenStart + token.length;
		}

		return {
			text: linkText,
			destination: linkDest,
			isWiki: true,
			shouldSelectText,
			conversionNotice: null,
			start,
			end,
		};
	}

	// If cursor is on a URL but not within a link, use that URL
	if (cursorUrl && !isSelectionUrl) {
		const original = cursorUrl.trim();

		// A scheme-less bare-domain string (e.g. community.cloud.databricks.com)
		// that matches an existing note is treated as a note link, not a web
		// URL — the existing note is strong evidence of intent.
		const isExplicitUrl = /^(https?:\/\/|www\.)/i.test(original);
		if (!isExplicitUrl && cursorUrlResolvesToNote) {
			linkText = original;
			linkDest = original;
			shouldBeMarkdown = false; // wikilink to the note
			shouldSelectText = true;
		} else {
			const normalized = normalizeUrl(original);

			// When cursor is on a bare URL, the link text should be the URL
			// itself, ignoring any non-link text in the clipboard.
			linkText = original;

			linkDest = normalized;
			shouldBeMarkdown = true;
			shouldSelectText = true;

			if (original !== normalized) {
				conversionNotice = `URL converted: ${original} → ${normalized}`;
			}
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
		// Check if clipboard contains a valid link (wiki, markdown, or URL)
		const parsedLink = parseClipboardLink(clipboardText);
		if (parsedLink) {
			if (parsedLink.isWiki || parsedLink.text) {
				// Structured wiki/markdown link — use both text and destination
				linkText = parsedLink.text;
				linkDest = parsedLink.destination;
				shouldBeMarkdown = !parsedLink.isWiki;
				conversionNotice = `Used text & destination from link in clipboard`;
			} else {
				// Raw URL resolved from clipboard (text is empty) — treat like
				// the isClipboardUrl branch: pre-fill dest and select text field
				// so the user can type a meaningful title.
				linkDest = parsedLink.destination;
				linkText = parsedLink.destination;
				shouldBeMarkdown = true;
				shouldSelectText = true;
			}
		} else {
			// Clipboard has plain text but no link — leave both fields empty.
			// Plain clipboard text is too likely to be stale/unrelated to be
			// a useful default for link text.
			linkText = "";
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
	currentFilePath?: string,
	destResolvesToNote: boolean = false
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

	// WikiLinks cannot link to *explicit* URLs (those with an http(s):// scheme
	// or a www. prefix). A scheme-less, bare-domain-shaped string like
	// `community.cloud.databricks.com` is a legitimate wikilink note target —
	// Obsidian happily links to notes that don't exist yet — so it is NOT an
	// error here even though isUrl() treats it as URL-shaped. The
	// destResolvesToNote guard additionally covers any explicit-form edge cases
	// that resolve to a real note.
	const destIsExplicitUrl = !!dest && /^(https?:\/\/|www\.)/i.test(dest.trim());
	if (isWiki && destIsExplicitUrl && !destResolvesToNote) {
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

