import { describe, it, expect, beforeEach } from "vitest";
import {
	getFiles,
	getFileAliases,
	getHeadingsInCurrentFile,
	getAllHeadings,
	getHeadingsInFile,
	findFile,
	getAllBlocksInFile,
	generateBlockId,
	addBlockIdToFile,
	getSuggestionItems,
} from "../src/suggestionLogic";
import { createTestApp, TFile } from "./__mocks__/obsidian";
import type { App } from "./__mocks__/obsidian";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tf(overrides: ConstructorParameters<typeof TFile>[0]): any {
	return new TFile(overrides);
}

// ============================================================================
// getFileAliases
// ============================================================================

describe("getFileAliases", () => {
	let app: App;

	beforeEach(() => {
		app = createTestApp();
	});

	it("returns empty array when no cache exists", () => {
		const file = tf({ path: "note.md" });
		expect(getFileAliases(file as any, app as any)).toEqual([]);
	});

	it("returns empty array when no frontmatter exists", () => {
		const file = tf({ path: "note.md" });
		app.metadataCache.setFileCache("note.md", {});
		expect(getFileAliases(file as any, app as any)).toEqual([]);
	});

	it("extracts single string alias", () => {
		const file = tf({ path: "note.md" });
		app.metadataCache.setFileCache("note.md", {
			frontmatter: { alias: "MyAlias" },
		});
		expect(getFileAliases(file as any, app as any)).toEqual(["MyAlias"]);
	});

	it("extracts array of aliases", () => {
		const file = tf({ path: "note.md" });
		app.metadataCache.setFileCache("note.md", {
			frontmatter: { alias: ["Alias1", "Alias2"] },
		});
		expect(getFileAliases(file as any, app as any)).toEqual(["Alias1", "Alias2"]);
	});

	it("extracts from aliases field (plural)", () => {
		const file = tf({ path: "note.md" });
		app.metadataCache.setFileCache("note.md", {
			frontmatter: { aliases: ["AliasA", "AliasB"] },
		});
		expect(getFileAliases(file as any, app as any)).toEqual(["AliasA", "AliasB"]);
	});

	it("extracts from both alias and aliases fields", () => {
		const file = tf({ path: "note.md" });
		app.metadataCache.setFileCache("note.md", {
			frontmatter: { alias: "Single", aliases: ["Plural1", "Plural2"] },
		});
		expect(getFileAliases(file as any, app as any)).toEqual(["Single", "Plural1", "Plural2"]);
	});

	it("filters out empty-string aliases", () => {
		const file = tf({ path: "note.md" });
		app.metadataCache.setFileCache("note.md", {
			frontmatter: { alias: ["Valid", ""] },
		});
		expect(getFileAliases(file as any, app as any)).toEqual(["Valid"]);
	});
});

// ============================================================================
// getFiles
// ============================================================================

