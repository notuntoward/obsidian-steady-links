/**
 * Pure business logic extracted from EditLinkModal.
 *
 * These functions contain the decision-making and data-transformation logic
 * that was previously embedded in the Modal class methods.  They have no
 * dependency on the Obsidian API or the DOM, which makes them trivially
 * testable.
 */

import { LinkInfo } from "./types";
import { isUrl, isAlmostUrl } from "./utils";

/**
 * Result of parsing a conversion notice string to determine what was used
 * from the clipboard.
 */
export interface ClipboardFlags {
	clipboardUsedText: boolean;
	clipboardUsedDest: boolean;
}

/**
 * Parse a conversion notice string to determine which fields came from
 * the clipboard.
 *
 * @param conversionNotice The notice string set by determineLinkFromContext(),
 *   or null/undefined if there was none.
 * @returns Flags indicating whether the link text and/or destination originated
 *   from the clipboard.
 */
export function parseClipboardFlags(conversionNotice: string | null | undefined): ClipboardFlags {
	if (!conversionNotice) {
		return { clipboardUsedText: false, clipboardUsedDest: false };
	}
	if (conversionNotice.includes("text & destination")) {
		return { clipboardUsedText: true, clipboardUsedDest: true };
	}
	if (conversionNotice.includes("text")) {
		return { clipboardUsedText: true, clipboardUsedDest: false };
	}
	if (conversionNotice.includes("destination")) {
		return { clipboardUsedText: false, clipboardUsedDest: true };
	}
	return { clipboardUsedText: false, clipboardUsedDest: false };
}

// ──────────────────────────────────────────────────────────────────────────────
// Initial focus
// ──────────────────────────────────────────────────────────────────────────────

/**
 * The set of focus actions that the modal can perform when it opens.
 *
 * - `text-focus`:   focus the text field (cursor at end)
 * - `text-select`:  focus the text field and select all text
 * - `dest-focus`:   focus the destination field (cursor at end)
 * - `dest-select`:  focus the destination field and select all text
 */
export type FocusAction = "text-focus" | "text-select" | "dest-focus" | "dest-select";

/**
 * Determine which input field to focus (and whether to select its content)
 * when the modal first opens.
 *
 * @param linkText         Current link display text (may be empty)
 * @param linkDest         Current link destination (may be empty)
 * @param shouldSelectText If true, the caller wants the text field selected
 *   (e.g. because the destination was just set from a URL)
 * @returns The action the modal should perform.
 */
export function determineInitialFocus(
	linkText: string,
	linkDest: string,
	shouldSelectText: boolean,
): FocusAction {
	if (!linkText || linkText.length === 0) {
		return "text-focus";
	}
	if (!linkDest || linkDest.length === 0) {
		return "dest-focus";
	}
	if (linkDest.length > 500 || isAlmostUrl(linkDest)) {
		return "dest-select";
	}
	if (shouldSelectText) {
		return "text-select";
	}
	// Default: focus text and select (since text has content)
	return "text-select";
}

// ──────────────────────────────────────────────────────────────────────────────
// Destination input handling
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Result of processing a change to the destination field.
 */
export interface DestInputResult {
	/** Whether the link should be a WikiLink (may change if dest becomes a URL) */
	isWiki: boolean;
	/** Whether the destination is a URL */
	wasUrl: boolean;
}

/**
 * Decide whether to auto-switch the link type when the destination changes.
 *
 * If the new destination is a URL and the link is currently set to WikiLink,
 * it should auto-switch to Markdown because WikiLinks can't link to URLs.
 *
 * @param newDest  The new destination value entered by the user
 * @param isWiki   Whether the link is currently set to wiki format
 * @returns Updated link type flags
 */
export function handleDestChange(newDest: string, isWiki: boolean): DestInputResult {
	const isNowUrl = isUrl(newDest);
	if (isNowUrl && isWiki) {
		return { isWiki: false, wasUrl: true };
	}
	return { isWiki, wasUrl: isNowUrl };
}

// ──────────────────────────────────────────────────────────────────────────────
// Conversion notice
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Compute the conversion notice text based on whether the user has modified
 * the fields that originally came from the clipboard.
 *
 * Returns `null` if the notice should be removed (user has changed all
 * clipboard-sourced fields).
 *
 * @param currentText        Current text field value
 * @param currentDest        Current destination field value
 * @param originalText       Original text value (from when modal opened)
 * @param originalDest       Original destination value (from when modal opened)
 * @param clipboardUsedText  Whether the text field came from clipboard
 * @param clipboardUsedDest  Whether the destination field came from clipboard
 * @returns The notice string to display, or null to remove the notice.
 */
