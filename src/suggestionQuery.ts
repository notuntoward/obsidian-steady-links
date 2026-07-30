/**
 * Suggestion Query Parser
 *
 * Pure functions for parsing and handling file suggestion queries.
 * Extracted from FileSuggest.ts for testability.
 */

// ============================================================================
// Types
// ============================================================================

/**
 * The type of suggestion query being made
 */
export type QueryType =
	| 'global-heading'      // ##heading - search headings in all files
	| 'current-block'       // #^block - search blocks in current file
	| 'current-heading'     // #heading - search headings in current file
	| 'block'               // ^block - search blocks in current file (no #)
	| 'file-block'          // file#^block - blocks in specific file
	| 'file-heading'        // file#heading - headings in specific file
	| 'file-block-no-hash'  // file^block - blocks in specific file (no #)
	| 'file-alias'          // file|alias - alias display text query
	| 'file';               // file - just a file name

/**
 * Parsed suggestion query
 */
export interface ParsedQuery {
	/** The type of query */
	type: QueryType;
	/** The file name (for file-specific queries) */
	fileName?: string;
	/** The search term (heading text, block ID, or file name) */
	searchTerm?: string;
	/** The original query string */
	original: string;
}

// ============================================================================
// Main Parser
// ============================================================================

/**
 * Parse a suggestion query string into its components
 *
 * This function determines what type of suggestion is being requested
 * based on the query syntax:
 *
 * - `##heading` - Search headings across all files
 * - `#^block` - Search blocks in current file
 * - `#heading` - Search headings in current file
 * - `^block` - Search blocks in current file (without #)
 * - `file#^block` - Search blocks in specific file
 * - `file#heading` - Search headings in specific file
 * - `file^block` - Search blocks in specific file (without #)
 * - `file` - Search for files
 *
 * @param query The raw query string from the input
 * @returns A parsed query object with type and components
 */