describe("getFiles", () => {
	let app: App;

	beforeEach(() => {
		app = createTestApp();
	});

	it("returns empty array when vault is empty", () => {
		expect(getFiles("", app as any)).toEqual([]);
	});

	it("returns all md files when query is empty", () => {
		app.vault.addFile(tf({ path: "note1.md" }));
		app.vault.addFile(tf({ path: "note2.md" }));
		app.vault.addFile(tf({ path: "image.png" }));

		const results = getFiles("", app as any);
		expect(results).toHaveLength(3);
		expect(results.every((r) => r.type === "file")).toBe(true);
	});

	it("filters files by basename match", () => {
		app.vault.addFile(tf({ path: "MyNote.md" }));
		app.vault.addFile(tf({ path: "OtherNote.md" }));

		const results = getFiles("My", app as any);
		expect(results).toHaveLength(1);
		expect(results[0].basename).toBe("MyNote");
	});

	it("filters files by path match", () => {
		app.vault.addFile(tf({ path: "folder/sub/note.md" }));
		app.vault.addFile(tf({ path: "other/note.md" }));

		const results = getFiles("folder/sub", app as any);
		expect(results).toHaveLength(1);
		expect(results[0].path).toBe("folder/sub/note.md");
	});

	it("includes alias suggestions when query matches alias", () => {
		const file = tf({ path: "note.md" });
		app.vault.addFile(file);
		app.metadataCache.setFileCache("note.md", {
			frontmatter: { alias: "SpecialAlias" },
		});

		const results = getFiles("Special", app as any);
		expect(results).toHaveLength(1);
		expect(results[0].type).toBe("alias");
		expect(results[0].alias).toBe("SpecialAlias");
	});

	it("shows all aliases when file name matches", () => {
		const file = tf({ path: "note.md" });
		app.vault.addFile(file);
		app.metadataCache.setFileCache("note.md", {
			frontmatter: { alias: ["Alias1", "Alias2"] },
		});

		const results = getFiles("note", app as any);
		// 1 file + 2 aliases = 3 results
		expect(results).toHaveLength(3);
		expect(results.filter((r) => r.type === "alias")).toHaveLength(2);
	});

	it("does not show aliases when query is empty", () => {
		const file = tf({ path: "note.md" });
		app.vault.addFile(file);
		app.metadataCache.setFileCache("note.md", {
			frontmatter: { alias: "SomeAlias" },
		});

		const results = getFiles("", app as any);
		expect(results).toHaveLength(1);
		expect(results[0].type).toBe("file");
	});

	it("sets displayPath when file is in different folder than active file", () => {
		const activeFile = tf({ path: "folder1/active.md", parent: { path: "folder1" } });
		app.vault.addFile(activeFile);
		app.workspace.setActiveFile(activeFile);

		const otherFile = tf({ path: "folder2/other.md", parent: { path: "folder2" } });
		app.vault.addFile(otherFile);

		const results = getFiles("other", app as any);
		expect(results[0].displayPath).toBe("folder2/");
	});

	it("omits displayPath when file is in same folder as active file", () => {
		const activeFile = tf({ path: "folder/active.md", parent: { path: "folder" } });
		app.vault.addFile(activeFile);
		app.workspace.setActiveFile(activeFile);

		const sameFolderFile = tf({ path: "folder/other.md", parent: { path: "folder" } });
		app.vault.addFile(sameFolderFile);

		const results = getFiles("other", app as any);
		expect(results[0].displayPath).toBe("");
	});

	it("handles root folder files", () => {
		app.vault.addFile(tf({ path: "root-note.md" }));
		const results = getFiles("root", app as any);
		expect(results[0].displayPath).toBe("");
	});

	it("limits results to 20", () => {
		for (let i = 0; i < 25; i++) {
			app.vault.addFile(tf({ path: `note${i}.md` }));
		}
		const results = getFiles("", app as any);
		expect(results.length).toBeLessThanOrEqual(20);
	});

	it("sorts files before aliases", () => {
		const file = tf({ path: "note.md" });
		app.vault.addFile(file);
		app.metadataCache.setFileCache("note.md", {
			frontmatter: { alias: "noteAlias" },
		});

		const results = getFiles("note", app as any);
		const fileIdx = results.findIndex((r) => r.type === "file");
		const aliasIdx = results.findIndex((r) => r.type === "alias");
		expect(fileIdx).toBeLessThan(aliasIdx);
	});

	it("includes unresolved links", () => {
		(app.metadataCache as any).unresolvedLinks = {
			"source.md": { "UnresolvedNote.md": 1 },
		};

		const results = getFiles("Unresolved", app as any);
		expect(results.some((r) => r.path === "UnresolvedNote.md")).toBe(true);
	});

	it("deduplicates unresolved links already in results", () => {
		app.vault.addFile(tf({ path: "ExistingNote.md" }));
		(app.metadataCache as any).unresolvedLinks = {
			"source.md": { "ExistingNote.md": 1 },
		};

		const results = getFiles("ExistingNote", app as any);
		const paths = results.map((r) => r.path);
		expect(paths.filter((p) => p === "ExistingNote.md")).toHaveLength(1);
	});
});

// ============================================================================
// getHeadingsInCurrentFile
// ============================================================================

