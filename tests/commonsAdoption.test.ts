// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FileSuggest } from "../src/FileSuggest";
import { findVisibleSuggestionContainer } from "../src/suggestionLogic";
import { EditLinkModal } from "../src/EditLinkModal";
import SteadyLinksPlugin from "../src/main";
import { App, MarkdownView } from "./__mocks__/obsidian";
import * as workspaceCommons from "commons/workspace";
import * as windowsCommons from "commons/windows";

describe("commons adoption: FileSuggest owner document scoping", () => {
	it("selectCurrentSuggestion clicks the selected item in the input element's owner document, not the main document", () => {
		// Main document item
		const mainItem = document.createElement("div");
		mainItem.className = "suggestion-item is-selected";
		let mainClicked = false;
		mainItem.addEventListener("click", () => {
			mainClicked = true;
		});
		document.body.appendChild(mainItem);

		// Secondary popout document
		const popoutDoc = document.implementation.createHTMLDocument("popout");
		const popoutItem = popoutDoc.createElement("div");
		popoutItem.className = "suggestion-item is-selected";
		let popoutClicked = false;
		popoutItem.addEventListener("click", () => {
			popoutClicked = true;
		});
		popoutDoc.body.appendChild(popoutItem);

		const popoutInput = popoutDoc.createElement("input");
		popoutDoc.body.appendChild(popoutInput);

		const app = new App();
		const modalStub: any = {
			_destInputEl: popoutInput,
			textInput: { inputEl: popoutDoc.createElement("input") },
			destInput: { getValue: () => popoutInput.value },
			link: { text: "", destination: "", isWiki: true, isEmbed: false },
			isWiki: true,
			textModifiedByUser: false,
			handleDestInput: vi.fn(),
			isTextProvisional: vi.fn().mockReturnValue(true),
			getFocusableElements: vi.fn().mockReturnValue([]),
		};

		const suggest = new FileSuggest(app as any, popoutInput, modalStub);
		suggest.selectCurrentSuggestion();

		expect(popoutClicked).toBe(true);
		expect(mainClicked).toBe(false);

		document.body.removeChild(mainItem);
	});

	it("findVisibleSuggestionContainer finds the active container in a scoped document", () => {
		const popoutDoc = document.implementation.createHTMLDocument("popout");
		const container = popoutDoc.createElement("div");
		container.className = "suggestion-container";
		popoutDoc.body.appendChild(container);

		const found = findVisibleSuggestionContainer(popoutDoc);
		expect(found).toBe(container);
	});
});

describe("commons adoption: EditLinkModal owner-window clipboard and activeElement", () => {
	it("populateFromClipboard reads clipboard via readClipboardIn on the modal owner window", async () => {
		const app = new App();
		const linkInfo = { text: "", destination: "", isWiki: true, isEmbed: false };
		const modal = new EditLinkModal(app as any, linkInfo, vi.fn(), false, null, true, vi.fn(), true);
		modal.textInput = { setValue: vi.fn() } as any;
		modal.destInput = { setValue: vi.fn() } as any;
		(modal as any).updateUIState = vi.fn();

		const readClipboardSpy = vi.spyOn(windowsCommons, "readClipboardIn").mockResolvedValue("[[Destination|Link Text]]");

		await modal.populateFromClipboard();

		expect(readClipboardSpy).toHaveBeenCalledWith(modal.contentEl.ownerDocument.defaultView ?? window);
		expect(modal.link.destination).toBe("Destination");
		expect(modal.link.text).toBe("Link Text");
	});
});

describe("commons adoption: main.ts workspace and window utilities", () => {
	let plugin: SteadyLinksPlugin;
	let app: App;

	beforeEach(() => {
		app = new App();
		plugin = new SteadyLinksPlugin(app as any, {
			id: "steady-links",
			name: "Steady Links",
			version: "0.1.0",
			minAppVersion: "1.14.0",
			description: "",
			author: "",
			authorUrl: "",
			isDesktopOnly: false,
		});
		(plugin as any).settings = {
			keepLinksSteady: true,
			shortenHeadingLinks: true,
			shortenFileLinks: true,
		};
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("applySyntaxHiderSetting uses getEditorLeafLocations and does not call iterateAllLeaves directly", () => {
		const mockView = new MarkdownView({} as any);
		const mockLeaf: any = { view: mockView };
		const mockDispatch = vi.fn();
		(mockView.editor as any).cm = { dispatch: mockDispatch };

		(app.workspace as any).iterateAllLeaves = vi.fn();
		const iterateSpy = vi.spyOn(app.workspace as any, "iterateAllLeaves");
		const getLocationsSpy = vi.spyOn(workspaceCommons, "getEditorLeafLocations").mockReturnValue([
			{ leaf: mockLeaf as any, window: window, group: null }
		]);

		plugin.applySyntaxHiderSetting();

		expect(getLocationsSpy).toHaveBeenCalledWith(app);
		expect(iterateSpy).not.toHaveBeenCalled();
		expect(mockDispatch).toHaveBeenCalled();
	});

	it("writeLinkToClipboard delegates to writeClipboardIn with the target window", () => {
		const writeSpy = vi.spyOn(windowsCommons, "writeClipboardIn").mockResolvedValue(true);

		(plugin as any).writeLinkToClipboard("https://example.com", "Success");

		expect(writeSpy).toHaveBeenCalledWith(expect.anything(), "https://example.com");
	});

	it("restoreCursorAfterModalClose uses setTimeoutIn on the editor's owner window", () => {
		const setTimeoutSpy = vi.spyOn(windowsCommons, "setTimeoutIn");

		const mockDom = document.createElement("div");
		const mockEditor: any = {
			cm: {
				dom: mockDom,
				state: { doc: { lines: 1, line: () => ({ from: 0, to: 0, length: 0 }) } },
				focus: vi.fn(),
				dispatch: vi.fn(),
			},
			setCursor: vi.fn(),
		};

		(plugin as any).restoreCursorAfterModalClose(mockEditor, { line: 0, ch: 0 });

		expect(setTimeoutSpy).toHaveBeenCalledWith(mockDom.ownerDocument.defaultView ?? window, expect.any(Function), 0);
	});
});