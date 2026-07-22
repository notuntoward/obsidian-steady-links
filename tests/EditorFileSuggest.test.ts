// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EditorFileSuggest } from "../src/EditorFileSuggest";
import { SuggestionItem } from "../src/types";
import { App, TFile, Editor } from "./__mocks__/obsidian";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tf(overrides: ConstructorParameters<typeof TFile>[0]): any {
	return new TFile(overrides);
}

// ============================================================================
// Stub plugin
// ============================================================================

function makePlugin(keepLinksSteady = true) {
	return { settings: { keepLinksSteady } } as any;
}

function makeSuggest(app: App, plugin = makePlugin()) {
	return new EditorFileSuggest(app as any, plugin);
}

// ============================================================================
// onTrigger
// ============================================================================

describe("EditorFileSuggest.onTrigger", () => {
	let app: App;
	let editor: Editor;
	let file: TFile;

	beforeEach(() => {
		app = new App();
		editor = new Editor();
		file = tf({ path: "note.md" });
	});

	it("returns null when keepLinksSteady is disabled", () => {
		const suggest = makeSuggest(app, makePlugin(false));
		editor.setLines(["[[link"]);
		const result = suggest.onTrigger({ line: 0, ch: 6 }, editor as any, file as any);
		expect(result).toBeNull();
	});

	it("returns null when no [[ on the line", () => {
		const suggest = makeSuggest(app);
		editor.setLines(["no link here"]);
		const result = suggest.onTrigger({ line: 0, ch: 5 }, editor as any, file as any);
		expect(result).toBeNull();
	});

	it("returns null when [[ is closed before cursor", () => {
		const suggest = makeSuggest(app);
		editor.setLines(["[[link]] more"]);
		const result = suggest.onTrigger({ line: 0, ch: 10 }, editor as any, file as any);
		expect(result).toBeNull();
	});

	it("triggers on open [[ before cursor", () => {
		const suggest = makeSuggest(app);
		editor.setLines(["[[mynote"]);
		const result = suggest.onTrigger({ line: 0, ch: 8 }, editor as any, file as any);
		expect(result).not.toBeNull();
		expect(result!.start).toEqual({ line: 0, ch: 2 });
		expect(result!.end).toEqual({ line: 0, ch: 8 });
		expect(result!.query).toBe("mynote");
	});

	it("triggers with empty query right after [[", () => {
		const suggest = makeSuggest(app);
		editor.setLines(["[["]);
		const result = suggest.onTrigger({ line: 0, ch: 2 }, editor as any, file as any);
		expect(result).not.toBeNull();
		expect(result!.query).toBe("");
	});

	it("uses the last [[ when multiple exist", () => {
		const suggest = makeSuggest(app);
		editor.setLines(["[[a]] [[b"]);
		const result = suggest.onTrigger({ line: 0, ch: 9 }, editor as any, file as any);
		expect(result).not.toBeNull();
		expect(result!.start.ch).toBe(8);
		expect(result!.query).toBe("b");
	});

	it("triggers mid-word inside [[", () => {
		const suggest = makeSuggest(app);
		editor.setLines(["[[mynote]]"]);
		const result = suggest.onTrigger({ line: 0, ch: 5 }, editor as any, file as any);
		expect(result).not.toBeNull();
		expect(result!.query).toBe("myn");
	});

	it("does not trigger when cursor is before [[", () => {
		const suggest = makeSuggest(app);
		editor.setLines(["text [[link"]);
		const result = suggest.onTrigger({ line: 0, ch: 3 }, editor as any, file as any);
		expect(result).toBeNull();
	});
});

// ============================================================================
// selectSuggestion — file items
// ============================================================================