export function parseSuggestionQuery(query: string): ParsedQuery {
	const trimmed = query.trim();
	const original = trimmed;

	// Strip optional leading brackets if present (e.g. [[## or [## or [[Note#Heading)
	const clean = trimmed.replace(/^\[{1,2}/, '');

	// 1. ##heading - Global heading search
	if (clean.startsWith('##')) {
		return {
			type: 'global-heading',
			searchTerm: clean.slice(2),
			original,
		};
	}

	// 2. #^block - Block in current file (must check before #heading)
	if (clean.startsWith('#^')) {
		return {
			type: 'current-block',
			searchTerm: clean.slice(2),
			original,
		};
	}

	// 3. #heading - Heading in current file
	if (clean.startsWith('#') && !clean.startsWith('##')) {
		return {
			type: 'current-heading',
			searchTerm: clean.slice(1),
			original,
		};
	}

	// 4. ^block - Block in current file (without #)
	if (clean.startsWith('^')) {
		return {
			type: 'block',
			searchTerm: clean.slice(1),
			original,
		};
	}

	// 5. file#^block - Block in specific file (must check before file#heading)
	if (clean.includes('#^')) {
		const hashIdx = clean.indexOf('#^');
		const fileName = clean.slice(0, hashIdx);
		const searchTerm = clean.slice(hashIdx + 2);
		return {
			type: 'file-block',
			fileName,
			searchTerm,
			original,
		};
	}

	// 6. file#heading - Heading in specific file
	if (clean.includes('#') && !clean.startsWith('#')) {
		const hashIdx = clean.indexOf('#');
		const fileName = clean.slice(0, hashIdx);
		const searchTerm = clean.slice(hashIdx + 1);
		return {
			type: 'file-heading',
			fileName,
			searchTerm,
			original,
		};
	}

	// 7. file^block - Block in specific file (without #)
	if (clean.includes('^') && !clean.startsWith('^')) {
		const caretIdx = clean.indexOf('^');
		const fileName = clean.slice(0, caretIdx);
		const searchTerm = clean.slice(caretIdx + 1);
		return {
			type: 'file-block-no-hash',
			fileName,
			searchTerm,
			original,
		};
	}

	// 8. file|alias - Alias display text for note
	if (clean.includes('|')) {
		const pipeIdx = clean.indexOf('|');
		const fileName = clean.slice(0, pipeIdx);
		const searchTerm = clean.slice(pipeIdx + 1);
		return {
			type: 'file-alias',
			fileName,
			searchTerm,
			original,
		};
	}

	// 9. Default: file search
	return {
		type: 'file',
		searchTerm: clean,
		original,
	};
}

// ============================================================================
// Query Utilities
// ============================================================================

/**
 * Check if a query is for a specific file (vs current file or global)
 */
export function isFileSpecificQuery(query: ParsedQuery): boolean {
	return ['file-block', 'file-heading', 'file-block-no-hash', 'file'].includes(query.type);
}

/**
 * Check if a query is for blocks (vs headings or files)
 */
export function isBlockQuery(query: ParsedQuery): boolean {
	return ['current-block', 'block', 'file-block', 'file-block-no-hash'].includes(query.type);
}

/**
 * Check if a query is for headings
 */
export function isHeadingQuery(query: ParsedQuery): boolean {
	return ['global-heading', 'current-heading', 'file-heading'].includes(query.type);
}

/**
 * Check if a query should search the current file only
 */
export function isCurrentFileQuery(query: ParsedQuery): boolean {
	return ['current-block', 'current-heading', 'block'].includes(query.type);
}

/**
 * Check if a query should search all files
 */
export function isGlobalQuery(query: ParsedQuery): boolean {
	return query.type === 'global-heading';
}

/**
 * Get the effective search term for filtering
 */
export function getSearchTerm(query: ParsedQuery): string {
	return query.searchTerm?.toLowerCase() ?? '';
}

/**
 * Check if the query has a non-empty search term
 */
export function hasSearchTerm(query: ParsedQuery): boolean {
	return (query.searchTerm?.length ?? 0) > 0;
}

// ============================================================================
// Link Value Generation
// ============================================================================

/**
 * Context for generating link values
 */
export interface LinkValueContext {
	/** The parsed query */
	query: ParsedQuery;
	/** The current file path (if any) */
	currentFilePath?: string;
	/** The target file basename (for file-specific queries) */
	targetFileBasename?: string;
	/** The heading text (for heading queries) */
	headingText?: string;
	/** The block ID (for block queries) */
	blockId?: string;
}

/**
 * Generate the link destination value from a suggestion selection
 *
 * @param context The context for link generation
 * @returns The link destination string
 */
export function generateLinkValue(context: LinkValueContext): string {
	const { query, currentFilePath, targetFileBasename, headingText, blockId } = context;

	switch (query.type) {
		case 'global-heading':
		case 'current-heading':
			// If same file, just #heading
			if (query.type === 'current-heading' || !targetFileBasename) {
				return `#${headingText}`;
			}
			// Different file: file#heading
			return `${targetFileBasename}#${headingText}`;

		case 'file-heading':
			return `${targetFileBasename}#${headingText}`;

		case 'current-block':
		case 'block':
			return `#^${blockId}`;

		case 'file-block':
		case 'file-block-no-hash':
			return `${targetFileBasename}#^${blockId}`;

		case 'file':
		default:
			return targetFileBasename ?? '';
	}
}

// ============================================================================
// Query Validation
// ============================================================================

/**
 * Validate a parsed query for common issues
 */
export function validateQuery(query: ParsedQuery): {
	valid: boolean;
	warnings: string[];
} {
	const warnings: string[] = [];

	// Check for empty file name in file-specific queries
	if (isFileSpecificQuery(query) && query.type !== 'file') {
		if (!query.fileName || query.fileName.trim() === '') {
			warnings.push('File name is required for this query type');
		}
	}

	// Check for potentially problematic characters
	if (query.fileName) {
		if (query.fileName.includes('|')) {
			warnings.push('File name contains "|" which may cause issues');
		}
		if (query.fileName.includes('[[') || query.fileName.includes(']]')) {
			warnings.push('File name contains "[[" or "]]" which are not allowed');
		}
	}

	return {
		valid: warnings.length === 0,
		warnings,
	};
}