export function computeConversionNotice(
	currentText: string,
	currentDest: string,
	originalText: string,
	originalDest: string,
	clipboardUsedText: boolean,
	clipboardUsedDest: boolean,
): string | null {
	const textStillFromClipboard = clipboardUsedText && currentText === originalText;
	const destStillFromClipboard = clipboardUsedDest && currentDest === originalDest;

	if (!textStillFromClipboard && !destStillFromClipboard) {
		return null;
	}

	if (textStillFromClipboard && destStillFromClipboard) {
		return "Used text & destination from link in clipboard";
	}
	if (textStillFromClipboard) {
		return "Used text from link in clipboard";
	}
	if (destStillFromClipboard) {
		return "Used destination from link in clipboard";
	}
	// Should never reach here, but TypeScript needs the return
	return null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Submit validation
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Result of validating the modal before submission.
 */
export interface SubmitValidation {
	/** Whether the form is valid and can be submitted */
	valid: boolean;
	/** The final link text to use (destination used as fallback if text is empty) */
	finalText: string;
	/** The trimmed destination */
	finalDest: string;
	/** Error message if validation failed */
	error?: string;
}

/**
 * Validate the modal fields before submission and compute the final values.
 *
 * Rules:
 * - Destination is always required
 * - If text is empty, use the destination as the display text
 *
 * @param linkText  Raw text field value
 * @param linkDest  Raw destination field value
 * @returns Validation result with final values or error.
 */
export function validateSubmission(linkText: string, linkDest: string): SubmitValidation {
	const trimmedText = linkText.trim();
	const trimmedDest = linkDest.trim();

	if (!trimmedDest) {
		return {
			valid: false,
			finalText: trimmedText,
			finalDest: trimmedDest,
			error: "Error: Destination is required.",
		};
	}

	const finalText = !trimmedText ? trimmedDest : trimmedText;

	return {
		valid: true,
		finalText,
		finalDest: trimmedDest,
	};
}

/**
 * Result of determining the initial link type.
 */
export interface InitialLinkState {
	/** Whether the link should be wiki format */
	isWiki: boolean;
	/** Whether the destination is a URL */
	wasUrl: boolean;
}

/**
 * Determine the initial link type when the modal opens.
 *
 * If the destination is a URL, force markdown (since wikilinks can't link to URLs).
 * Otherwise, respect the provided isWiki flag.
 *
 * @param destination  The link destination
 * @param isWiki       Whether the link was originally a wiki link
 * @returns The initial link state including isWiki and wasUrl flags
 */
export function determineInitialLinkType(destination: string, isWiki: boolean): InitialLinkState {
	const destIsUrl = isUrl(destination);
	return {
		isWiki: destIsUrl ? false : isWiki,
		wasUrl: destIsUrl,
	};
}

// ──────────────────────────────────────────────────────────────────────────────
// Link text building
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Build the full link markup string from a LinkInfo result.
 *
 * @param result  The link information (text, destination, format, embed)
 * @returns The replacement string for the editor, e.g. `[text](dest)` or `[[dest|text]]`
 */
export function buildLinkText(result: LinkInfo): string {
	const embedPrefix = result.isEmbed ? "!" : "";
	if (result.isWiki) {
		if (result.text === result.destination) {
			return `${embedPrefix}[[${result.destination}]]`;
		}
		return `${embedPrefix}[[${result.destination}|${result.text}]]`;
	}
	return `${embedPrefix}[${result.text}](${result.destination})`;
}

// ──────────────────────────────────────────────────────────────────────────────
// Post-edit cursor positioning
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Parameters for computing the cursor position that will close a link
 * after editing.
 */
export interface CloseCursorParams {
	/** Character offset where the link starts on its line */
	linkStart: number;
	/** Character offset where the link ends (linkStart + replacement length) */
	linkEnd: number;
	/** Length of the line after the edit */
	lineLength: number;
	/** Line number the link is on */
	line: number;
	/** Whether to prefer positioning cursor to the right of the link */
	preferRight: boolean;
	/** Total number of lines in the document */
	lineCount: number;
	/** Length of the previous line (used only when link spans entire line) */
	prevLineLength: number;
}

/**
 * Compute the cursor position that will cause Obsidian's live preview to
 * collapse (close) the link.
 *
 * Obsidian treats cursor positions at the link boundary (start and
 * start + length) as "inside" the link, so we position one character
 * further out. When the link spans the entire line, no same-line position
 * is outside the decoration, so we move to an adjacent line.
 *
 * @param params  All the information needed to compute the position
 * @returns `{ line, ch }` cursor position that will close the link
 */
export function computeCloseCursorPosition(params: CloseCursorParams): { line: number; ch: number } {
	const { linkStart, linkEnd, lineLength, line, preferRight, lineCount, prevLineLength } = params;

	if (linkStart === 0 && linkEnd >= lineLength) {
		// Link spans the entire line — no position on this line is outside
		// the decoration. Move cursor to an adjacent line instead.
		if (line + 1 < lineCount) {
			return { line: line + 1, ch: 0 };
		} else if (line > 0) {
			return { line: line - 1, ch: prevLineLength };
		} else {
			// Single-line document with only a link — best effort
			return { line: line, ch: linkEnd };
		}
	}

	if (preferRight) {
		if (linkEnd < lineLength) {
			return { line: line, ch: linkEnd + 1 };
		}
		return { line: line, ch: linkStart - 1 };
	}

	if (linkStart > 0) {
		return { line: line, ch: linkStart - 1 };
	}
	return { line: line, ch: linkEnd + 1 };
}

// ──────────────────────────────────────────────────────────────────────────────
// Skip over link positioning
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Parameters for computing the cursor position to skip over a link.
 */
export interface SkipCursorParams {
	/** Character offset where the link starts on its line */
	linkStart: number;
	/** Character offset where the link ends */
	linkEnd: number;
	/** Current cursor position within the link */
	cursorPos: number;
	/** Length of the line */
	lineLength: number;
	/** Line number the link is on */
	line: number;
	/** Total number of lines in the document */
	lineCount: number;
	/** Length of the previous line (used when link is at start of line) */
	prevLineLength: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// Skip Link command positioning
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Parameters for computing the cursor position for the "Skip Link" command.
 */
export interface SkipLinkParams {
	/** Character offset where the full link starts (including syntax) */
	linkStart: number;
	/** Character offset where the full link ends */
	linkEnd: number;
	/** Character offset where the displayed text starts (after leading syntax) */
	displayedTextStart: number;
	/** Character offset where the displayed text ends (before trailing syntax) */
	displayedTextEnd: number;
	/** Current cursor position */
	cursorPos: number;
	/** Length of the line */
	lineLength: number;
	/** Line number the link is on */
	line: number;
	/** Total number of lines in the document */
	lineCount: number;
	/** Length of the previous line */
	prevLineLength: number;
	/** Whether in source mode (true) or live preview (false) */
	isSourceMode: boolean;
	/** Whether "keep links steady" setting is enabled */
	keepLinksSteady: boolean;
}

/**
 * Compute the cursor position for the "Skip Link" command.
 *
 * Skips to the opposite edge of the link based on which edge the cursor is nearest to.
 * Target position depends on mode:
 * - Source mode: Just outside the link syntax
 * - Preview + keepLinksSteady OFF: Just outside the link (won't trigger link)
 * - Preview + keepLinksSteady ON: At the edge of displayed text (cursor correction handles the rest)
 *
 * @param params All the information needed to compute the position
 * @returns `{ line, ch }` cursor position, or null if cursor is not in a link
 */
export function computeSkipLinkPosition(params: SkipLinkParams): { line: number; ch: number } | null {
	const {
		linkStart,
		linkEnd,
		displayedTextStart,
		displayedTextEnd,
		cursorPos,
		lineLength,
		line,
		lineCount,
		prevLineLength,
		isSourceMode,
		keepLinksSteady
	} = params;

	// Check if cursor is within the link (including edges)
	if (cursorPos < linkStart || cursorPos > linkEnd) {
		return null;
	}

	// Determine which edge the cursor is nearest to
	const distToLeftEdge = cursorPos - linkStart;
	const distToRightEdge = linkEnd - cursorPos;
	const isNearerLeftEdge = distToLeftEdge <= distToRightEdge;

	// For source mode or preview with keepLinksSteady OFF: skip just outside the link
	if (isSourceMode || !keepLinksSteady) {
		return computeSkipOutsideLink({
			linkStart,
			linkEnd,
			cursorPos,
			lineLength,
			line,
			lineCount,
			prevLineLength,
			skipRight: isNearerLeftEdge
		});
	}

	// For preview with keepLinksSteady ON: skip to the edge of displayed text
	// The cursor correction in linkSyntaxHider will then move the cursor outside
	if (isNearerLeftEdge) {
		// Skip right: position at the end of displayed text (start of trailing hidden syntax)
		// Cursor correction will move it outside the link
		return { line, ch: displayedTextEnd };
	} else {
		// Skip left: position at the start of displayed text (end of leading hidden syntax)
		// Cursor correction will move it outside the link
		return { line, ch: displayedTextStart };
	}
}

/**
 * Compute position just outside the link (for source mode or keepLinksSteady OFF).
 */
function computeSkipOutsideLink(params: {
	linkStart: number;
	linkEnd: number;
	cursorPos: number;
	lineLength: number;
	line: number;
	lineCount: number;
	prevLineLength: number;
	skipRight: boolean;
}): { line: number; ch: number } {
	const { linkStart, linkEnd, lineLength, line, lineCount, prevLineLength, skipRight } = params;

	// Check if link spans the entire line
	if (linkStart === 0 && linkEnd >= lineLength) {
		if (skipRight) {
			// Skip right → go to next line
			if (line + 1 < lineCount) {
				return { line: line + 1, ch: 0 };
			}
			// Last line, go to previous line
			if (line > 0) {
				return { line: line - 1, ch: prevLineLength };
			}
			return { line, ch: linkEnd };
		} else {
			// Skip left → go to previous line
			if (line > 0) {
				return { line: line - 1, ch: prevLineLength };
			}
			// First line, go to next line
			if (line + 1 < lineCount) {
				return { line: line + 1, ch: 0 };
			}
			return { line, ch: 0 };
		}
	}

	if (skipRight) {
		// Skip to the right - position just after the link
		if (linkEnd < lineLength) {
			return { line, ch: linkEnd + 1 };
		}
		// Link is at end of line — move to next line
		if (line + 1 < lineCount) {
			return { line: line + 1, ch: 0 };
		}
		// Last line, fall back to left side
		if (linkStart > 0) {
			return { line, ch: linkStart - 1 };
		}
		return { line, ch: linkEnd };
	} else {
		// Skip to the left - position just before the link
		if (linkStart > 0) {
			return { line, ch: linkStart - 1 };
		}
		// Link is at start of line — move to previous line
		if (line > 0) {
			return { line: line - 1, ch: prevLineLength };
		}
		// First line, fall back to right side
		if (linkEnd < lineLength) {
			return { line, ch: linkEnd + 1 };
		}
		return { line, ch: 0 };
	}
}

/**
 * Compute the cursor position to skip over a link in the direction of travel.
 *
 * This is the opposite of computeCloseCursorPosition. Instead of positioning
 * the cursor to close/collapse the link, it skips to the end of the link in
 * the direction the cursor is approaching from.
 *
 * - If cursor is on the left edge or left half, skip to the right (after link)
 * - If cursor is on the right edge or right half, skip to the left (before link)
 * - Position far enough that the link will be closed (collapsed in live preview)
 *
 * When the link is at the start or end of a line, the cursor would land on
 * the link boundary, which Obsidian treats as "inside" the link. In these
 * cases, we move to an adjacent line instead — consistent with the behavior
 * of computeCloseCursorPosition.
 *
 * @param params  All the information needed to compute the position
 * @returns `{ line, ch }` cursor position that skips over the link
 */
export function computeSkipCursorPosition(params: SkipCursorParams): { line: number; ch: number } {
	const { linkStart, linkEnd, cursorPos, lineLength, line, lineCount, prevLineLength } = params;

	// Determine direction based on cursor position relative to link center
	const linkCenter = (linkStart + linkEnd) / 2;
	const isOnLeftSide = cursorPos <= linkCenter;

	// Link spans the entire line — no position on this line will close it
	if (linkStart === 0 && linkEnd >= lineLength) {
		if (isOnLeftSide) {
			// Skipping right → prefer next line
			if (line + 1 < lineCount) {
				return { line: line + 1, ch: 0 };
			} else if (line > 0) {
				return { line: line - 1, ch: prevLineLength };
			}
			return { line, ch: linkEnd }; // single-line doc, best effort
		} else {
			// Skipping left → prefer previous line
			if (line > 0) {
				return { line: line - 1, ch: prevLineLength };
			} else if (line + 1 < lineCount) {
				return { line: line + 1, ch: 0 };
			}
			return { line, ch: 0 }; // single-line doc, best effort
		}
	}

	if (isOnLeftSide) {
		// Skip to the right - position after the link
		if (linkEnd < lineLength) {
			// There's content after the link, position one character after it
			return { line, ch: linkEnd + 1 };
		}
		// Link is at end of line — move to next line to close it
		if (line + 1 < lineCount) {
			return { line: line + 1, ch: 0 };
		}
		// Last line, fall back to left side
		if (linkStart > 0) {
			return { line, ch: linkStart - 1 };
		}
		return { line, ch: linkEnd }; // best effort
	} else {
		// Skip to the left - position before the link
		if (linkStart > 0) {
			// There's content before the link, position one character before it
			return { line, ch: linkStart - 1 };
		}
		// Link is at start of line — move to previous line to close it
		if (line > 0) {
			return { line: line - 1, ch: prevLineLength };
		}
		// First line, fall back to right side
		if (linkEnd < lineLength) {
			return { line, ch: linkEnd + 1 };
		}
		return { line, ch: 0 }; // best effort
	}
}
