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
}
