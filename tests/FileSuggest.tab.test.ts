// @vitest-environment jsdom

/**
 * Tests for FileSuggest's Tab key handler.
 *
 * Regression coverage for the refactor that moved the "resolve selected item
 * -> compare to current text -> flash-or-apply" sequence into the shared
 * `resolveCompletion` helper (also used by EditorFileSuggest's Tab/#/^
 * handlers), and for the fix that stops the handler from calling
 * `preventDefault`/`stopPropagation` before it knows whether there is
 * anything to complete.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { FileSuggest } from "../src/FileSuggest";
import { SuggestionItem } from "../src/types";
import { App, TFile } from "./__mocks__/obsidian";

function makeModalStub() {
	const destInputEl = document.createElement("input");
	destInputEl.value = "";

	return {
		textInput: { inputEl: document.createElement("input") },
		destInput: { getValue: () => destInputEl.value },
		link: { text: "", destination: "", isWiki: true, isEmbed: false },
		isWiki: true,
		textModifiedByUser: false,
		handleDestInput: vi.fn(),
		showAliasNotice: vi.fn(),
		clearAliasNotice: vi.fn(),
		isTextProvisional: vi.fn().mockReturnValue(true),
		getFocusableElements: vi.fn().mockReturnValue([]),
		_destInputEl: destInputEl,
	};
}

function makeFileSuggest(modal: ReturnType<typeof makeModalStub>) {
	const app = new App();
	const suggest = new FileSuggest(app as any, modal._destInputEl, modal as any);
	return suggest;
}

function getTabHandler(suggest: FileSuggest) {
	const keys = (suggest as any).scope.keys as Array<{
		modifiers: string[] | null;
		key: string;
		func: (evt?: any) => boolean | undefined;
	}>;
	const handler = keys.find((k) => k.key === "Tab");
	if (!handler) throw new Error("No Tab handler registered");
	return handler.func;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeMdFile(basename: string, folder = "notes"): any {
	return new TFile({
		path: `${folder}/${basename}.md`,
		name: `${basename}.md`,
		basename,
		extension: "md",
	});
}

describe("FileSuggest Tab key handler", () => {
	let modal: ReturnType<typeof makeModalStub>;
	let suggest: FileSuggest;

	beforeEach(() => {
		modal = makeModalStub();
		suggest = makeFileSuggest(modal);
	});

	it("completes the highlighted item into the input and refreshes suggestions", () => {
		modal._destInputEl.value = "myn";
		const item: SuggestionItem = {
			type: "file",
			file: makeMdFile("mynote"),
			basename: "mynote",
			name: "mynote.md",
			extension: "md",
		};
		(suggest as any).lastSuggestions = [item];

		const dispatchSpy = vi.spyOn(modal._destInputEl, "dispatchEvent");
		const handler = getTabHandler(suggest);
		const preventDefault = vi.fn();
		const stopPropagation = vi.fn();
		const result = handler({ preventDefault, stopPropagation });

		expect(result).toBe(false); // consumed
		expect(modal._destInputEl.value).toBe("mynote");
		expect(modal.handleDestInput).toHaveBeenCalled();
		expect(dispatchSpy).toHaveBeenCalled();
		expect(preventDefault).toHaveBeenCalled();
	});

	it("flashes instead of editing when the input already matches the completion", () => {
		modal._destInputEl.value = "mynote";
		const item: SuggestionItem = {
			type: "file",
			file: makeMdFile("mynote"),
			basename: "mynote",
			name: "mynote.md",
			extension: "md",
		};
		(suggest as any).lastSuggestions = [item];

		const handler = getTabHandler(suggest);
		const result = handler({ preventDefault: () => {}, stopPropagation: () => {} });

		expect(result).toBe(false);
		expect(modal._destInputEl.value).toBe("mynote"); // unchanged
		expect(modal.handleDestInput).not.toHaveBeenCalled();
	});

	it("does not swallow the keystroke when nothing is highlighted", () => {
		modal._destInputEl.value = "zzz";
		(suggest as any).lastSuggestions = [];
		document.body.innerHTML = "";

		const preventDefault = vi.fn();
		const stopPropagation = vi.fn();
		const handler = getTabHandler(suggest);
		const result = handler({ preventDefault, stopPropagation });

		expect(result).toBe(true); // not consumed — falls through to default Tab behavior
		expect(preventDefault).not.toHaveBeenCalled();
		expect(stopPropagation).not.toHaveBeenCalled();
		expect(modal._destInputEl.value).toBe("zzz");
	});

	it("does not consume the key while composing (IME)", () => {
		const item: SuggestionItem = {
			type: "file",
			file: makeMdFile("mynote"),
			basename: "mynote",
			name: "mynote.md",
			extension: "md",
		};
		(suggest as any).lastSuggestions = [item];

		const preventDefault = vi.fn();
		const handler = getTabHandler(suggest);
		const result = handler({ preventDefault, stopPropagation: vi.fn(), isComposing: true });

		expect(result).toBe(true);
		expect(preventDefault).not.toHaveBeenCalled();
	});
});