describe("getHeadingsInCurrentFile", () => {
	let app: App;

	beforeEach(() => {
		app = createTestApp();
	});

	it("returns empty array when no active file", () => {
		expect(getHeadingsInCurrentFile(app as any)).toEqual([]);
	});

	it("returns empty array when no cache", () => {
		const file = tf({ path: "note.md" });
		app.workspace.setActiveFile(file);
		expect(getHeadingsInCurrentFile(app as any)).toEqual([]);
	});

	it("returns empty array when no headings", () => {
		const file = tf({ path: "note.md" });
		app.workspace.setActiveFile(file);
		app.metadataCache.setFileCache("note.md", {});
		expect(getHeadingsInCurrentFile(app as any)).toEqual([]);
	});

	it("returns headings with correct structure", () => {
		const file = tf({ path: "note.md" });
		app.workspace.setActiveFile(file);
		app.metadataCache.setFileCache("note.md", {
			headings: [
				{ heading: "Introduction", level: 1, position: {} },
				{ heading: "Details", level: 2, position: {} },
			],
		});

		const results = getHeadingsInCurrentFile(app as any);
		expect(results).toHaveLength(2);
		expect(results[0].type).toBe("heading");
		expect(results[0].heading).toBe("Introduction");
		expect(results[0].level).toBe(1);
		expect(results[0].file).toBe(file);
	});
});

// ============================================================================
// getAllHeadings
// ============================================================================

describe("getAllHeadings", () => {
	let app: App;

	beforeEach(() => {
		app = createTestApp();
	});

	it("returns empty array when no files", () => {
		expect(getAllHeadings(app as any)).toEqual([]);
	});

	it("returns headings from all md files", () => {
		const file1 = tf({ path: "note1.md" });
		const file2 = tf({ path: "note2.md" });
		app.vault.addFile(file1);
		app.vault.addFile(file2);

		app.metadataCache.setFileCache("note1.md", {
			headings: [{ heading: "H1", level: 1, position: {} }],
		});
		app.metadataCache.setFileCache("note2.md", {
			headings: [{ heading: "H2", level: 2, position: {} }],
		});

		const results = getAllHeadings(app as any);
		expect(results).toHaveLength(2);
		expect(results.map((r) => r.heading)).toEqual(["H1", "H2"]);
	});

	it("skips files without cached headings", () => {
		const file1 = tf({ path: "note1.md" });
		app.vault.addFile(file1);
		// No cache set

		const results = getAllHeadings(app as any);
		expect(results).toEqual([]);
	});

	it("limits results to 50", () => {
		const file = tf({ path: "note.md" });
		app.vault.addFile(file);
		const headings = Array.from({ length: 60 }, (_, i) => ({
			heading: `H${i}`,
			level: 1,
			position: {},
		}));
		app.metadataCache.setFileCache("note.md", { headings });

		const results = getAllHeadings(app as any);
		expect(results.length).toBeLessThanOrEqual(50);
	});
});

// ============================================================================
// getHeadingsInFile
// ============================================================================

describe("getHeadingsInFile", () => {
	let app: App;

	beforeEach(() => {
		app = createTestApp();
	});

	it("returns empty array when file not found", () => {
		expect(getHeadingsInFile("nonexistent", app as any)).toEqual([]);
	});

	it("returns headings for found file", () => {
		const file = tf({ path: "folder/mynote.md" });
		app.vault.addFile(file);
		app.metadataCache.setFileCache("folder/mynote.md", {
			headings: [
				{ heading: "Section A", level: 1, position: {} },
				{ heading: "Section B", level: 2, position: {} },
			],
		});

		const results = getHeadingsInFile("mynote", app as any);
		expect(results).toHaveLength(2);
		expect(results[0].heading).toBe("Section A");
	});

	it("filters headings by query", () => {
		const file = tf({ path: "mynote.md" });
		app.vault.addFile(file);
		app.metadataCache.setFileCache("mynote.md", {
			headings: [
				{ heading: "Introduction", level: 1, position: {} },
				{ heading: "Conclusion", level: 1, position: {} },
			],
		});

		const results = getHeadingsInFile("mynote", app as any, "Intro");
		expect(results).toHaveLength(1);
		expect(results[0].heading).toBe("Introduction");
	});

	it("returns all headings when query is empty", () => {
		const file = tf({ path: "mynote.md" });
		app.vault.addFile(file);
		app.metadataCache.setFileCache("mynote.md", {
			headings: [
				{ heading: "H1", level: 1, position: {} },
				{ heading: "H2", level: 1, position: {} },
			],
		});

		const results = getHeadingsInFile("mynote", app as any, "");
		expect(results).toHaveLength(2);
	});
});

