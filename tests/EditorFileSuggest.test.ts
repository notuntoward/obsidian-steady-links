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

	it("applies the full link insertion and the resulting cursor atomically via editor.transaction", async () => {
		// Regression guard: buildFullLinkReplacement (shared by
		// selectSuggestion and createUnresolvedLink) must set the change and
		// the resulting selection in one editor.transaction() call. A
		// separate, later setCursor()/setSelection() call risks the same
		// cursor-corrector interference documented on completeSelection's
		// equivalent guard test, even though today's plain-file target
		// position happens to land outside any hidden syntax range.
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

		const transactionSpy = vi.spyOn(editor, "transaction");

		await suggest.selectSuggestion(item, {} as any);

		expect(transactionSpy).toHaveBeenCalledTimes(1);
		expect(transactionSpy).toHaveBeenCalledWith({
			changes: [{ from: { line: 0, ch: 0 }, to: { line: 0, ch: 5 }, text: "[[mynote]]" }],
			selection: { from: { line: 0, ch: "[[mynote]]".length } },
		});
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

	it("inserts [[Note-09|a_note_alias]] when selecting alias suggestion", async () => {
		editor.setLines(["[[Note-09|a_note_alias"]);
		setContext("Note-09|a_note_alias", 2, 22);

		const noteFile = tf({ path: "Note-09.md" });
		const item: SuggestionItem = {
			type: "alias",
			alias: "a_note_alias",
			file: noteFile as any,
			basename: "Note-09",
		};

		await suggest.selectSuggestion(item, {} as any);
		expect(editor.getLine(0)).toBe("[[Note-09|a_note_alias]]");
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

// ============================================================================
// Tab / "#" / "^" / Shift+Enter scope key handlers
//
// These mirror stock Obsidian's own `[[` suggest: Tab completes the
// highlighted suggestion but keeps the popup open (via Editor.replaceRange's
// public `origin` parameter, not any private suggest internals); "#"/"^" do
// the same while also switching into heading/block mode; Shift+Enter creates
// an unresolved link to the literally-typed query.
// ============================================================================

function getScopeHandler(suggest: EditorFileSuggest, key: string, modifiers: string[] | null = null) {
	const keys = (suggest as any).scope.keys as Array<{
		modifiers: string[] | null;
		key: string;
		func: (evt?: any) => boolean | undefined;
	}>;
	const handler = keys.find(
		(k) => k.key === key && JSON.stringify(k.modifiers) === JSON.stringify(modifiers)
	);
	if (!handler) throw new Error(`No scope handler registered for key "${key}"`);
	return handler.func;
}

function setSelectedSuggestionDom(): void {
	document.body.innerHTML = "";
	const container = document.createElement("div");
	container.className = "suggestion-container";
	const other = document.createElement("div");
	other.className = "suggestion-item";
	const selected = document.createElement("div");
	selected.className = "suggestion-item is-selected";
	container.appendChild(other);
	container.appendChild(selected);
	document.body.appendChild(container);
}

describe("EditorFileSuggest Tab key handler", () => {
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

	it("completes the highlighted item in place using the input.type origin (indistinguishable from real typing)", () => {
		editor.setLines(["[[myn"]);
		setContext("myn", 2, 5);
		const item: SuggestionItem = {
			type: "file",
			basename: "mynote",
			name: "mynote.md",
			extension: "md",
		};
		(suggest as any).lastSuggestions = [item];
		setSelectedSuggestionDom();

		const handler = getScopeHandler(suggest, "Tab");
		const result = handler({ preventDefault: () => {}, stopPropagation: () => {} });

		expect(result).toBe(false); // consumed
		expect(editor.getLine(0)).toBe("[[mynote");
		expect(editor.getCursor().ch).toBe(8);
		// Tagged as real typing so this plugin's own linkSyntaxHider CM6
		// filters treat it identically to genuine keystrokes.
		expect(editor.lastReplaceRangeOrigin).toBe("input.type");
		// The popup must stay open: the context is updated in place, not cleared.
		expect((suggest as any).context).not.toBeNull();
		expect((suggest as any).context.query).toBe("mynote");
	});

	it("applies the completion text and the resulting cursor atomically via editor.transaction, never a separate setCursor call", () => {
		// Regression guard for a real-Obsidian bug: this plugin's OWN
		// cursor-corrector (linkSyntaxHider.ts) explicitly skips correcting
		// the cursor for doc-changing transactions (`!update.docChanged`
		// guards), but does NOT skip a separate, later pure-selection
		// dispatch. A prior implementation called `editor.replaceRange(...)`
		// followed by a separate `editor.setCursor(...)` call; the corrector
		// treated that second, selection-only dispatch as arrow-key-style
		// navigation landing on the freshly-completed link's hidden trailing
		// "]]" boundary and "corrected" the cursor forward past it — which
		// made the very next `onTrigger` check report "outside the link" and
		// close the popup. Setting the change AND the resulting selection in
		// ONE `editor.transaction({changes, selection}, origin)` call (like
		// stock Obsidian's own suggest does) keeps the selection update
		// under the same docChanged guard as the edit itself.
		//
		// If this test starts failing because `completeSelection` was
		// rewritten to call `editor.replaceRange()` + `editor.setCursor()`
		// separately again, that reintroduces this exact bug even though
		// every other assertion in this file (which only checks final
		// editor state) would still pass.
		editor.setLines(["[[myn"]);
		setContext("myn", 2, 5);
		const item: SuggestionItem = {
			type: "file",
			basename: "mynote",
			name: "mynote.md",
			extension: "md",
		};
		(suggest as any).lastSuggestions = [item];
		setSelectedSuggestionDom();

		const transactionSpy = vi.spyOn(editor, "transaction");

		const handler = getScopeHandler(suggest, "Tab");
		handler({ preventDefault: () => {}, stopPropagation: () => {} });

		// If completeSelection reverts to two separate dispatches, this spy
		// either isn't called at all, or is called without the selection
		// bundled into the same call — either way this assertion fails.
		expect(transactionSpy).toHaveBeenCalledTimes(1);
		expect(transactionSpy).toHaveBeenCalledWith(
			{
				changes: [{ from: { line: 0, ch: 2 }, to: { line: 0, ch: 5 }, text: "mynote" }],
				selection: { from: { line: 0, ch: 8 } },
			},
			"input.type"
		);
	});

	it("directly calls the inherited trigger() to force the popup to refresh, rather than waiting on Obsidian's own debounced re-trigger", () => {
		// This is the actual fix for the real-Obsidian regression where the
		// popup closed after Tab: relying on Editor.replaceRange's `origin`
		// param alone to get Obsidian's editor update listener to notice the
		// edit and re-open the popup on its own schedule was NOT reliable in
		// practice. Calling this.trigger(...) ourselves, synchronously and
		// unconditionally (forceShow=true), is what actually keeps it open.
		editor.setLines(["[[myn"]);
		setContext("myn", 2, 5);
		const item: SuggestionItem = {
			type: "file",
			basename: "mynote",
			name: "mynote.md",
			extension: "md",
		};
		(suggest as any).lastSuggestions = [item];
		setSelectedSuggestionDom();

		const triggerSpy = vi.fn().mockReturnValue(true);
		(suggest as any).trigger = triggerSpy;

		const handler = getScopeHandler(suggest, "Tab");
		handler({ preventDefault: () => {}, stopPropagation: () => {} });

		expect(triggerSpy).toHaveBeenCalledTimes(1);
		expect(triggerSpy).toHaveBeenCalledWith(editor, file, true);
	});

	it("flashes instead of editing when the query already matches the completion", () => {
		editor.setLines(["[[mynote"]);
		setContext("mynote", 2, 8);
		const item: SuggestionItem = {
			type: "file",
			basename: "mynote",
			name: "mynote.md",
			extension: "md",
		};
		(suggest as any).lastSuggestions = [item];
		setSelectedSuggestionDom();

		const handler = getScopeHandler(suggest, "Tab");
		const result = handler({ preventDefault: () => {}, stopPropagation: () => {} });

		expect(result).toBe(false);
		expect(editor.getLine(0)).toBe("[[mynote"); // unchanged
	});

	it("does not consume the key when there is no active suggest context", () => {
		const handler = getScopeHandler(suggest, "Tab");
		const result = handler({ preventDefault: () => {}, stopPropagation: () => {} });
		expect(result).toBe(true); // not consumed, falls through to default Tab behavior
	});
});

describe("EditorFileSuggest '#' key handler", () => {
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

	it("completes the file and switches into heading mode while the query is a plain file search", () => {
		editor.setLines(["[[myn"]);
		setContext("myn", 2, 5);
		const item: SuggestionItem = {
			type: "file",
			basename: "mynote",
			name: "mynote.md",
			extension: "md",
		};
		(suggest as any).lastSuggestions = [item];
		setSelectedSuggestionDom();

		const handler = getScopeHandler(suggest, "#");
		const result = handler({ preventDefault: () => {}, stopPropagation: () => {} });

		expect(result).toBe(false);
		expect(editor.getLine(0)).toBe("[[mynote#");
		expect(editor.lastReplaceRangeOrigin).toBe("input.type");
		expect((suggest as any).context.query).toBe("mynote#");
	});

	it("does not intercept once the query is already a heading/block/alias search", () => {
		editor.setLines(["[[mynote#Intro"]);
		setContext("mynote#Intro", 2, 14);
		(suggest as any).lastSuggestions = [];

		const handler = getScopeHandler(suggest, "#");
		const result = handler({ preventDefault: () => {}, stopPropagation: () => {} });

		expect(result).toBe(true); // not consumed — "#" types normally
		expect(editor.getLine(0)).toBe("[[mynote#Intro"); // unchanged by the handler
	});

	it("does not swallow the keystroke when the query is plain-file but nothing is highlighted", () => {
		// Query is still a plain file search (passes the mode gate), but there
		// is no highlighted suggestion to complete (e.g. an empty result list).
		// The "#" must be left to type normally, not silently disappear.
		editor.setLines(["[[zzz"]);
		setContext("zzz", 2, 5);
		(suggest as any).lastSuggestions = [];
		document.body.innerHTML = "";

		const preventDefault = vi.fn();
		const stopPropagation = vi.fn();
		const handler = getScopeHandler(suggest, "#");
		const result = handler({ preventDefault, stopPropagation });

		expect(result).toBe(true); // not consumed — falls through to normal typing
		expect(preventDefault).not.toHaveBeenCalled();
		expect(stopPropagation).not.toHaveBeenCalled();
		expect(editor.getLine(0)).toBe("[[zzz"); // unchanged by the handler
	});

	it("does not complete-select the top suggestion on an untouched, empty query", () => {
		// Before the user has typed anything after "[[", the query is empty
		// and the suggest is showing the unfiltered file list. Pressing "#"
		// here must type "#" normally (searching headings in the *current*
		// file) rather than silently picking whatever happens to be first in
		// that unfiltered list and linking to it.
		editor.setLines(["[["]);
		setContext("", 2, 2);
		const item: SuggestionItem = {
			type: "file",
			basename: "some-unrelated-file",
			name: "some-unrelated-file.md",
			extension: "md",
		};
		(suggest as any).lastSuggestions = [item];
		setSelectedSuggestionDom();

		const preventDefault = vi.fn();
		const stopPropagation = vi.fn();
		const handler = getScopeHandler(suggest, "#");
		const result = handler({ preventDefault, stopPropagation });

		expect(result).toBe(true); // not consumed — "#" types normally
		expect(preventDefault).not.toHaveBeenCalled();
		expect(stopPropagation).not.toHaveBeenCalled();
		expect(editor.getLine(0)).toBe("[["); // unchanged — no file was auto-selected
	});
});

describe("EditorFileSuggest '^' key handler", () => {
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

	it("completes the file and switches into block mode while the query is a plain file search", () => {
		editor.setLines(["[[myn"]);
		setContext("myn", 2, 5);
		const item: SuggestionItem = {
			type: "file",
			basename: "mynote",
			name: "mynote.md",
			extension: "md",
		};
		(suggest as any).lastSuggestions = [item];
		setSelectedSuggestionDom();

		const handler = getScopeHandler(suggest, "^");
		const result = handler({ preventDefault: () => {}, stopPropagation: () => {} });

		expect(result).toBe(false);
		expect(editor.getLine(0)).toBe("[[mynote^");
		expect(editor.lastReplaceRangeOrigin).toBe("input.type");
	});

	it("does not complete-select the top suggestion on an untouched, empty query", () => {
		editor.setLines(["[["]);
		setContext("", 2, 2);
		const item: SuggestionItem = {
			type: "file",
			basename: "some-unrelated-file",
			name: "some-unrelated-file.md",
			extension: "md",
		};
		(suggest as any).lastSuggestions = [item];
		setSelectedSuggestionDom();

		const preventDefault = vi.fn();
		const handler = getScopeHandler(suggest, "^");
		const result = handler({ preventDefault, stopPropagation: vi.fn() });

		expect(result).toBe(true); // not consumed — "^" types normally
		expect(preventDefault).not.toHaveBeenCalled();
		expect(editor.getLine(0)).toBe("[["); // unchanged — no file was auto-selected
	});
});

describe("EditorFileSuggest Shift+Enter key handler", () => {
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

	it("creates an unresolved link to the literally-typed query", () => {
		editor.setLines(["[[does not exist"]);
		setContext("does not exist", 2, 17);

		const handler = getScopeHandler(suggest, "Enter", ["Shift"]);
		const result = handler({ preventDefault: () => {}, stopPropagation: () => {} });

		expect(result).toBe(false);
		expect(editor.getLine(0)).toBe("[[does not exist]]");
		expect(editor.getCursor().ch).toBe("[[does not exist]]".length);
	});

	it("consumes an auto-paired ']]' instead of duplicating it", () => {
		editor.setLines(["[[does not exist]]"]);
		setContext("does not exist", 2, 16);

		const handler = getScopeHandler(suggest, "Enter", ["Shift"]);
		handler({ preventDefault: () => {}, stopPropagation: () => {} });

		expect(editor.getLine(0)).toBe("[[does not exist]]");
	});

	it("applies the full link insertion and cursor atomically via editor.transaction", () => {
		// Same regression class as completeSelection's atomic-transaction
		// guard above: buildFullLinkReplacement (shared by this handler and
		// selectSuggestion) must set the change and the resulting cursor in
		// one editor.transaction() call, not a separate setCursor() call.
		editor.setLines(["[[does not exist"]);
		setContext("does not exist", 2, 17);

		const transactionSpy = vi.spyOn(editor, "transaction");

		const handler = getScopeHandler(suggest, "Enter", ["Shift"]);
		handler({ preventDefault: () => {}, stopPropagation: () => {} });

		expect(transactionSpy).toHaveBeenCalledTimes(1);
		expect(transactionSpy).toHaveBeenCalledWith({
			changes: [{ from: { line: 0, ch: 0 }, to: { line: 0, ch: 17 }, text: "[[does not exist]]" }],
			selection: { from: { line: 0, ch: "[[does not exist]]".length } },
		});
	});

	it("is a no-op on an empty query instead of inserting an empty link", () => {
		editor.setLines(["[[]]"]);
		setContext("", 2, 2);

		const preventDefault = vi.fn();
		const stopPropagation = vi.fn();
		const handler = getScopeHandler(suggest, "Enter", ["Shift"]);
		const result = handler({ preventDefault, stopPropagation });

		expect(result).toBe(true); // not consumed
		expect(preventDefault).not.toHaveBeenCalled();
		expect(editor.getLine(0)).toBe("[[]]"); // unchanged
	});
});
