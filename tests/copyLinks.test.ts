import { describe, expect, it, vi } from "vitest";
import type { CachedMetadata, Pos, TAbstractFile, TFile } from "obsidian";
import { TFile as MockTFile } from "./__mocks__/obsidian";
import {
	generateFileLink,
	generateLocationLink,
	knownBlockIds,
	planLocationLink,
	resolveLocation,
	defaultBlockLinkText,
	selectedFileFromMenu,
	isSupportedFileTarget,
	shouldAddFileLinkMenuItem,
} from "../src/copyLinks";

function position(content: string, from: number, to: number): Pos {
	function loc(offset: number): Pos["start"] {
		const before = content.slice(0, offset).split("\n");
		return {
			line: before.length - 1,
			col: before[before.length - 1].length,
			offset,
		};
	}
	return { start: loc(from), end: loc(to) };
}

function fileLinkGenerator(useWikilinks: boolean) {
	return {
		generateMarkdownLink: vi.fn(
			(file: TFile, _sourcePath: string, subpath?: string, alias?: string): string => {
				if (useWikilinks) {
					const target =
						file.extension === "md" ? file.path.replace(/\.md$/i, "") : file.path;
					return `[[${target}${subpath ?? ""}${alias ? `|${alias}` : ""}]]`;
				}
				const encodedTarget = file.path.replace(/ /g, "%20");
				const encodedSubpath = subpath?.replace(/ /g, "%20") ?? "";
				return `[${alias ?? file.basename}](${encodedTarget}${encodedSubpath})`;
			}
		),
	};
}

