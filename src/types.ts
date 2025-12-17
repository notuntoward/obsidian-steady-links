import { TFile, Pos } from "obsidian";

export interface LinkInfo {
	text: string;
	destination: string;
	isWiki: boolean;
	isEmbed: boolean;
}

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

export interface PluginSettings {
	alwaysMoveToEnd: boolean;
}