// ============================================================================
// findFile
// ============================================================================

describe("findFile", () => {
	let app: App;

	beforeEach(() => {
		app = createTestApp();
	});

	it("returns undefined for empty fileName", () => {
		expect(findFile("", app as any)).toBeUndefined();
	});

	it("finds file by basename", () => {
		const file = tf({ path: "folder/mynote.md" });
		app.vault.addFile(file);
		expect(findFile("mynote", app as any)).toBe(file);
	});

	it("finds file by path substring", () => {
		const file = tf({ path: "folder/sub/note.md" });
		app.vault.addFile(file);
		expect(findFile("folder/sub", app as any)).toBe(file);
	});

	it("returns undefined when file not found", () => {
		app.vault.addFile(tf({ path: "note.md" }));
		expect(findFile("nonexistent", app as any)).toBeUndefined();
	});

	it("prefers exact basename match over path match", () => {
		const exact = tf({ path: "note.md" });
		const partial = tf({ path: "folder/note-backup.md" });
		app.vault.addFile(partial);
		app.vault.addFile(exact);
		expect(findFile("note", app as any)).toBe(exact);
	});
});

// ============================================================================
// getAllBlocksInFile
// ============================================================================

describe("getAllBlocksInFile", () => {
	let app: App;

	beforeEach(() => {
		app = createTestApp();
	});

	it("returns empty array when no cache", async () => {
		const file = tf({ path: "note.md" });
		const results = await getAllBlocksInFile(file, app as any);
		expect(results).toEqual([]);
	});

	it("returns empty array when no sections", async () => {
		const file = tf({ path: "note.md" });
		app.metadataCache.setFileCache("note.md", {});
		const results = await getAllBlocksInFile(file, app as any);
		expect(results).toEqual([]);
	});

	it("extracts blocks with block IDs", async () => {
		const file = tf({ path: "note.md" });
		app.vault.addFile(file, "Paragraph text ^abc123");
		app.metadataCache.setFileCache("note.md", {
			sections: [
				{
					type: "paragraph",
					position: {
						start: { line: 0, col: 0, offset: 0 },
						end: { line: 0, col: 21, offset: 21 },
					},
				},
			],
		});

		const results = await getAllBlocksInFile(file, app as any);
		expect(results).toHaveLength(1);
		expect(results[0].type).toBe("block");
		expect(results[0].blockId).toBe("abc123");
		expect(results[0].blockText).toBe("Paragraph text");
	});

	it("extracts blocks without block IDs", async () => {
		const file = tf({ path: "note.md" });
		app.vault.addFile(file, "Plain paragraph");
		app.metadataCache.setFileCache("note.md", {
			sections: [
				{
					type: "paragraph",
					position: {
						start: { line: 0, col: 0, offset: 0 },
						end: { line: 0, col: 15, offset: 15 },
					},
				},
			],
		});

		const results = await getAllBlocksInFile(file, app as any);
		expect(results).toHaveLength(1);
		expect(results[0].blockId).toBeNull();
		expect(results[0].blockText).toBe("Plain paragraph");
	});

	it("filters blocks by query matching block text", async () => {
		const file = tf({ path: "note.md" });
		app.vault.addFile(file, "First paragraph\n\nSecond paragraph");
		app.metadataCache.setFileCache("note.md", {
			sections: [
				{
					type: "paragraph",
					position: {
						start: { line: 0, col: 0, offset: 0 },
						end: { line: 0, col: 16, offset: 16 },
					},
				},
				{
					type: "paragraph",
					position: {
						start: { line: 2, col: 0, offset: 18 },
						end: { line: 2, col: 17, offset: 35 },
					},
				},
			],
		});

		const results = await getAllBlocksInFile(file, app as any, "Second");
		expect(results).toHaveLength(1);
		expect(results[0].blockText).toBe("Second paragraph");
	});

	it("filters blocks by query matching block ID", async () => {
		const file = tf({ path: "note.md" });
		app.vault.addFile(file, "Paragraph ^abc123\n\nOther ^def456");
		app.metadataCache.setFileCache("note.md", {
			sections: [
				{
					type: "paragraph",
					position: {
						start: { line: 0, col: 0, offset: 0 },
						end: { line: 0, col: 17, offset: 17 },
					},
				},
				{
					type: "paragraph",
					position: {
						start: { line: 2, col: 0, offset: 19 },
						end: { line: 2, col: 13, offset: 32 },
					},
				},
			],
		});

		const results = await getAllBlocksInFile(file, app as any, "def456");
		expect(results).toHaveLength(1);
		expect(results[0].blockId).toBe("def456");
	});

	it("handles list sections", async () => {
		const file = tf({ path: "note.md" });
		app.vault.addFile(file, "- Item 1\n- Item 2 ^listblock");
		app.metadataCache.setFileCache("note.md", {
			sections: [
				{
					type: "list",
					position: {
						start: { line: 0, col: 0, offset: 0 },
						end: { line: 1, col: 16, offset: 28 },
					},
				},
			],
		});

		const results = await getAllBlocksInFile(file, app as any);
		expect(results).toHaveLength(1);
		expect(results[0].blockId).toBe("listblock");
	});

	it("handles code sections", async () => {
		const file = tf({ path: "note.md" });
		app.vault.addFile(file, "```\ncode block\n``` ^codeid");
		app.metadataCache.setFileCache("note.md", {
			sections: [
				{
					type: "code",
					position: {
						start: { line: 0, col: 0, offset: 0 },
						end: { line: 2, col: 11, offset: 26 },
					},
				},
			],
		});

		const results = await getAllBlocksInFile(file, app as any);
		expect(results).toHaveLength(1);
		expect(results[0].blockId).toBe("codeid");
	});

	it("skips non-block section types", async () => {
		const file = tf({ path: "note.md" });
		app.vault.addFile(file, "# Heading");
		app.metadataCache.setFileCache("note.md", {
			sections: [
				{
					type: "heading",
					position: {
						start: { line: 0, col: 0, offset: 0 },
						end: { line: 0, col: 9, offset: 9 },
					},
				},
			],
		});

		const results = await getAllBlocksInFile(file, app as any);
		expect(results).toEqual([]);
	});
});

