import { TFile, Pos } from "obsidian";

/**
 * Represents a link (WikiLink or Markdown) with its meta-information.
 */
export interface LinkInfo {
	/** Display text of the link */
	text: string;
	/** Destination (file path, URL, heading reference, etc.) */
	destination: string;
	/** Whether this is a WikiLink ([[...]]) vs Markdown link ([...](...)) */
	isWiki: boolean;
	/** Whether this is an embed (![[...]]) vs regular link */
	isEmbed: boolean;
}

/**
 * Represents a suggestion item presented to the user during autocompletion.
 * Covers files, headings, block references, and note aliases.
 */
export interface SuggestionItem {
	type: "file" | "heading" | "block" | "alias";
	file?: TFile;
	heading?: string;
	level?: number;
	blockId?: string | null;
	blockText?: string;
	position?: any; // Position from cache (has start/end with line/col/offset)
	basename?: string;
	path?: string;
	name?: string;
	extension?: string;
	displayPath?: string; // Path to display in suggestions (without filename)
	alias?: string; // Note alias for completion
}

/**
 * Plugin settings - controls link behavior in live preview.
 */
export interface PluginSettings {
	/**
	 * When enabled, links remain collapsed as they are navigated through,
	 * showing only display text. Disabled by default for compatibility.
	 */
	keepLinksSteady: boolean;
	/**
	 * When enabled, adds a "Copy link to current note" item to the tab
	 * right-click menu.
	 */
	copyLinkToCurrentNoteInTabMenu: boolean;
	/**
	 * When enabled (and keepLinksSteady is also enabled), heading and block
	 * references without an alias (e.g. [[Note#Heading]], [[Note#^block-id]])
	 * hide the note path and "#"/"#^" marker, showing only the heading text
	 * or block ID — and keep showing only that, even with the cursor on the
	 * link. Off by default because stock Obsidian does not shorten these
	 * links itself. Useful for parity with third-party plugins (e.g. "Short
	 * Links") that shorten link display text only while the cursor is off
	 * the link, which otherwise makes the link visually change when the
	 * cursor enters it.
	 */
	shortenHeadingLinks: boolean;
}
