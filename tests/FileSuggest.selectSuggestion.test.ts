// @vitest-environment jsdom

/**
 * Tests for FileSuggest.selectSuggestion link-text update behaviour.
 *
 * Regression coverage for: selecting an alias or file from the destination
 * completion list must always update the Link Text field.
 *
 * Scenarios covered:
 *  1. Selecting an alias row → link text becomes the alias
 *  2. Selecting a different alias when one is already set → link text updates
 *  3. Selecting the plain file row → link text becomes the basename
 *  4. Selecting a plain file row clears a previously-set alias → link text
 *     becomes the basename, not the old alias
 *  5. Selecting a non-md file row → link text becomes the full filename
 *  6. textModifiedByUser is set to true after alias selection
 *  7. textModifiedByUser is set to true after file selection
 *  8. link.text is updated on the modal object after alias selection
 *  9. link.text is updated on the modal object after file selection
 * 10. Dest input receives the file basename (not the alias) after alias selection
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { FileSuggest } from "../src/FileSuggest";
import { SuggestionItem } from "../src/types";
import { App, TFile } from "./__mocks__/obsidian";

// ---------------------------------------------------------------------------
// Minimal modal stub — only the surface that selectSuggestion touches
// ---------------------------------------------------------------------------

function makeModalStub(initialText = "Old Alias") {
	const textInputEl = document.createElement("input");
	textInputEl.value = initialText;

	const destInputEl = document.createElement("input");
	destInputEl.value = "";

	return {
		textInput: { inputEl: textInputEl },
		destInput: { getValue: () => destInputEl.value },
		link: { text: initialText, destination: "", isWiki: true, isEmbed: false },
		isWiki: true,
		textModifiedByUser: false,
		handleDestInput: vi.fn(),
		showAliasNotice: vi.fn(),
		clearAliasNotice: vi.fn(),
		// expose destInputEl so tests can read the final dest value
		_destInputEl: destInputEl,
	};
}

// ---------------------------------------------------------------------------
// FileSuggest stub — provides a concrete instance with a controllable inputEl
// ---------------------------------------------------------------------------

function makeFileSuggest(modal: ReturnType<typeof makeModalStub>) {
	const app = new App();
	const destInputEl = modal._destInputEl;
	// FileSuggest constructor calls super(app, inputEl) and assigns this.inputEl
	const suggest = new FileSuggest(app, destInputEl, modal as any);
	return suggest;
}

// ---------------------------------------------------------------------------
// TFile helper
// ---------------------------------------------------------------------------

function makeMdFile(basename: string, folder = "notes"): TFile {
	return new TFile({
		path: `${folder}/${basename}.md`,
		name: `${basename}.md`,
		basename,
		extension: "md",
	});
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FileSuggest.selectSuggestion — link text update", () => {
	let modal: ReturnType<typeof makeModalStub>;
	let suggest: FileSuggest;

	beforeEach(() => {
		modal = makeModalStub("Old Alias");
		suggest = makeFileSuggest(modal);
	});

	// ── alias row ────────────────────────────────────────────────────────────

	it("sets link text to alias when an alias row is selected", async () => {
		const file = makeMdFile("my-note");
		const item: SuggestionItem = {
			type: "alias",
			alias: "My Fancy Alias",
			file,
			basename: "my-note",
			path: file.path,
			name: file.name,
			extension: "md",
		};

		await suggest.selectSuggestion(item);

		expect(modal.textInput.inputEl.value).toBe("My Fancy Alias");
	});

	it("updates link text when a different alias is chosen (overrides existing alias)", async () => {
		modal.textInput.inputEl.value = "First Alias";
		modal.link.text = "First Alias";

		const file = makeMdFile("my-note");
		const item: SuggestionItem = {
			type: "alias",
			alias: "Second Alias",
			file,
			basename: "my-note",
			path: file.path,
			name: file.name,
			extension: "md",
		};

		await suggest.selectSuggestion(item);

		expect(modal.textInput.inputEl.value).toBe("Second Alias");
	});

	it("sets dest input to the file basename (not the alias) when alias row selected", async () => {
		const file = makeMdFile("actual-note");
		const item: SuggestionItem = {
			type: "alias",
			alias: "Pretty Name",
			file,
			basename: "actual-note",
			path: file.path,
			name: file.name,
			extension: "md",
		};

		await suggest.selectSuggestion(item);

		expect(modal._destInputEl.value).toBe("actual-note");
	});

	it("sets modal.link.text to alias after alias selection", async () => {
		const file = makeMdFile("some-note");
		const item: SuggestionItem = {
			type: "alias",
			alias: "The Alias",
			file,
			basename: "some-note",
			path: file.path,
			name: file.name,
			extension: "md",
		};

		await suggest.selectSuggestion(item);

		expect(modal.link.text).toBe("The Alias");
	});

	it("marks textModifiedByUser=true after alias selection", async () => {
		const file = makeMdFile("note");
		const item: SuggestionItem = {
			type: "alias",
			alias: "An Alias",
			file,
			basename: "note",
			path: file.path,
			name: file.name,
			extension: "md",
		};

		await suggest.selectSuggestion(item);

		expect(modal.textModifiedByUser).toBe(true);
	});

	it("calls showAliasNotice with the selected alias", async () => {
		const file = makeMdFile("note");
		const item: SuggestionItem = {
			type: "alias",
			alias: "Shown Alias",
			file,
			basename: "note",
			path: file.path,
			name: file.name,
			extension: "md",
		};

		await suggest.selectSuggestion(item);

		expect(modal.showAliasNotice).toHaveBeenCalledWith("Shown Alias");
	});

	// ── file row ─────────────────────────────────────────────────────────────

	it("sets link text to basename when a plain file row is selected", async () => {
		const file = makeMdFile("plain-note");
		const item: SuggestionItem = {
			type: "file",
			file,
			basename: "plain-note",
			path: file.path,
			name: file.name,
			extension: "md",
			displayPath: "",
		};

		await suggest.selectSuggestion(item);

		expect(modal.textInput.inputEl.value).toBe("plain-note");
	});

	it("clears a stale alias when the plain file row is selected", async () => {
		// Start with an alias already set in the link text
		modal.textInput.inputEl.value = "ChatGPT Is Changing the Words We Use in Conversation";
		modal.link.text = "ChatGPT Is Changing the Words We Use in Conversation";

		const file = makeMdFile("chatgpt-article");
		const item: SuggestionItem = {
			type: "file",
			file,
			basename: "chatgpt-article",
			path: file.path,
			name: file.name,
			extension: "md",
			displayPath: "",
		};

		await suggest.selectSuggestion(item);

		expect(modal.textInput.inputEl.value).toBe("chatgpt-article");
	});

	it("sets modal.link.text to basename after file selection", async () => {
		const file = makeMdFile("my-note");
		const item: SuggestionItem = {
			type: "file",
			file,
			basename: "my-note",
			path: file.path,
			name: file.name,
			extension: "md",
			displayPath: "",
		};

		await suggest.selectSuggestion(item);

		expect(modal.link.text).toBe("my-note");
	});

	it("marks textModifiedByUser=true after file selection", async () => {
		const file = makeMdFile("some-note");
		const item: SuggestionItem = {
			type: "file",
			file,
			basename: "some-note",
			path: file.path,
			name: file.name,
			extension: "md",
			displayPath: "",
		};

		await suggest.selectSuggestion(item);

		expect(modal.textModifiedByUser).toBe(true);
	});

	it("calls clearAliasNotice (not showAliasNotice) after file selection", async () => {
		const file = makeMdFile("note");
		const item: SuggestionItem = {
			type: "file",
			file,
			basename: "note",
			path: file.path,
			name: file.name,
			extension: "md",
			displayPath: "",
		};

		await suggest.selectSuggestion(item);

		expect(modal.clearAliasNotice).toHaveBeenCalled();
		expect(modal.showAliasNotice).not.toHaveBeenCalled();
	});

	it("uses full filename (not basename) for non-md files", async () => {
		const file = new TFile({
			path: "assets/diagram.png",
			name: "diagram.png",
			basename: "diagram",
			extension: "png",
		});
		const item: SuggestionItem = {
			type: "file",
			file,
			basename: "diagram",
			path: file.path,
			name: "diagram.png",
			extension: "png",
			displayPath: "",
		};

		await suggest.selectSuggestion(item);

		expect(modal.textInput.inputEl.value).toBe("diagram.png");
	});
});