describe("EditorFileSuggest.selectSuggestion — file items", () => {
	let app: App;
	let editor: Editor;
	let file: TFile;
	let suggest: EditorFileSuggest;

	beforeEach(() => {
		app = new App();
		editor = new Editor();
		file = tf({ path: "note.md" });
		suggest = makeSuggest(app);
	});

	function setContext(query: string, startCh: number, endCh: number, line = 0) {
		(suggest as any).context = {
			editor: editor as any,
			file,
			start: { line, ch: startCh },
			end: { line, ch: endCh },
			query,
		};
	}

	it("inserts [[basename]] for md file", async () => {
		editor.setLines(["[[myn"]);
		setContext("myn", 2, 5);

		const targetFile = tf({ path: "mynote.md" });
		const item: SuggestionItem = {
			type: "file",
			file: targetFile as any,
			basename: "mynote",
			name: "mynote.md",
			extension: "md",
		};

		await suggest.selectSuggestion(item, {} as any);
		expect(editor.getLine(0)).toBe("[[mynote]]");
	});

	it("inserts [[name]] for non-md file", async () => {
		editor.setLines(["[[img"]);
		setContext("img", 2, 5);

		const targetFile = tf({ path: "image.png" });
		const item: SuggestionItem = {
			type: "file",
			file: targetFile as any,
			basename: "image",
			name: "image.png",
			extension: "png",
		};

		await suggest.selectSuggestion(item, {} as any);
		expect(editor.getLine(0)).toBe("[[image.png]]");
	});

	it("places cursor after the closing ]] for plain file", async () => {
		editor.setLines(["[[myn"]);
		setContext("myn", 2, 5);

		const targetFile = tf({ path: "mynote.md" });
		const item: SuggestionItem = {
			type: "file",
			file: targetFile as any,
			basename: "mynote",
			name: "mynote.md",
			extension: "md",
		};

		await suggest.selectSuggestion(item, {} as any);
		const cursor = editor.getCursor();
		expect(cursor.ch).toBe("[[mynote]]".length);
	});

	it("consumes auto-paired ]] after cursor", async () => {
		editor.setLines(["[[myn]]"]);
		setContext("myn", 2, 5);

		const targetFile = tf({ path: "mynote.md" });
		const item: SuggestionItem = {
			type: "file",
			file: targetFile as any,
			basename: "mynote",
			name: "mynote.md",
			extension: "md",
		};

		await suggest.selectSuggestion(item, {} as any);
		expect(editor.getLine(0)).toBe("[[mynote]]");
	});
});

// ============================================================================
// selectSuggestion — alias items
// ============================================================================

describe("EditorFileSuggest.selectSuggestion — alias items", () => {
	let app: App;
	let editor: Editor;
	let file: TFile;
	let suggest: EditorFileSuggest;

	beforeEach(() => {
		app = new App();
		editor = new Editor();
		file = tf({ path: "note.md" });
		suggest = makeSuggest(app);
	});

	function setContext(query: string, startCh: number, endCh: number, line = 0) {
		(suggest as any).context = {
			editor: editor as any,
			file,
			start: { line, ch: startCh },
			end: { line, ch: endCh },
			query,
		};
	}

	it("inserts [[basename|alias]] for md file alias", async () => {
		editor.setLines(["[[myn"]);
		setContext("myn", 2, 5);

		const targetFile = tf({ path: "mynote.md" });
		const item: SuggestionItem = {
			type: "alias",
			file: targetFile as any,
			alias: "My Alias",
			basename: "mynote",
			name: "mynote.md",
			extension: "md",
		};

		await suggest.selectSuggestion(item, {} as any);
		expect(editor.getLine(0)).toBe("[[mynote|My Alias]]");
	});

	it("inserts [[name|alias]] for non-md file alias", async () => {
		editor.setLines(["[[img"]);
		setContext("img", 2, 5);

		const targetFile = tf({ path: "image.png" });
		const item: SuggestionItem = {
			type: "alias",
			file: targetFile as any,
			alias: "Pretty Image",
			basename: "image",
			name: "image.png",
			extension: "png",
		};

		await suggest.selectSuggestion(item, {} as any);
		expect(editor.getLine(0)).toBe("[[image.png|Pretty Image]]");
	});

	it("selects the alias text after insertion", async () => {
		editor.setLines(["[[myn"]);
		setContext("myn", 2, 5);

		const targetFile = tf({ path: "mynote.md" });
		const item: SuggestionItem = {
			type: "alias",
			file: targetFile as any,
			alias: "My Alias",
			basename: "mynote",
			name: "mynote.md",
			extension: "md",
		};

		await suggest.selectSuggestion(item, {} as any);
		const sel = editor.getState().selection;
		expect(sel).not.toBeNull();
		// Selection should cover "My Alias" inside [[mynote|My Alias]]
		const inserted = editor.getLine(0);
		const aliasStart = inserted.indexOf("My Alias");
		expect(sel!.from.ch).toBe(aliasStart);
		expect(sel!.to.ch).toBe(aliasStart + "My Alias".length);
	});

	it("handles alias without file (falls back to alias string)", async () => {
		editor.setLines(["[[myn"]);
		setContext("myn", 2, 5);

		const item: SuggestionItem = {
			type: "alias",
			alias: "Lone Alias",
		};

		await suggest.selectSuggestion(item, {} as any);
		expect(editor.getLine(0)).toBe("[[Lone Alias|Lone Alias]]");
	});
});

// ============================================================================
// selectSuggestion — heading items
// ============================================================================

