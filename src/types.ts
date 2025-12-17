import { TFile, Pos } from "obsidian";

export interface LinkInfo {
	text: string;
	destination: string;
	isWiki: boolean;
}

export interface SuggestionItem {
	type: "file" | "heading" | "block";
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
}

export interface PluginSettings {
	alwaysMoveToEnd: boolean;
}
