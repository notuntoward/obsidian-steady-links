import { describe, it, expect } from "vitest";
import { getCompletionText } from "../src/suggestionLogic";
import { SuggestionItem } from "../src/types";
import { TFile } from "obsidian";

describe("getCompletionText", () => {
	it("completes plain markdown files to their basename", () => {
		const item: SuggestionItem = {
			type: "file",
			basename: "MyNote",
			name: "MyNote.md",
			extension: "md",
		};
		expect(getCompletionText(item, "My")).toBe("MyNote");
	});

	it("completes plain attachment files to their full name", () => {
		const item: SuggestionItem = {
			type: "file",
			basename: "Document",
			name: "Document.pdf",
			extension: "pdf",
		};
		expect(getCompletionText(item, "Doc")).toBe("Document.pdf");
	});

	it("completes headings for current file", () => {
		const item: SuggestionItem = {
			type: "heading",
			heading: "Section 1",
		};
		expect(getCompletionText(item, "#Sec")).toBe("#Section 1");
	});

	it("completes headings for specific file", () => {
		const item: SuggestionItem = {
			type: "heading",
			heading: "Section 1",
		};
		expect(getCompletionText(item, "MyNote#Sec")).toBe("MyNote#Section 1");
	});

	it("completes blocks for current file", () => {
		const item: SuggestionItem = {
			type: "block",
			blockId: "abc123",
		};
		expect(getCompletionText(item, "#^ab")).toBe("#^abc123");
	});

	it("completes blocks for specific file with hash", () => {
		const item: SuggestionItem = {
			type: "block",
			blockId: "abc123",
		};
		expect(getCompletionText(item, "MyNote#^ab")).toBe("MyNote#^abc123");
	});

	it("completes blocks for specific file without hash", () => {
		const item: SuggestionItem = {
			type: "block",
			blockId: "abc123",
		};
		expect(getCompletionText(item, "MyNote^ab")).toBe("MyNote#^abc123");
	});

	it("completes aliases to the underlying note's basename", () => {
		const file = {
			basename: "RealNote",
			extension: "md",
		} as TFile;

		const item: SuggestionItem = {
			type: "alias",
			file: file,
			alias: "AliasOfNote",
		};
		expect(getCompletionText(item, "Alias")).toBe("RealNote");
	});
});
