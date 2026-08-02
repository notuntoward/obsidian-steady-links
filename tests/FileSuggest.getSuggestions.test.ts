// @vitest-environment jsdom

/**
 * Tests for FileSuggest.getSuggestionsInternal, isSuggestOpen, and
 * selectCurrentSuggestion — the parts of FileSuggest not covered by the
 * selectSuggestion test file.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { FileSuggest } from "../src/FileSuggest";
import { App, TFile } from "./__mocks__/obsidian";
import { enterAtLinkEndKeymap, isAnySuggestOpen } from "../src/linkSyntaxHider";

// ---------------------------------------------------------------------------
// Modal stub
// ---------------------------------------------------------------------------

function makeModalStub(isWiki = true) {
	const destInputEl = document.createElement("input");
	return {
		textInput: { inputEl: document.createElement("input") },
		destInput: { getValue: () => destInputEl.value },
		link: { text: "", destination: "", isWiki, isEmbed: false },
		isWiki,
		textModifiedByUser: false,
		handleDestInput: vi.fn(),
		showAliasNotice: vi.fn(),
		clearAliasNotice: vi.fn(),
		isTextProvisional: vi.fn().mockReturnValue(true),
		getFocusableElements: vi.fn().mockReturnValue([]),
		_destInputEl: destInputEl,
	};
}

function makeSuggest(app: App, modal: ReturnType<typeof makeModalStub>) {
	return new FileSuggest(app as any, modal._destInputEl, modal as any);
}

// ---------------------------------------------------------------------------
// getSuggestionsInternal
// ---------------------------------------------------------------------------

describe("FileSuggest.getSuggestionsInternal", () => {
	let app: App;

	beforeEach(() => {
		app = new App();
	});

	it("returns empty array for URL queries", async () => {
		const modal = makeModalStub();
		const suggest = makeSuggest(app, modal);
		const results = await suggest.getSuggestionsInternal("https://example.com");
		expect(results).toEqual([]);
	});

	it("returns files for non-wiki mode", async () => {
		app.vault.addFile(new TFile({ path: "note.md" }));
		const modal = makeModalStub(false);
		const suggest = makeSuggest(app, modal);
		const results = await suggest.getSuggestionsInternal("note");
		expect(results.some((r) => r.type === "file")).toBe(true);
	});

	it("routes ##heading to global headings and filters by query", async () => {
		const file = new TFile({ path: "note.md" });
		app.vault.addFile(file);
		app.metadataCache.setFileCache("note.md", {
			headings: [
				{ heading: "Introduction", level: 1, position: {} },
				{ heading: "Conclusion", level: 1, position: {} },
			],
		});

		const modal = makeModalStub();
		const suggest = makeSuggest(app, modal);
		const results = await suggest.getSuggestionsInternal("##Intro");
		expect(results).toHaveLength(1);
		expect(results[0].heading).toBe("Introduction");
	});

	it("returns all global headings when ## query is empty", async () => {
		const file = new TFile({ path: "note.md" });
		app.vault.addFile(file);
		app.metadataCache.setFileCache("note.md", {
			headings: [
				{ heading: "H1", level: 1, position: {} },
				{ heading: "H2", level: 1, position: {} },
			],
		});

		const modal = makeModalStub();
		const suggest = makeSuggest(app, modal);
		const results = await suggest.getSuggestionsInternal("##");
		expect(results).toHaveLength(2);
	});

	it("routes #heading to current file headings and filters", async () => {
		const file = new TFile({ path: "note.md" });
		app.vault.addFile(file);
		app.workspace.setActiveFile(file);
		app.metadataCache.setFileCache("note.md", {
			headings: [
				{ heading: "Alpha", level: 1, position: {} },
				{ heading: "Beta", level: 1, position: {} },
			],
		});

		const modal = makeModalStub();
		const suggest = makeSuggest(app, modal);
		const results = await suggest.getSuggestionsInternal("#Alpha");
		expect(results).toHaveLength(1);
		expect(results[0].heading).toBe("Alpha");
	});

	it("returns empty for block query when no active file", async () => {
		const modal = makeModalStub();
		const suggest = makeSuggest(app, modal);
		const results = await suggest.getSuggestionsInternal("#^block");
		expect(results).toEqual([]);
	});

	it("routes file#heading query to getHeadingsInFile", async () => {
		const file = new TFile({ path: "mynote.md" });
		app.vault.addFile(file);
		app.metadataCache.setFileCache("mynote.md", {
			headings: [{ heading: "Section", level: 1, position: {} }],
		});

		const modal = makeModalStub();
		const suggest = makeSuggest(app, modal);
		const results = await suggest.getSuggestionsInternal("mynote#Section");
		expect(results).toHaveLength(1);
		expect(results[0].heading).toBe("Section");
	});

	it("routes file|alias query to getFileAliasesForFile", async () => {
		const file = new TFile({ path: "mynote.md" });
		app.vault.addFile(file);
		app.metadataCache.setFileCache("mynote.md", {
			frontmatter: { alias: ["SuperAlias"] },
		});

		const modal = makeModalStub();
		const suggest = makeSuggest(app, modal);
		const results = await suggest.getSuggestionsInternal("mynote|Super");
		expect(results).toHaveLength(2);
		expect(results[0].type).toBe("alias");
		expect(results[0].alias).toBe("SuperAlias");
		expect(results[1].type).toBe("alias");
		expect(results[1].alias).toBe("Super");
	});

	it("returns empty for file#block when file not found", async () => {
		const modal = makeModalStub();
		const suggest = makeSuggest(app, modal);
		const results = await suggest.getSuggestionsInternal("nonexistent#^block");
		expect(results).toEqual([]);
	});

	it("routes plain query to file search", async () => {
		app.vault.addFile(new TFile({ path: "mynote.md" }));
		const modal = makeModalStub();
		const suggest = makeSuggest(app, modal);
		const results = await suggest.getSuggestionsInternal("mynote");
		expect(results.some((r) => r.type === "file")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// isSuggestOpen
// ---------------------------------------------------------------------------

describe("FileSuggest.isSuggestOpen", () => {
	it("returns false when no suggestion containers exist", () => {
		const app = new App();
		const modal = makeModalStub();
		const suggest = makeSuggest(app, modal);
		expect(suggest.isSuggestOpen).toBe(false);
	});

	it("returns true when a visible suggestion container exists", () => {
		const container = document.createElement("div");
		container.className = "suggestion-container";
		document.body.appendChild(container);

		const app = new App();
		const modal = makeModalStub();
		const suggest = makeSuggest(app, modal);
		expect(suggest.isSuggestOpen).toBe(true);

		document.body.removeChild(container);
	});

	it("returns false when container is hidden via is-hidden class", () => {
		const container = document.createElement("div");
		container.className = "suggestion-container is-hidden";
		document.body.appendChild(container);

		const app = new App();
		const modal = makeModalStub();
		const suggest = makeSuggest(app, modal);
		expect(suggest.isSuggestOpen).toBe(false);

		document.body.removeChild(container);
	});

	it("returns false when container has display:none", () => {
		const container = document.createElement("div");
		container.className = "suggestion-container";
		container.style.display = "none";
		document.body.appendChild(container);

		const app = new App();
		const modal = makeModalStub();
		const suggest = makeSuggest(app, modal);
		expect(suggest.isSuggestOpen).toBe(false);

		document.body.removeChild(container);
	});
});

// ---------------------------------------------------------------------------
// selectCurrentSuggestion
// ---------------------------------------------------------------------------

describe("FileSuggest.selectCurrentSuggestion", () => {
	it("does nothing when no selected suggestion exists", () => {
		const app = new App();
		const modal = makeModalStub();
		const suggest = makeSuggest(app, modal);
		expect(() => suggest.selectCurrentSuggestion()).not.toThrow();
	});

	it("clicks the selected suggestion element", () => {
		const el = document.createElement("div");
		el.className = "suggestion-item is-selected";
		let clicked = false;
		el.addEventListener("click", () => {
			clicked = true;
		});
		document.body.appendChild(el);

		const app = new App();
		const modal = makeModalStub();
		const suggest = makeSuggest(app, modal);

		suggest.selectCurrentSuggestion();
		expect(clicked).toBe(true);

		document.body.removeChild(el);
	});
});

// ---------------------------------------------------------------------------
// FileSuggest scope key handlers (# and ^)
// ---------------------------------------------------------------------------

describe("FileSuggest scope key handlers", () => {
	it("does not register Emacs navigation keys (Ctrl+n, Ctrl+p, Ctrl+b, Ctrl+f) in scope", () => {
		const app = new App();
		const modal = makeModalStub();
		const suggest = makeSuggest(app, modal);

		const scopeKeys = (suggest as any).scope.keys;
		const ctrlN = scopeKeys.find((k: any) => k.key === "n" && k.modifiers?.includes("Ctrl"));
		const ctrlP = scopeKeys.find((k: any) => k.key === "p" && k.modifiers?.includes("Ctrl"));
		const ctrlB = scopeKeys.find((k: any) => k.key === "b" && k.modifiers?.includes("Ctrl"));
		const ctrlF = scopeKeys.find((k: any) => k.key === "f" && k.modifiers?.includes("Ctrl"));

		expect(ctrlN).toBeUndefined();
		expect(ctrlP).toBeUndefined();
		expect(ctrlB).toBeUndefined();
		expect(ctrlF).toBeUndefined();
	});

});

describe("isAnySuggestOpen and enterAtLinkEndKeymap with open suggestion pop-up", () => {
	it("correctly detects when a suggestion container is open in DOM", () => {
		expect(isAnySuggestOpen()).toBe(false);

		const container = document.createElement("div");
		container.className = "suggestion-container";
		document.body.appendChild(container);

		try {
			expect(isAnySuggestOpen()).toBe(true);
		} finally {
			container.remove();
		}
		expect(isAnySuggestOpen()).toBe(false);
	});
});
