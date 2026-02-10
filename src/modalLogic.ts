/**
 * Pure business logic extracted from LinkEditModal.
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