// ============================================================================
// generateBlockId
// ============================================================================

describe("generateBlockId", () => {
	it("returns a 6-character string", () => {
		expect(generateBlockId()).toHaveLength(6);
	});

	it("returns only alphanumeric characters", () => {
		for (let i = 0; i < 20; i++) {
			const id = generateBlockId();
			expect(id).toMatch(/^[a-z0-9]+$/);
		}
	});

	it("generates unique IDs", () => {
		const ids = new Set(Array.from({ length: 100 }, () => generateBlockId()));
		expect(ids.size).toBe(100);
	});
});

// ============================================================================
// addBlockIdToFile
// ============================================================================

describe("addBlockIdToFile", () => {
	let app: App;

	beforeEach(() => {
		app = createTestApp();
	});

	it("appends block ID to the end line", async () => {
		const file = tf({ path: "note.md" });
		app.vault.addFile(file, "Line 1\nLine 2\nLine 3");

		await addBlockIdToFile(
			file,
			app as any,
			{ start: { line: 1, col: 0, offset: 7 }, end: { line: 1, col: 6, offset: 13 } },
			"abc123"
		);

		const content = app.vault.getFileContent("note.md");
		expect(content).toBe("Line 1\nLine 2 ^abc123\nLine 3");
	});

	it("trims trailing whitespace before appending", async () => {
		const file = tf({ path: "note.md" });
		app.vault.addFile(file, "Line 1   \nLine 2");

		await addBlockIdToFile(
			file,
			app as any,
			{ start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: 9, offset: 9 } },
			"xyz789"
		);

		const content = app.vault.getFileContent("note.md");
		expect(content).toBe("Line 1 ^xyz789\nLine 2");
	});
});

