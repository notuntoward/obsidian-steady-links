/**
 * Link Operations - Pure business logic extracted from main.ts
 *
 * These functions handle the decision-making for link editing operations
 * without depending on the Obsidian Editor API, making them easily testable.
 *
 * NOTE: This module is test-only infrastructure. It is not imported by any
 * production source file. main.ts implements the same logic inline because
 * the real command handler interacts directly with the Obsidian Editor API.
 */

import { LinkInfo } from "../src/types";
import {
	detectLinkAtCursor,
	determineLinkFromContext,
	urlAtCursor,
	LinkAtCursor,
	LinkFromContext,
} from "../src/utils";

// ============================================================================
// Types
// ============================================================================

/**
 * Context provided by the editor for link operations
 */
export interface EditorContext {
	/** Current cursor line number */
	cursorLine: number;
	/** Current cursor character position */
	cursorCh: number;
	/** Text content of the current line */
	lineText: string;
	/** Currently selected text (empty string if no selection) */
	selection: string;
	/** Text from clipboard (may be empty) */
	clipboardText: string;
}

/**
 * Result of determining what link operation to perform
 */
export interface LinkOperation {
	/** The link information to edit */
	link: LinkInfo;
	/** Start character position of the link/selection */
	start: number;
	/** End character position of the link/selection */
	end: number;
	/** Whether the cursor entered the link from the left side */
	enteredFromLeft: boolean;
	/** Whether this is a new link being created (vs editing existing) */
	isNewLink: boolean;
	/** Whether the text field should be selected in the modal */
	shouldSelectText: boolean;
	/** Optional notice to display about clipboard usage */
	conversionNotice: string | null;
}

// ============================================================================
// Main Operation Function
// ============================================================================

/**
 * Determine what link operation to perform based on editor context.
 *
 * This is the main entry point for the "Edit Link" command logic.
 * It examines the current cursor position, selection, and clipboard
 * to determine whether to edit an existing link or create a new one.
 *
 * @param context The editor context (cursor, line, selection, clipboard)
 * @returns A LinkOperation describing what to do, or null if no operation
 */
export function determineLinkOperation(context: EditorContext): LinkOperation | null {
	const { cursorCh, lineText, selection, clipboardText } = context;

	// First, check if there's an existing link at the cursor
	const existingLink = detectLinkAtCursor(lineText, cursorCh);

	if (existingLink) {
		// Editing an existing link
		return createEditOperation(existingLink);
	}

	// Creating a new link - determine context
	return createNewLinkOperation(lineText, cursorCh, selection, clipboardText);
}

/**
 * Create an operation for editing an existing link
 */
function createEditOperation(existingLink: LinkAtCursor): LinkOperation {
	return {
		link: existingLink.link,
		start: existingLink.start,
		end: existingLink.end,
		enteredFromLeft: existingLink.enteredFromLeft,
		isNewLink: false,
		shouldSelectText: false,
		conversionNotice: null,
	};
}

/**
 * Create an operation for creating a new link
 */
function createNewLinkOperation(
	lineText: string,
	cursorCh: number,
	selection: string,
	clipboardText: string
): LinkOperation {
	// Check for URL at cursor position
	const cursorUrl = urlAtCursor(lineText, cursorCh);

	// Use determineLinkFromContext to figure out the link details
	const linkContext = determineLinkFromContext({
		selection,
		clipboardText,
		cursorUrl,
		line: lineText,
		cursorCh,
	});

	// Build the link info
	const link: LinkInfo = {
		text: linkContext.text,
		destination: linkContext.destination,
		isWiki: linkContext.isWiki,
		isEmbed: false,
	};

	// Determine the range to replace
	let start: number;
	let end: number;

	if (selection) {
		// If there's a selection, use selection range (caller provides this)
		// For now, use cursor position (selection range would need to be passed in)
		start = cursorCh;
		end = cursorCh;
	} else if (cursorUrl) {
		// If there's a URL at cursor, use its range
		start = linkContext.start;
		end = linkContext.end;
	} else {
		// No selection or URL - insert at cursor
		start = cursorCh;
		end = cursorCh;
	}

	return {
		link,
		start,
		end,
		enteredFromLeft: true,
		isNewLink: true,
		shouldSelectText: linkContext.shouldSelectText,
		conversionNotice: linkContext.conversionNotice,
	};
}

// ============================================================================
// Selection Range Helper
// ============================================================================

/**
 * Extended editor context with selection range information
 */
export interface EditorContextWithSelection extends EditorContext {
	/** Selection start position (if something is selected) */
	selectionFrom?: { line: number; ch: number };
	/** Selection end position (if something is selected) */
	selectionTo?: { line: number; ch: number };
	/** Whether something is selected */
	hasSelection: boolean;
}

/**
 * Determine link operation with full selection support
 */