describe("copy links to notes and locations", () => {
	it("compacts whitespace in default block-link text", () => {
		expect(defaultBlockLinkText("Meeting Notes", "id123")).toBe("Meeting-Notes-block-id123");
	});

	it("accepts one File Explorer menu target and rejects multiple selected rows", () => {
		const first = new MockTFile({ path: "First.md" });
		const second = new MockTFile({ path: "Second.md" });

		expect(selectedFileFromMenu([first as unknown as TAbstractFile])).toBe(first);
		expect(
			selectedFileFromMenu([
				first as unknown as TAbstractFile,
				second as unknown as TAbstractFile,
			])
		).toBeNull();
	});

	it("adds file-menu items for the File Explorer source and honors the tab-header setting", () => {
		expect(shouldAddFileLinkMenuItem("file-explorer-context-menu", false)).toBe(true);
		expect(shouldAddFileLinkMenuItem("file-explorer", false)).toBe(true);
		expect(shouldAddFileLinkMenuItem("tab-header", false)).toBe(false);
		expect(shouldAddFileLinkMenuItem("tab-header", true)).toBe(true);
	});

	it("does not treat Canvas or Ink files as link targets", () => {
		expect(
			isSupportedFileTarget(new MockTFile({ path: "Board.canvas" }) as unknown as TFile)
		).toBe(false);
		expect(
			isSupportedFileTarget(new MockTFile({ path: "Drawing.ink" }) as unknown as TFile)
		).toBe(false);
		expect(
			isSupportedFileTarget(new MockTFile({ path: "image.png" }) as unknown as TFile)
		).toBe(true);
	});

	it("uses Obsidian's configured link format and keeps PDF aliases extension-free", () => {
		const note = new MockTFile({ path: "Project plan.md" });
		const pdf = new MockTFile({ path: "Reference.pdf" });

		expect(generateFileLink(note as unknown as TFile, fileLinkGenerator(true))).toBe(
			"[[Project plan]]"
		);
		expect(generateFileLink(note as unknown as TFile, fileLinkGenerator(false))).toBe(
			"[Project plan](Project%20plan.md)"
		);
		expect(generateFileLink(pdf as unknown as TFile, fileLinkGenerator(true))).toBe(
			"[[Reference.pdf|Reference]]"
		);
		expect(generateFileLink(pdf as unknown as TFile, fileLinkGenerator(false))).toBe(
			"[Reference](Reference.pdf)"
		);
	});

	it("resolves a heading and uses selected text as its alias", () => {
		const content = "# Next steps\n";
		const cache: CachedMetadata = {
			headings: [
				{
					heading: "Next steps",
					level: 1,
					position: position(content, 0, content.length - 1),
				},
			],
		};
		const selection = {
			from: { line: 0, ch: 2 },
			to: { line: 0, ch: 12 },
			text: "Next steps",
		};

		const resolved = resolveLocation({
			content,
			cache,
			cursor: { line: 0, ch: 4 },
			selection,
		});

		expect(resolved).toEqual({
			target: { kind: "heading", heading: "Next steps", alias: "Next steps" },
			reason: null,
		});
		const plan = planLocationLink(resolved.target!, new Set(), () => "unused");
		expect(plan).toEqual({ subpath: "#Next steps" });
	});

	it("does not add a heading alias without a selection and copies the full vault path", () => {
		const content = "## Plugins close to ready for Obsidian Community Store\n";
		const heading = "Plugins close to ready for Obsidian Community Store";
		const note = new MockTFile({
			path: "Obsidian/My Plugins/My Plugin Ideas for Obsidian and Others.md",
		});
		const cache: CachedMetadata = {
			headings: [
				{
					heading,
					level: 2,
					position: position(content, 0, content.length - 1),
				},
			],
		};
		const resolved = resolveLocation({
			content,
			cache,
			cursor: { line: 0, ch: 10 },
		});
		expect(resolved.target).toEqual({ kind: "heading", heading, alias: undefined });

		const plan = planLocationLink(resolved.target!, new Set(), () => "unused");
		const wikiGenerator = fileLinkGenerator(true);
		expect(
			generateLocationLink(
				note as unknown as TFile,
				wikiGenerator,
				plan!.subpath,
				resolved.target!.alias
			)
		).toBe(
			"[[Obsidian/My Plugins/My Plugin Ideas for Obsidian and Others.md#Plugins close to ready for Obsidian Community Store]]"
		);
		expect(wikiGenerator.generateMarkdownLink).toHaveBeenCalledWith(
			note,
			"",
			`#${heading}`,
			undefined
		);

		const markdownGenerator = fileLinkGenerator(false);
		generateLocationLink(
			note as unknown as TFile,
			markdownGenerator,
			`#${heading}`,
		);
		expect(markdownGenerator.generateMarkdownLink).toHaveBeenCalledWith(
			note,
			"",
			`#${heading}`,
			undefined
		);
	});

	it("uses the selected heading text as the alias while keeping the heading target", () => {
		const content = "## Plugins close to ready for Obsidian Community Store\n";
		const heading = "Plugins close to ready for Obsidian Community Store";
		const note = new MockTFile({
			path: "Obsidian/My Plugins/My Plugin Ideas for Obsidian and Others.md",
		});
		const cache: CachedMetadata = {
			headings: [
				{
					heading,
					level: 2,
					position: position(content, 0, content.length - 1),
				},
			],
		};
		const selection = {
			from: { line: 0, ch: 11 },
			to: { line: 0, ch: 25 },
			text: "close to ready",
		};
		const resolved = resolveLocation({
			content,
			cache,
			cursor: { line: 0, ch: 10 },
			selection,
		});
		expect(resolved.target).toEqual({
			kind: "heading",
			heading,
			alias: "close to ready",
		});

		const plan = planLocationLink(resolved.target!, new Set(), () => "unused");
		expect(
			generateLocationLink(
				note as unknown as TFile,
				fileLinkGenerator(true),
				plan!.subpath,
				resolved.target!.alias
			)
		).toBe(
			"[[Obsidian/My Plugins/My Plugin Ideas for Obsidian and Others.md#Plugins close to ready for Obsidian Community Store |close to ready]]"
		);
	});

	it("generates heading links with aliases through Obsidian's configured formatter", () => {
		const note = new MockTFile({ path: "Project plan.md" });
		const wikiLink = generateFileLink(
			note as unknown as TFile,
			fileLinkGenerator(true),
			note.path,
			"#Next steps",
			"Next steps"
		);
		const markdownLink = generateFileLink(
			note as unknown as TFile,
			fileLinkGenerator(false),
			note.path,
			"#Next steps",
			"Next steps"
		);

		expect(wikiLink).toBe("[[Project plan#Next steps|Next steps]]");
		expect(markdownLink).toBe("[Next steps](Project%20plan.md#Next%20steps)");
	});

	it("reuses the parser's existing block ID instead of inserting another", () => {
		const content = "A paragraph ^kept\n";
		const cache: CachedMetadata = {
			sections: [
				{
					type: "paragraph",
					id: "kept",
					position: position(content, 0, content.length - 1),
				},
			],
			blocks: {
				kept: {
					id: "kept",
					position: position(content, 12, 17),
				},
			},
		};
		const resolved = resolveLocation({
			content,
			cache,
			cursor: { line: 0, ch: 4 },
		});
		const createId = vi.fn(() => "new-id");

		expect(resolved.target).toEqual({
			kind: "block",
			blockId: "kept",
			alias: undefined,
		});
		expect(planLocationLink(resolved.target!, knownBlockIds(cache), createId)).toEqual({
			subpath: "#^kept",
		});
		expect(createId).not.toHaveBeenCalled();
	});

	it("plans a new paragraph ID at the parser-verified end of its block", () => {
		const content = "A paragraph\n";
		const cache: CachedMetadata = {
			sections: [
				{
					type: "paragraph",
					position: position(content, 0, content.length - 1),
				},
			],
		};
		const resolved = resolveLocation({
			content,
			cache,
			cursor: { line: 0, ch: 4 },
		});
		const plan = planLocationLink(resolved.target!, new Set(), () => "fresh-1");

		expect(plan).toEqual({
			subpath: "#^fresh-1",
			insertion: { position: { line: 0, ch: 11 }, text: " ^fresh-1" },
		});
	});

	it("targets a single list item, not its containing list, when adding an ID", () => {
		const content = "- [ ] Review the proposal\n";
		const cache: CachedMetadata = {
			listItems: [
				{
					parent: -1,
					task: " ",
					position: position(content, 0, content.length - 1),
				},
			],
		};
		const resolved = resolveLocation({
			content,
			cache,
			cursor: { line: 0, ch: 9 },
		});
		const plan = planLocationLink(resolved.target!, new Set(), () => "task-id");

		expect(resolved.target?.kind).toBe("block");
		expect(plan).toEqual({
			subpath: "#^task-id",
			insertion: { position: { line: 0, ch: 25 }, text: " ^task-id" },
		});
	});

	it("places a selected embedded image's ID at the parser-defined end of its multiline list item", () => {
		const content = "- A parent item\n  continuation ![[diagram.png|Diagram]]\n";
		const embedStart = content.indexOf("![[");
		const embedEnd = content.indexOf("]]", embedStart) + 2;
		const cache: CachedMetadata = {
			listItems: [
				{
					parent: -1,
					task: undefined,
					position: position(content, 0, content.length - 1),
				},
			],
			embeds: [
				{
					link: "diagram.png",
					displayText: "Diagram",
					original: "![[diagram.png|Diagram]]",
					position: position(content, embedStart, embedEnd),
				},
			],
		};
		const resolved = resolveLocation({
			content,
			cache,
			cursor: { line: 1, ch: embedStart - content.indexOf("\n") - 1 },
			selection: {
				from: {
					line: 1,
					ch: embedStart - content.indexOf("\n") - 1,
				},
				to: {
					line: 1,
					ch: embedEnd - content.indexOf("\n") - 1,
				},
				text: content.slice(embedStart, embedEnd),
			},
		});
		const plan = planLocationLink(resolved.target!, new Set(), () => "nested-id");

		expect(resolved.target).toMatchObject({ kind: "block", alias: "Diagram" });
		expect(plan).toEqual({
			subpath: "#^nested-id",
			insertion: { position: { line: 1, ch: content.split("\n")[1].length }, text: " ^nested-id" },
		});
	});

	it("adds a blockquote ID within the final quoted line", () => {
		const content = "> A quoted paragraph\n";
		const cache: CachedMetadata = {
			sections: [
				{
					type: "blockquote",
					position: position(content, 0, content.length - 1),
				},
			],
		};
		const resolved = resolveLocation({
			content,
			cache,
			cursor: { line: 0, ch: 5 },
		});
		const plan = planLocationLink(resolved.target!, new Set(), () => "quote-id");

		expect(resolved.target?.kind).toBe("block");
		expect(plan?.insertion).toEqual({
			position: { line: 0, ch: 20 },
			text: " ^quote-id",
		});
	});

	it("maps a selected table row to the whole table and aliases the selected text", () => {
		const content = "| Name | Value |\n| --- | --- |\n| A | One |\n";
		const tableEnd = content.length - 1;
		const rowStart = content.indexOf("| A");
		const rowEnd = content.indexOf("\n", rowStart);
		const cache: CachedMetadata = {
			sections: [
				{
					type: "table",
					position: position(content, 0, tableEnd),
				},
			],
		};
		const row = content.slice(rowStart, rowEnd);
		const rowPosition = position(content, rowStart, rowEnd);
		const rowStartLoc = { line: rowPosition.start.line, ch: rowPosition.start.col };
		const rowEndLoc = { line: rowPosition.end.line, ch: rowPosition.end.col };
		const resolved = resolveLocation({
			content,
			cache,
			cursor: rowStartLoc,
			selection: { from: rowStartLoc, to: rowEndLoc, text: row },
		});

		expect(resolved.target).toEqual({
			kind: "table",
			alias: row,
			insertion: { position: { line: 2, ch: 11 }, style: "separate-line" },
		});
		expect(planLocationLink(resolved.target!, new Set(), () => "table-id")).toEqual({
			subpath: "#^table-id",
			insertion: { position: { line: 2, ch: 11 }, text: "\n^table-id" },
		});
	});

	it("adds a table ID after existing trailing whitespace without an empty spacer line", () => {
		const content = "| A | One |   ";
		const tableEnd = content.indexOf("   ");
		const cache: CachedMetadata = {
			sections: [{ type: "table", position: position(content, 0, tableEnd) }],
		};
		const resolved = resolveLocation({
			content,
			cache,
			cursor: { line: 0, ch: 4 },
		});
		const plan = planLocationLink(resolved.target!, new Set(), () => "table-id");

		expect(plan).toEqual({
			subpath: "#^table-id",
			insertion: { position: { line: 0, ch: content.length }, text: "\n^table-id" },
		});
		expect(content + plan!.insertion!.text).toBe("| A | One |   \n^table-id");
	});

	it("fails closed for a multi-row table selection whose alias would contain line breaks", () => {
		const content = "| A | One |\n| B | Two |\n";
		const from = 0;
		const to = content.length - 1;
		const cache: CachedMetadata = {
			sections: [{ type: "table", position: position(content, from, to) }],
		};
		const selected = content.slice(from, to);
		const resolved = resolveLocation({
			content,
			cache,
			cursor: { line: 0, ch: 0 },
			selection: {
				from: { line: 0, ch: 0 },
				to: { line: 1, ch: 11 },
				text: selected,
			},
		});

		expect(resolved.target).toBeNull();
		expect(resolved.reason).toContain("multi-line alias");
	});

	it("fails closed for text spanning two parser blocks", () => {
		const content = "First paragraph\n\nSecond paragraph\n";
		const firstEnd = content.indexOf("\n");
		const secondStart = content.indexOf("Second");
		const secondEnd = content.length - 1;
		const cache: CachedMetadata = {
			sections: [
				{ type: "paragraph", position: position(content, 0, firstEnd) },
				{ type: "paragraph", position: position(content, secondStart, secondEnd) },
			],
		};
		const from = { line: 0, ch: 0 };
		const to = { line: 2, ch: content.split("\n")[2].length };
		const resolved = resolveLocation({
			content,
			cache,
			cursor: from,
			selection: {
				from,
				to,
				text: content.slice(0, secondEnd),
			},
		});

		expect(resolved.target).toBeNull();
		expect(resolved.reason).toContain("wholly within one");
	});

	it("uses normal selected text as an alias and image alt text instead of embed syntax", () => {
		const content = "Read this ![[diagram.png|Diagram]] carefully.\n";
		const embedStart = content.indexOf("![[");
		const embedEnd = content.indexOf("]]", embedStart) + 2;
		const cache: CachedMetadata = {
			sections: [{ type: "paragraph", position: position(content, 0, content.length - 1) }],
			embeds: [
				{
					link: "diagram.png",
					displayText: "Diagram",
					original: "![[diagram.png|Diagram]]",
					position: position(content, embedStart, embedEnd),
				},
			],
		};
		const normal = resolveLocation({
			content,
			cache,
			cursor: { line: 0, ch: 1 },
			selection: {
				from: { line: 0, ch: 0 },
				to: { line: 0, ch: 4 },
				text: "Read",
			},
		});
		const objectSelection = {
			from: { line: 0, ch: embedStart },
			to: { line: 0, ch: embedEnd },
			text: content.slice(embedStart, embedEnd),
		};
		const embedded = resolveLocation({
			content,
			cache,
			cursor: objectSelection.from,
			selection: objectSelection,
		});

		expect(normal.target?.alias).toBe("Read");
		expect(embedded.target).toMatchObject({ kind: "block", alias: "Diagram" });
		const plan = planLocationLink(embedded.target!, new Set(), () => "embed-id");
		expect(plan).toMatchObject({
			subpath: "#^embed-id",
			insertion: { position: { line: 0, ch: content.trimEnd().length } },
		});
		expect(
			generateLocationLink(
				new MockTFile({ path: "Notes/Embedding.md" }) as unknown as TFile,
				fileLinkGenerator(true),
				plan!.subpath,
				embedded.target!.alias
			)
		).toBe("[[Notes/Embedding.md#^embed-id |Diagram]]");
	});

	it("uses an image filename when metadata has no alt text", () => {
		const content = "![](assets/diagram%20one.PNG)\n";
		const from = content.indexOf("![");
		const to = content.indexOf("\n");
		const resolved = resolveLocation({
			content,
			cache: {
				sections: [{ type: "paragraph", position: position(content, 0, to) }],
				embeds: [
					{
						link: "assets/diagram%20one.PNG",
						original: "![](assets/diagram%20one.PNG)",
						position: position(content, from, to),
					},
				],
			},
			cursor: { line: 0, ch: from },
			selection: {
				from: { line: 0, ch: from },
				to: { line: 0, ch: to },
				text: content.slice(from, to),
			},
		});

		expect(resolved.target).toMatchObject({ kind: "block", alias: "diagram one" });
	});

	it("targets an embedded non-image attachment's host block without using syntax as an alias", () => {
		const content = "Read ![[Reference.pdf#page=3]] here.\n";
		const embedStart = content.indexOf("![[");
		const embedEnd = content.indexOf("]]", embedStart) + 2;
		const selection = {
			from: { line: 0, ch: embedStart },
			to: { line: 0, ch: embedEnd },
			text: content.slice(embedStart, embedEnd),
		};
		const resolved = resolveLocation({
			content,
			cache: {
				sections: [
					{
						type: "paragraph",
						id: "host-block",
						position: position(content, 0, content.length - 1),
					},
				],
				embeds: [
					{
						link: "Reference.pdf#page=3",
						original: "![[Reference.pdf#page=3]]",
						position: position(content, embedStart, embedEnd),
					},
				],
			},
			cursor: selection.from,
			selection,
		});

		expect(resolved.target).toEqual({
			kind: "block",
			blockId: "host-block",
			alias: undefined,
		});
	});

	it("resolves a source cursor in an embed token to its host block without an alias", () => {
		const content = "Before ![[chart.png]] after\n";
		const embedStart = content.indexOf("![[");
		const embedEnd = content.indexOf("]]", embedStart) + 2;
		const resolved = resolveLocation({
			content,
			cache: {
				sections: [
					{
						type: "paragraph",
						id: "chart-host",
						position: position(content, 0, content.length - 1),
					},
				],
				embeds: [
					{
						link: "chart.png",
						original: "![[chart.png]]",
						position: position(content, embedStart, embedEnd),
					},
				],
			},
			cursor: { line: 0, ch: embedStart + 5 },
		});

		expect(resolved.target).toEqual({
			kind: "block",
			blockId: "chart-host",
			alias: undefined,
		});
	});

	it("fails closed for mixed text/embed or multiple overlapping embed selections", () => {
		const content = "Start ![[image.png]] end\n";
		const embedStart = content.indexOf("![[");
		const embedEnd = content.indexOf("]]", embedStart) + 2;
		const embed = {
			link: "image.png",
			original: "![[image.png]]",
			position: position(content, embedStart, embedEnd),
		};
		const cache: CachedMetadata = {
			sections: [{ type: "paragraph", position: position(content, 0, content.length - 1) }],
			embeds: [embed],
		};
		const mixedSelection = resolveLocation({
			content,
			cache,
			cursor: { line: 0, ch: 0 },
			selection: {
				from: { line: 0, ch: 0 },
				to: { line: 0, ch: embedEnd },
				text: content.slice(0, embedEnd),
			},
		});
		const duplicateEmbedSelection = resolveLocation({
			content,
			cache: { ...cache, embeds: [embed, embed] },
			cursor: { line: 0, ch: embedStart },
			selection: {
				from: { line: 0, ch: embedStart },
				to: { line: 0, ch: embedEnd },
				text: content.slice(embedStart, embedEnd),
			},
		});

		expect(mixedSelection.target).toBeNull();
		expect(mixedSelection.reason).toContain("mixed text/embed");
		expect(duplicateEmbedSelection.target).toBeNull();
		expect(duplicateEmbedSelection.reason).toContain("mixed text/embed");
	});

	it("fails closed for a partial embed selection", () => {
		const embedContent = "Before ![[chart.png]] after\n";
		const embedStart = embedContent.indexOf("![[");
		const embedEnd = embedContent.indexOf("]]", embedStart) + 2;
		const embed = resolveLocation({
			content: embedContent,
			cache: {
				sections: [
					{
						type: "paragraph",
						position: position(embedContent, 0, embedContent.length - 1),
					},
				],
				embeds: [
					{
						link: "chart.png",
						original: "![[chart.png]]",
						position: position(embedContent, embedStart, embedEnd),
					},
				],
			},
			cursor: { line: 0, ch: embedStart },
			selection: {
				from: { line: 0, ch: embedStart + 2 },
				to: { line: 0, ch: embedEnd },
				text: embedContent.slice(embedStart + 2, embedEnd),
			},
		});
		expect(embed.target).toBeNull();
		expect(embed.reason).toContain("mixed text/embed");
	});

	it("keeps Mermaid links restricted to the code body, not the fences", () => {
		const content = "```mermaid\ngraph TD\n```";
		const cache: CachedMetadata = {
			sections: [{ type: "code", position: position(content, 0, content.length) }],
		};
		const body = resolveLocation({
			content,
			cache,
			cursor: { line: 1, ch: 3 },
		});
		const openingFence = resolveLocation({
			content,
			cache,
			cursor: { line: 0, ch: 1 },
		});
		const closingFence = resolveLocation({
			content,
			cache,
			cursor: { line: 2, ch: 1 },
		});

		expect(body.target).toMatchObject({
			kind: "block",
			insertion: {
				position: { line: 2, ch: 3 },
				style: "separate-line",
			},
		});
		expect(openingFence.target).toBeNull();
		expect(closingFence.target).toBeNull();
	});

	it("allows a code-block link from anywhere on either fence line", () => {
		const content = "```python\nif x == 1:\n    return\n```";
		const cache: CachedMetadata = {
			sections: [{ type: "code", position: position(content, 0, content.length) }],
		};
		const openingFence = resolveLocation({
			content,
			cache,
			cursor: { line: 0, ch: 0 },
		});
		const closingFence = resolveLocation({
			content,
			cache,
			cursor: { line: 3, ch: 0 },
		});
		const closingFenceOutsideEdge = resolveLocation({
			content,
			cache,
			cursor: { line: 3, ch: 3 },
		});
		const expected = {
			kind: "block",
			insertion: { position: { line: 3, ch: 3 }, style: "separate-line" },
		};

		expect(openingFence.target).toMatchObject(expected);
		expect(closingFence.target).toMatchObject(expected);
		expect(closingFenceOutsideEdge.target).toMatchObject(expected);
	});

	it("uses selected code text as the alias and places the block ID after the fence without a spacer line", () => {
		const content = "```ts\nconst answer = 42;\n```  ";
		const cache: CachedMetadata = {
			sections: [{ type: "code", position: position(content, 0, content.length) }],
		};
		const resolved = resolveLocation({
			content,
			cache,
			cursor: { line: 1, ch: 7 },
			selection: {
				from: { line: 1, ch: 6 },
				to: { line: 1, ch: 12 },
				text: "answer",
			},
		});

		expect(resolved.target).toMatchObject({
			kind: "block",
			alias: "answer",
			insertion: { position: { line: 2, ch: 5 }, style: "separate-line" },
		});
		const plan = planLocationLink(resolved.target!, new Set(), () => "code-id");
		expect(plan).toEqual({
			subpath: "#^code-id",
			insertion: { position: { line: 2, ch: 5 }, text: "\n^code-id" },
		});
		expect(content + plan!.insertion!.text).toBe(
			"```ts\nconst answer = 42;\n```  \n^code-id"
		);
	});

	it("reuses a cached ID for a fenced code block", () => {
		const content = "```js\nconsole.log(1)\n```\n\n^known";
		const sectionEnd = content.indexOf("```", 4) + 3;
		const cache: CachedMetadata = {
			sections: [
				{ type: "code", id: "known", position: position(content, 0, sectionEnd) },
			],
		};
		const resolved = resolveLocation({
			content,
			cache,
			cursor: { line: 1, ch: 4 },
		});

		expect(resolved.target).toMatchObject({ kind: "block", blockId: "known" });
		expect(planLocationLink(resolved.target!, knownBlockIds(cache), () => "unused")).toEqual({
			subpath: "#^known",
		});
	});

	it("fails closed when metadata is missing, stale, or headings are duplicated", () => {
		const content = "# Same\n\n# Same\n";
		const duplicated = resolveLocation({
			content,
			cache: {
				headings: [
					{ heading: "Same", level: 1, position: position(content, 0, 5) },
					{ heading: "Same", level: 1, position: position(content, 8, 13) },
				],
			},
			cursor: { line: 0, ch: 3 },
		});
		const missing = resolveLocation({
			content,
			cache: null,
			cursor: { line: 0, ch: 3 },
		});
		const stalePosition = position(content, 0, 5);
		const stale = resolveLocation({
			content,
			cache: {
				sections: [
					{
						type: "paragraph",
						position: {
							...stalePosition,
							start: {
								...stalePosition.start,
								offset: stalePosition.start.offset + 1,
							},
						},
					},
				],
			},
			cursor: { line: 0, ch: 3 },
		});

		expect(duplicated.target).toBeNull();
		expect(duplicated.reason).toContain("duplicated");
		expect(missing.target).toBeNull();
		expect(missing.reason).toContain("has not indexed");
		expect(stale.target).toBeNull();
	});

	it("does not reuse a generated ID that is already present in metadata", () => {
		const target = {
			kind: "block" as const,
			insertion: { position: { line: 0, ch: 4 }, style: "inline" as const },
		};
		const ids = new Set(["collision"]);
		const createId = vi.fn().mockReturnValueOnce("collision").mockReturnValueOnce("unique");

		expect(planLocationLink(target, ids, createId)).toEqual({
			subpath: "#^unique",
			insertion: { position: { line: 0, ch: 4 }, text: " ^unique" },
		});
		expect(createId).toHaveBeenCalledTimes(2);
	});
});