// ============================================================================
// getSuggestionItems
// ============================================================================

describe("getSuggestionItems", () => {
	let app: App;

	beforeEach(() => {
		app = createTestApp();
	});

	it("returns empty array for URLs", async () => {
		const results = await getSuggestionItems("https://example.com", app as any, true);
		expect(results).toEqual([]);
	});

	it("returns files for non-wiki mode", async () => {
		app.vault.addFile(tf({ path: "note.md" }));
		const results = await getSuggestionItems("note", app as any, false);
		expect(results).toHaveLength(1);
		expect(results[0].type).toBe("file");
	});

	it("routes global heading query", async () => {
		const file = tf({ path: "note.md" });
		app.vault.addFile(file);
		app.metadataCache.setFileCache("note.md", {
			headings: [{ heading: "Intro", level: 1, position: {} }],
		});

		const results = await getSuggestionItems("##Intro", app as any, true);
		expect(results).toHaveLength(1);
		expect(results[0].type).toBe("heading");
	});

	it("routes current block query", async () => {
		const file = tf({ path: "note.md" });
		app.vault.addFile(file, "Text ^block1");
		app.workspace.setActiveFile(file);
		app.metadataCache.setFileCache("note.md", {
			sections: [
				{
					type: "paragraph",
					position: {
						start: { line: 0, col: 0, offset: 0 },
						end: { line: 0, col: 12, offset: 12 },
					},
				},
			],
		});

		const results = await getSuggestionItems("#^block1", app as any, true);
		expect(results).toHaveLength(1);
		expect(results[0].type).toBe("block");
	});

	it("routes current heading query", async () => {
		const file = tf({ path: "note.md" });
		app.vault.addFile(file);
		app.workspace.setActiveFile(file);
		app.metadataCache.setFileCache("note.md", {
			headings: [{ heading: "MyHeading", level: 1, position: {} }],
		});

		const results = await getSuggestionItems("#MyHeading", app as any, true);
		expect(results).toHaveLength(1);
		expect(results[0].type).toBe("heading");
	});

	it("routes file block query", async () => {
		const file = tf({ path: "mynote.md" });
		app.vault.addFile(file, "Text ^block1");
		app.metadataCache.setFileCache("mynote.md", {
			sections: [
				{
					type: "paragraph",
					position: {
						start: { line: 0, col: 0, offset: 0 },
						end: { line: 0, col: 12, offset: 12 },
					},
				},
			],
		});

		const results = await getSuggestionItems("mynote#^block1", app as any, true);
		expect(results).toHaveLength(1);
		expect(results[0].type).toBe("block");
	});

	it("routes file heading query", async () => {
		const file = tf({ path: "mynote.md" });
		app.vault.addFile(file);
		app.metadataCache.setFileCache("mynote.md", {
			headings: [{ heading: "Section", level: 1, position: {} }],
		});

		const results = await getSuggestionItems("mynote#Section", app as any, true);
		expect(results).toHaveLength(1);
		expect(results[0].type).toBe("heading");
	});

	it("routes file query", async () => {
		app.vault.addFile(tf({ path: "mynote.md" }));
		const results = await getSuggestionItems("mynote", app as any, true);
		expect(results).toHaveLength(1);
		expect(results[0].type).toBe("file");
	});

	it("returns empty for block query when no active file", async () => {
		const results = await getSuggestionItems("#^block", app as any, true);
		expect(results).toEqual([]);
	});

	it("returns empty for file block query when file not found", async () => {
		const results = await getSuggestionItems("nonexistent#^block", app as any, true);
		expect(results).toEqual([]);
	});
});