describe("EditorFileSuggest.selectSuggestion — heading items", () => {
	let app: App;
	let editor: Editor;
	let file: TFile;
	let suggest: EditorFileSuggest;

	beforeEach(() => {
		app = new App();
		editor = new Editor();
		file = tf({ path: "current.md" });
		suggest = makeSuggest(app);
		app.workspace.setActiveFile(file);
	});

	function setContext(query: string, startCh: number, endCh: number, line = 0) {
		(suggest as any).context = {
			editor: editor as any,
			file,
			start: { line, ch: startCh },
			end: { line, ch: endCh },
			query,
		};
	}

	it("inserts [[#heading]] for heading in current file", async () => {
		editor.setLines(["[[#Intro"]);
		setContext("#Intro", 2, 8);

		const item: SuggestionItem = {
			type: "heading",
			heading: "Introduction",
			level: 1,
			file: file as any, // same as active file
		};

		await suggest.selectSuggestion(item, {} as any);
		expect(editor.getLine(0)).toBe("[[#Introduction]]");
	});

	it("inserts [[file#heading]] for heading in other file", async () => {
		editor.setLines(["[[other#Intro"]);
		setContext("other#Intro", 2, 13);

		const otherFile = tf({ path: "other.md" });
		const item: SuggestionItem = {
			type: "heading",
			heading: "Introduction",
			level: 1,
			file: otherFile as any,
		};

		await suggest.selectSuggestion(item, {} as any);
		expect(editor.getLine(0)).toBe("[[other#Introduction]]");
	});

	it("inserts [[#heading]] when item has no file", async () => {
		editor.setLines(["[[#Intro"]);
		setContext("#Intro", 2, 8);

		const item: SuggestionItem = {
			type: "heading",
			heading: "Introduction",
			level: 1,
		};

		await suggest.selectSuggestion(item, {} as any);
		expect(editor.getLine(0)).toBe("[[#Introduction]]");
	});
});

// ============================================================================
// selectSuggestion — block items
// ============================================================================

describe("EditorFileSuggest.selectSuggestion — block items", () => {
	let app: App;
	let editor: Editor;
	let file: TFile;
	let suggest: EditorFileSuggest;

	beforeEach(() => {
		app = new App();
		editor = new Editor();
		file = tf({ path: "current.md" });
		suggest = makeSuggest(app);
		app.workspace.setActiveFile(file);
	});

	function setContext(query: string, startCh: number, endCh: number, line = 0) {
		(suggest as any).context = {
			editor: editor as any,
			file,
			start: { line, ch: startCh },
			end: { line, ch: endCh },
			query,
		};
	}

	it("inserts [[#^blockId]] for block in current file", async () => {
		editor.setLines(["[[#^abc"]);
		setContext("#^abc", 2, 7);

		const item: SuggestionItem = {
			type: "block",
			blockId: "abc123",
			blockText: "Some text",
			file: file as any,
		};

		await suggest.selectSuggestion(item, {} as any);
		expect(editor.getLine(0)).toBe("[[#^abc123]]");
	});

	it("inserts [[file#^blockId]] for block in other file", async () => {
		editor.setLines(["[[other#^abc"]);
		setContext("other#^abc", 2, 12);

		const otherFile = tf({ path: "other.md" });
		const item: SuggestionItem = {
			type: "block",
			blockId: "abc123",
			blockText: "Some text",
			file: otherFile as any,
		};

		await suggest.selectSuggestion(item, {} as any);
		expect(editor.getLine(0)).toBe("[[other#^abc123]]");
	});

	it("generates and inserts new block ID when item has none", async () => {
		editor.setLines(["[[#^new"]);
		setContext("#^new", 2, 7);

		const item: SuggestionItem = {
			type: "block",
			blockId: null,
			blockText: "New block",
			file: file as any,
			position: {
				start: { line: 0, col: 0, offset: 0 },
				end: { line: 0, col: 9, offset: 9 },
			},
		};

		// Mock addBlockIdToFile by spying on the module
		const origContent = "New block";
		app.vault.addFile(file, origContent);

		await suggest.selectSuggestion(item, {} as any);
		// The block ID should have been generated and inserted
		const line = editor.getLine(0);
		expect(line).toMatch(/^\[\[#\^[a-z0-9]{6}\]\]$/);
	});
});

// ============================================================================
// getSuggestions
// ============================================================================

describe("EditorFileSuggest.getSuggestions", () => {
	it("delegates to getSuggestionItems with isWiki=true", async () => {
		const app = new App();
		app.vault.addFile(tf({ path: "note.md" }));
		const suggest = makeSuggest(app);

		const context = {
			editor: new Editor() as any,
			file: tf({ path: "note.md" }) as any,
			start: { line: 0, ch: 2 },
			end: { line: 0, ch: 6 },
			query: "note",
		};

		const results = await suggest.getSuggestions(context as any);
		expect(results.some((r) => r.type === "file")).toBe(true);
	});
});