export function determineLinkOperationWithSelection(
	context: EditorContextWithSelection
): LinkOperation | null {
	const {
		cursorCh,
		lineText,
		selection,
		clipboardText,
		hasSelection,
		selectionFrom,
		selectionTo,
	} = context;

	// First, check if there's an existing link at the cursor
	const existingLink = detectLinkAtCursor(lineText, cursorCh);

	if (existingLink) {
		return createEditOperation(existingLink);
	}

	// Creating a new link
	const cursorUrl = urlAtCursor(lineText, cursorCh);
	const linkContext = determineLinkFromContext({
		selection,
		clipboardText,
		cursorUrl,
		line: lineText,
		cursorCh,
	});

	const link: LinkInfo = {
		text: linkContext.text,
		destination: linkContext.destination,
		isWiki: linkContext.isWiki,
		isEmbed: false,
	};

	// Determine range
	let start: number;
	let end: number;

	if (hasSelection && selectionFrom && selectionTo) {
		// Use actual selection range
		start = selectionFrom.ch;
		end = selectionTo.ch;
	} else if (cursorUrl) {
		start = linkContext.start;
		end = linkContext.end;
	} else {
		start = cursorCh;
		end = cursorCh;
	}

	return {
		link,
		start,
		end,
		enteredFromLeft: true,
		isNewLink: true,
		shouldSelectText: linkContext.shouldSelectText,
		conversionNotice: linkContext.conversionNotice,
	};
}

// ============================================================================
// Skip Link Operation
// ============================================================================

/**
 * Context for the "Close Link" / skip operation
 */
export interface SkipLinkContext {
	/** Current cursor line */
	cursorLine: number;
	/** Current cursor character */
	cursorCh: number;
	/** Text of the current line */
	lineText: string;
	/** Total number of lines in document */
	lineCount: number;
	/** Length of previous line (if not on first line) */
	prevLineLength: number;
}

/**
 * Result of a skip link operation
 */
export interface SkipLinkResult {
	/** New cursor position */
	position: { line: number; ch: number };
	/** Whether a skip was performed */
	skipped: boolean;
}

/**
 * Determine the cursor position to skip over a link.
 *
 * Used by the "Close Link" command to jump over a link
 * without expanding it.
 */
export function determineSkipPosition(context: SkipLinkContext): SkipLinkResult {
	const { cursorCh, lineText, cursorLine, lineCount, prevLineLength } = context;

	const existingLink = detectLinkAtCursor(lineText, cursorCh);

	if (!existingLink) {
		return {
			position: { line: cursorLine, ch: cursorCh },
			skipped: false,
		};
	}

	// Calculate skip position based on cursor location within link
	const { start, end } = existingLink;
	const linkCenter = (start + end) / 2;
	const isOnLeftSide = cursorCh <= linkCenter;

	// Link spans entire line
	if (start === 0 && end >= lineText.length) {
		if (isOnLeftSide) {
			// Skip right -> next line
			if (cursorLine + 1 < lineCount) {
				return { position: { line: cursorLine + 1, ch: 0 }, skipped: true };
			}
			// Last line, go to previous
			if (cursorLine > 0) {
				return { position: { line: cursorLine - 1, ch: prevLineLength }, skipped: true };
			}
		} else {
			// Skip left -> previous line
			if (cursorLine > 0) {
				return { position: { line: cursorLine - 1, ch: prevLineLength }, skipped: true };
			}
			// First line, go to next
			if (cursorLine + 1 < lineCount) {
				return { position: { line: cursorLine + 1, ch: 0 }, skipped: true };
			}
		}
		// Single line document
		return { position: { line: cursorLine, ch: isOnLeftSide ? end : 0 }, skipped: true };
	}

	// Normal case: skip to one side or the other
	if (isOnLeftSide) {
		// Skip right
		if (end < lineText.length) {
			return { position: { line: cursorLine, ch: end + 1 }, skipped: true };
		}
		// Link at end of line, go to next line
		if (cursorLine + 1 < lineCount) {
			return { position: { line: cursorLine + 1, ch: 0 }, skipped: true };
		}
		// Last line, go left
		if (start > 0) {
			return { position: { line: cursorLine, ch: start - 1 }, skipped: true };
		}
		return { position: { line: cursorLine, ch: end }, skipped: true };
	} else {
		// Skip left
		if (start > 0) {
			return { position: { line: cursorLine, ch: start - 1 }, skipped: true };
		}
		// Link at start of line, go to previous line
		if (cursorLine > 0) {
			return { position: { line: cursorLine - 1, ch: prevLineLength }, skipped: true };
		}
		// First line, go right
		if (end < lineText.length) {
			return { position: { line: cursorLine, ch: end + 1 }, skipped: true };
		}
		return { position: { line: cursorLine, ch: 0 }, skipped: true };
	}
}
