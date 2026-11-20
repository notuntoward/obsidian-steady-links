// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { App, Editor, Modal, Notice, TExternalFile, TFile } from "./__mocks__/obsidian";
import { EditLinkModal } from "../src/EditLinkModal";
import SteadyLinksPlugin from "../src/main";

describe("Copy link to current location", () => {
	it("warns instead of copying an external file when external linking is disabled", () => {
		const app = new App();
		const file = new TExternalFile({
			path: "MAINTENANCE.md",
			realPath: "C:/Users/scott/repos/obsidian-commons/docs/MAINTENANCE.md",
		});
		const plugin = new SteadyLinksPlugin(app as any, {} as any);
		(plugin as any).settings = {
			allowExternalFileLinks: false,
		};
		Notice.messages.length = 0;

		(plugin as any).copyLinkToFile(file);

		expect(Notice.messages).toContain(
			"External file links are disabled. Enable “Allow links to files outside the vault” in Steady Links settings."
		);
	});

	it("opens the link editor for an unselected block and defers adding its ID until acceptance", () => {
		const app = new App();
		const file = new TFile({ path: "Meeting Notes.md" });
		const content = "A paragraph";
		app.metadataCache.setFileCache(file.path, {
			sections: [
				{
					type: "paragraph",
					position: {
						start: { line: 0, col: 0, offset: 0 },
						end: { line: 0, col: content.length, offset: content.length },
					},
				},
			],
		});
		app.fileManager.generateMarkdownLink = (
			target: TFile,
			_sourcePath: string,
			subpath?: string,
			alias?: string
		) => `[[${target.basename}${subpath ?? ""}${alias ? `|${alias}` : ""}]]`;

		const editor = new Editor({ lines: [content], cursor: { line: 0, ch: 3 } });
		(editor as any).getValue = () => content;
		(editor as any).listSelections = () => [
			{ anchor: { line: 0, ch: 3 }, head: { line: 0, ch: 3 } },
		];
		let openedModal: EditLinkModal | null = null;
		vi.spyOn(Modal.prototype, "open").mockImplementation(function () {
			openedModal = this as EditLinkModal;
			return this;
		});

		const plugin = new SteadyLinksPlugin(app as any, {} as any);
		(plugin as any).copyLinkToLocation(editor, file);

		expect(openedModal).not.toBeNull();
		expect(openedModal!.link.text).toMatch(/^Meeting-Notes-block-/);
		expect(openedModal!.link.destination).toMatch(/^Meeting Notes\.md#\^/);
		expect(openedModal!.link.isWiki).toBe(true);
		expect(openedModal!.shouldSelectText).toBe(true);
		expect(editor.getLine(0)).toBe(content);

		openedModal!.onSubmit(openedModal!.link);
		expect(editor.getLine(0)).toMatch(/^A paragraph \^[A-Za-z0-9-]+$/);
	});
});
