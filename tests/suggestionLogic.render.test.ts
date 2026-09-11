// @vitest-environment jsdom

/**
 * Tests for renderSuggestionItem and flashSuggestContainer from suggestionLogic.
 *
 * These functions use Obsidian's HTMLElement extensions (addClass, createDiv,
 * createSpan, empty, closest). The polyfills below add just enough of that API
 * to jsdom elements for the tests to run.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderSuggestionItem, flashSuggestContainer } from "../src/suggestionLogic";
import { App, MarkdownRenderChild, MarkdownRenderer, TFile } from "./__mocks__/obsidian";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tf(overrides: ConstructorParameters<typeof TFile>[0]): any {
	return new TFile(overrides);
}

import { SuggestionItem } from "../src/types";

// ---------------------------------------------------------------------------
// Obsidian DOM polyfills
// ---------------------------------------------------------------------------

function addObsidianDomExtensions() {
	(HTMLElement.prototype as any).addClass = function (cls: string) {
		this.classList.add(cls);
	};
	(HTMLElement.prototype as any).createDiv = function (opts: any = {}) {
		const div = document.createElement("div");
		if (opts.cls) div.className = opts.cls;
		if (opts.text) div.textContent = opts.text;
		this.appendChild(div);
		return div;
	};
	(HTMLElement.prototype as any).createSpan = function (opts: any = {}) {
		const span = document.createElement("span");
		if (opts.cls) span.className = opts.cls;
		if (opts.text) span.textContent = opts.text;
		this.appendChild(span);
		return span;
	};
	(HTMLElement.prototype as any).empty = function () {
		this.innerHTML = "";
	};
}

addObsidianDomExtensions();

// ---------------------------------------------------------------------------
// renderSuggestionItem — file items
// ---------------------------------------------------------------------------

describe("renderSuggestionItem — file items", () => {
	let app: App;

	beforeEach(() => {
		app = new App();
	});

	it("renders md file basename in title", () => {
		const el = document.createElement("div");
		const item: SuggestionItem = {
			type: "file",
			basename: "MyNote",
			name: "MyNote.md",
			extension: "md",
			displayPath: "",
		};
		renderSuggestionItem(item, el, "My", app as any);
		expect(el.textContent).toContain("MyNote");
	});

	it("renders non-md file full name in title", () => {
		const el = document.createElement("div");
		const item: SuggestionItem = {
			type: "file",
			basename: "image",
			name: "image.png",
			extension: "png",
			displayPath: "",
		};
		renderSuggestionItem(item, el, "img", app as any);
		expect(el.textContent).toContain("image.png");
	});

	it("renders displayPath when provided", () => {
		const el = document.createElement("div");
		const item: SuggestionItem = {
			type: "file",
			basename: "note",
			name: "note.md",
			extension: "md",
			displayPath: "folder/sub/",
		};
		renderSuggestionItem(item, el, "note", app as any);
		expect(el.textContent).toContain("folder/sub/");
	});

	it("omits displayPath when it is /", () => {
		const el = document.createElement("div");
		const item: SuggestionItem = {
			type: "file",
			basename: "note",
			name: "note.md",
			extension: "md",
			displayPath: "/",
		};
		renderSuggestionItem(item, el, "note", app as any);
		expect(el.textContent).not.toContain("/");
	});

	it("adds mod-complex class to element", () => {
		const el = document.createElement("div");
		const item: SuggestionItem = {
			type: "file",
			basename: "note",
			name: "note.md",
			extension: "md",
		};
		renderSuggestionItem(item, el, "", app as any);
		expect(el.classList.contains("mod-complex")).toBe(true);
	});

	it("highlights matching text", () => {
		const el = document.createElement("div");
		const item: SuggestionItem = {
			type: "file",
			basename: "MyNote",
			name: "MyNote.md",
			extension: "md",
		};
		renderSuggestionItem(item, el, "Note", app as any);
		const highlight = el.querySelector(".suggestion-highlight");
		expect(highlight).not.toBeNull();
		expect(highlight!.textContent).toBe("Note");
	});
});

// ---------------------------------------------------------------------------
// renderSuggestionItem — heading items
// ---------------------------------------------------------------------------

describe("renderSuggestionItem — heading items", () => {
	let app: App;

	beforeEach(() => {
		app = new App();
	});

	it("renders heading text and level flair", () => {
		const el = document.createElement("div");
		const item: SuggestionItem = {
			type: "heading",
			heading: "Introduction",
			level: 2,
		};
		renderSuggestionItem(item, el, "#Intro", app as any);
		expect(el.textContent).toContain("Introduction");
		expect(el.textContent).toContain("H2");
	});

	it("shows file path when heading is in a different file", () => {
		const currentFile = tf({ path: "current.md" });
		app.workspace.setActiveFile(currentFile);

		const otherFile = tf({ path: "other.md" });
		const el = document.createElement("div");
		const item: SuggestionItem = {
			type: "heading",
			heading: "Section",
			level: 1,
			file: otherFile,
		};
		renderSuggestionItem(item, el, "##Section", app as any);
		expect(el.textContent).toContain("other.md");
	});

	it("hides file path when heading is in the current file", () => {
		const currentFile = tf({ path: "current.md" });
		app.workspace.setActiveFile(currentFile);

		const el = document.createElement("div");
		const item: SuggestionItem = {
			type: "heading",
			heading: "Section",
			level: 1,
			file: currentFile,
		};
		renderSuggestionItem(item, el, "#Section", app as any);
		expect(el.textContent).not.toContain("current.md");
	});

	it("hides file path for file#heading pattern query", () => {
		const currentFile = tf({ path: "current.md" });
		app.workspace.setActiveFile(currentFile);

		const otherFile = tf({ path: "other.md" });
		const el = document.createElement("div");
		const item: SuggestionItem = {
			type: "heading",
			heading: "Section",
			level: 1,
			file: otherFile,
		};
		// Query like "other#Sec" — file part already known, no need to show path
		renderSuggestionItem(item, el, "other#Sec", app as any);
		expect(el.textContent).not.toContain("other.md");
	});
});

// ---------------------------------------------------------------------------
// renderSuggestionItem — mode-aware hint bar
//
// Stock Obsidian's own suggest (SuggestManager.getInstructions()) only shows
// the "#"/"^"/"|" mode-switch hints while the query is still a plain file
// search; once the query has already switched into heading/block/alias mode
// it shows "↵ to accept" instead. This plugin previously showed the file-mode
// hints unconditionally, which is a visible, reported mismatch from stock
// (e.g. showing "Type # to link heading" while already inside a "##" global
// heading search, where typing "#" again does nothing useful).
// ---------------------------------------------------------------------------

describe("renderSuggestionItem — mode-aware hint bar", () => {
	let app: App;

	beforeEach(() => {
		app = new App();
	});

	function renderInContainer(item: SuggestionItem, query: string): HTMLElement {
		const container = document.createElement("div");
		container.className = "suggestion-container";
		const el = document.createElement("div");
		container.appendChild(el);
		renderSuggestionItem(item, el, query, app as any);
		return container;
	}

	it("shows the #/^/| hints for a plain file query", () => {
		const item: SuggestionItem = { type: "file", basename: "note", name: "note.md", extension: "md" };
		const container = renderInContainer(item, "note");
		const hint = container.querySelector(".steady-links-hint");
		expect(hint?.textContent).toContain("to link heading");
		expect(hint?.textContent).toContain("to link blocks");
		expect(hint?.textContent).toContain("to change display text");
		expect(hint?.textContent).not.toContain("to accept");
	});

	it("shows '↵ to accept' instead of the file-mode hints for a global heading (##) query", () => {
		const item: SuggestionItem = { type: "heading", heading: "Intro", level: 1 };
		const container = renderInContainer(item, "##Intro");
		const hint = container.querySelector(".steady-links-hint");
		expect(hint?.textContent).toContain("to accept");
		expect(hint?.textContent).not.toContain("to link heading");
	});

	it("shows '↵ to accept' for a current-file heading (#heading) query", () => {
		const item: SuggestionItem = { type: "heading", heading: "Intro", level: 1 };
		const container = renderInContainer(item, "#Intro");
		const hint = container.querySelector(".steady-links-hint");
		expect(hint?.textContent).toContain("to accept");
		expect(hint?.textContent).not.toContain("to link heading");
	});

	it("shows '↵ to accept' for a block (^block) query", () => {
		const item: SuggestionItem = { type: "block", blockId: "abc123", blockText: "text" };
		const container = renderInContainer(item, "^abc");
		const hint = container.querySelector(".steady-links-hint");
		expect(hint?.textContent).toContain("to accept");
		expect(hint?.textContent).not.toContain("to link blocks");
	});

	it("shows '↵ to accept' for a display-text (file|alias) query", () => {
		const item: SuggestionItem = { type: "alias", alias: "My Alias", basename: "note" };
		const container = renderInContainer(item, "note|My");
		const hint = container.querySelector(".steady-links-hint");
		expect(hint?.textContent).toContain("to accept");
		expect(hint?.textContent).not.toContain("to change display text");
	});

	it("updates the hint when re-rendered with a different query, rather than freezing the first mode", () => {
		const container = document.createElement("div");
		container.className = "suggestion-container";
		const fileEl = document.createElement("div");
		container.appendChild(fileEl);
		renderSuggestionItem(
			{ type: "file", basename: "note", name: "note.md", extension: "md" },
			fileEl,
			"note",
			app as any
		);
		expect(container.querySelector(".steady-links-hint")?.textContent).toContain("to link heading");

		const headingEl = document.createElement("div");
		container.appendChild(headingEl);
		renderSuggestionItem(
			{ type: "heading", heading: "Intro", level: 1 },
			headingEl,
			"##Intro",
			app as any
		);
		// Only one hint bar should exist, and it must reflect the latest query.
		const hints = container.querySelectorAll(".steady-links-hint");
		expect(hints.length).toBe(1);
		expect(hints[0].textContent).toContain("to accept");
	});
});

// ---------------------------------------------------------------------------
// renderSuggestionItem — block items
// ---------------------------------------------------------------------------

describe("renderSuggestionItem — block items", () => {
	let app: App;

	beforeEach(() => {
		app = new App();
	});

	it("renders block text", () => {
		const el = document.createElement("div");
		const item: SuggestionItem = {
			type: "block",
			blockId: "abc123",
			blockText: "Some block content",
		};
		renderSuggestionItem(item, el, "^abc", app as any);
		expect(el.textContent).toContain("Some block content");
	});

	it("renders block ID when present", () => {
		const el = document.createElement("div");
		const item: SuggestionItem = {
			type: "block",
			blockId: "abc123",
			blockText: "Text",
		};
		renderSuggestionItem(item, el, "^abc", app as any);
		expect(el.textContent).toContain("^abc123");
	});

	it("renders the full block markdown and marks it for visual clamping", () => {
		const el = document.createElement("div");
		const longText = "x".repeat(150);
		const item: SuggestionItem = {
			type: "block",
			blockId: null,
			blockText: longText,
		};
		const spy = vi.spyOn(MarkdownRenderer, "render");
		renderSuggestionItem(item, el, "", app as any);
		expect(spy.mock.calls[0][1]).toBe(longText);
		expect(
			el.querySelector(".suggestion-title")?.classList.contains("steady-links-block-preview")
		).toBe(true);
		spy.mockRestore();
	});

	it("highlights the matched query text in the rendered block preview", () => {
		const el = document.createElement("div");
		const item: SuggestionItem = {
			type: "block",
			blockId: null,
			blockText: "Some block content",
		};
		renderSuggestionItem(item, el, "^block", app as any);
		expect(el.querySelector(".suggestion-highlight")?.textContent).toBe("block");
	});

	it("delegates block preview rendering to Obsidian's MarkdownRenderer", () => {
		const el = document.createElement("div");
		const item: SuggestionItem = {
			type: "block",
			blockId: null,
			blockText: "Some [[Link|alias]] content",
		};
		const spy = vi.spyOn(MarkdownRenderer, "render");
		renderSuggestionItem(item, el, "^abc", app as any);
		expect(spy).toHaveBeenCalledTimes(1);
		expect(spy.mock.calls[0][1]).toBe("Some [[Link|alias]] content");
		expect(spy.mock.calls[0][4]).toBeInstanceOf(MarkdownRenderChild);
		spy.mockRestore();
	});
});

// ---------------------------------------------------------------------------
// renderSuggestionItem — alias items
// ---------------------------------------------------------------------------

describe("renderSuggestionItem — alias items", () => {
	let app: App;

	beforeEach(() => {
		app = new App();
	});

	it("renders alias name and target basename", () => {
		const el = document.createElement("div");
		const file = tf({ path: "note.md" });
		const item: SuggestionItem = {
			type: "alias",
			alias: "My Alias",
			file,
			basename: "note",
			displayPath: "",
		};
		renderSuggestionItem(item, el, "Alias", app as any);
		expect(el.textContent).toContain("My Alias");
		expect(el.textContent).toContain("→ note");
	});

	it("renders displayPath when provided", () => {
		const el = document.createElement("div");
		const file = tf({ path: "folder/note.md" });
		const item: SuggestionItem = {
			type: "alias",
			alias: "Alias",
			file,
			basename: "note",
			displayPath: "folder/",
		};
		renderSuggestionItem(item, el, "Alias", app as any);
		expect(el.textContent).toContain("folder/");
	});
});

// ---------------------------------------------------------------------------
// flashSuggestContainer
// ---------------------------------------------------------------------------

describe("flashSuggestContainer", () => {
	it("adds is-flashing class to a visible container", () => {
		vi.useFakeTimers();
		const container = document.createElement("div");
		container.className = "suggestion-container";
		document.body.appendChild(container);

		flashSuggestContainer();
		expect(container.classList.contains("is-flashing")).toBe(true);

		vi.advanceTimersByTime(200);
		expect(container.classList.contains("is-flashing")).toBe(false);
		vi.useRealTimers();

		document.body.removeChild(container);
	});

	it("uses provided container directly", () => {
		vi.useFakeTimers();
		const container = document.createElement("div");
		document.body.appendChild(container);

		flashSuggestContainer(container);
		expect(container.classList.contains("is-flashing")).toBe(true);

		vi.advanceTimersByTime(200);
		vi.useRealTimers();
		document.body.removeChild(container);
	});

	it("skips hidden containers when auto-finding", () => {
		const hidden = document.createElement("div");
		hidden.className = "suggestion-container is-hidden";
		document.body.appendChild(hidden);

		// Should not throw even if no visible container found
		expect(() => flashSuggestContainer()).not.toThrow();

		document.body.removeChild(hidden);
	});
});
