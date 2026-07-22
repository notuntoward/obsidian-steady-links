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
import { App, TFile } from "./__mocks__/obsidian";

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

	it("truncates block text longer than 100 chars", () => {
		const el = document.createElement("div");
		const longText = "x".repeat(150);
		const item: SuggestionItem = {
			type: "block",
			blockId: null,
			blockText: longText,
		};
		renderSuggestionItem(item, el, "", app as any);
		expect(el.textContent).toContain("...");
		expect(el.textContent!.length).toBeLessThan(longText.length + 10);
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
