import { describe, it, expect } from "vitest";
import {
	determineLinkOperation,
	determineLinkOperationWithSelection,
	determineSkipPosition,
	EditorContext,
	EditorContextWithSelection,
	LinkOperation,
	SkipLinkContext,
} from "./linkOperations";
import {
	createEditorContext,
	createEditorContextOnWikiLink,
	createEditorContextOnMarkdownLink,
	createEditorContextOnUrl,
} from "./factories";

// ============================================================================
// determineLinkOperation Tests
// ============================================================================

describe("determineLinkOperation", () => {
	describe("existing link detection", () => {
		it("should detect an existing wiki link at cursor", () => {
			const context = createEditorContextOnWikiLink({ cursorCh: 15 });
			const result = determineLinkOperation(context);

			expect(result).not.toBeNull();
			expect(result!.isNewLink).toBe(false);
			expect(result!.link.isWiki).toBe(true);
			expect(result!.link.destination).toBe("my-note");
			expect(result!.link.text).toBe("My Note");
		});

		it("should detect an existing markdown link at cursor", () => {
			const context = createEditorContextOnMarkdownLink({ cursorCh: 15 });
			const result = determineLinkOperation(context);

			expect(result).not.toBeNull();
			expect(result!.isNewLink).toBe(false);
			expect(result!.link.isWiki).toBe(false);
			expect(result!.link.destination).toBe("https://example.com");
			expect(result!.link.text).toBe("here");
		});

		it("should detect embed wiki links", () => {
			const context = createEditorContext({
				lineText: "Embed: ![[image.png]]",
				cursorCh: 12,
			});
			const result = determineLinkOperation(context);

			expect(result).not.toBeNull();
			expect(result!.link.isEmbed).toBe(true);
		});

		it("should detect embed markdown links", () => {
			const context = createEditorContext({
				lineText: "Embed: ![alt](image.png)",
				cursorCh: 12,
			});
			const result = determineLinkOperation(context);

			expect(result).not.toBeNull();
			expect(result!.link.isEmbed).toBe(true);
		});

		it("should create new link when cursor outside any link", () => {
			const context = createEditorContext({
				lineText: "This is plain text with no links",
				cursorCh: 10,
			});
			const result = determineLinkOperation(context);

			// When there's no existing link, it creates a new one
			expect(result).not.toBeNull();
			expect(result!.isNewLink).toBe(true);
		});
	});

	describe("new link creation", () => {
		it("should create new link when no existing link and no context", () => {
			const context = createEditorContext({
				lineText: "Plain text line",
				cursorCh: 6,
				selection: "",
				clipboardText: "",
			});
			const result = determineLinkOperation(context);

			// When there's no context, it creates an empty link
			expect(result).not.toBeNull();
			expect(result!.isNewLink).toBe(true);
			expect(result!.start).toBe(6);
			expect(result!.end).toBe(6);
		});

		it("should use clipboard URL for new link", () => {
			const context = createEditorContext({
				lineText: "Plain text",
				cursorCh: 5,
				selection: "",
				clipboardText: "https://example.com",
			});
			const result = determineLinkOperation(context);

			expect(result).not.toBeNull();
			expect(result!.isNewLink).toBe(true);
			expect(result!.link.destination).toBe("https://example.com");
			expect(result!.link.isWiki).toBe(false); // URLs force markdown
		});

		it("should use selection as link text", () => {
			const context = createEditorContext({
				lineText: "Click here for more info",
				cursorCh: 6,
				selection: "here",
				clipboardText: "https://example.com",
			});
			const result = determineLinkOperation(context);

			expect(result).not.toBeNull();
			expect(result!.isNewLink).toBe(true);
			expect(result!.link.text).toBe("here");
			expect(result!.link.destination).toBe("https://example.com");
		});

		it("should detect URL at cursor position", () => {
			const context = createEditorContextOnUrl();
			const result = determineLinkOperation(context);

			expect(result).not.toBeNull();
			expect(result!.isNewLink).toBe(true);
			expect(result!.link.destination).toBe("https://example.com");
			expect(result!.shouldSelectText).toBe(true);
		});

		it("should normalize www URLs", () => {
			const context = createEditorContext({
				lineText: "Visit www.example.com today",
				cursorCh: 8,
				selection: "",
				clipboardText: "",
			});
			const result = determineLinkOperation(context);

			expect(result).not.toBeNull();
			expect(result!.link.destination).toBe("https://www.example.com");
		});

		it("should use clipboard link for new link", () => {
			const context = createEditorContext({
				lineText: "Plain text",
				cursorCh: 5,
				selection: "",
				clipboardText: "[[other-note|Other Note]]",
			});
			const result = determineLinkOperation(context);

			expect(result).not.toBeNull();
			expect(result!.isNewLink).toBe(true);
			expect(result!.link.text).toBe("Other Note");
			expect(result!.link.destination).toBe("other-note");
			expect(result!.link.isWiki).toBe(true);
		});
	});

	describe("enteredFromLeft detection", () => {
		it("should set enteredFromLeft true when cursor in left half of link", () => {
			const context = createEditorContext({
				lineText: "[[my-note|My Note]]",
				cursorCh: 5, // Left half
			});
			const result = determineLinkOperation(context);

			expect(result!.enteredFromLeft).toBe(true);
		});

		it("should set enteredFromLeft false when cursor in right half of link", () => {
			const context = createEditorContext({
				lineText: "[[my-note|My Note]]",
				cursorCh: 15, // Right half
			});
			const result = determineLinkOperation(context);

			expect(result!.enteredFromLeft).toBe(false);
		});
	});
});

// ============================================================================
// determineLinkOperationWithSelection Tests
// ============================================================================

describe("determineLinkOperationWithSelection", () => {
	it("should use selection range for start/end when selection exists", () => {
		const context: EditorContextWithSelection = {
			cursorLine: 0,
			cursorCh: 10,
			lineText: "Click here for more",
			selection: "here",
			clipboardText: "https://example.com",
			hasSelection: true,
			selectionFrom: { line: 0, ch: 6 },
			selectionTo: { line: 0, ch: 10 },
		};

		const result = determineLinkOperationWithSelection(context);

		expect(result).not.toBeNull();
		expect(result!.start).toBe(6);
		expect(result!.end).toBe(10);
		expect(result!.link.text).toBe("here");
	});

	it("should handle no selection", () => {
		const context: EditorContextWithSelection = {
			cursorLine: 0,
			cursorCh: 5,
			lineText: "Plain text",
			selection: "",
			clipboardText: "",
			hasSelection: false,
		};

		const result = determineLinkOperationWithSelection(context);

		expect(result).not.toBeNull();
		expect(result!.start).toBe(5);
		expect(result!.end).toBe(5);
	});
});

// ============================================================================
// determineSkipPosition Tests
// ============================================================================

describe("determineSkipPosition", () => {
	function createSkipContext(overrides: Partial<SkipLinkContext> = {}): SkipLinkContext {
		return {
			cursorLine: 0,
			cursorCh: 10,
			lineText: "Check [[my-note]] for more",
			lineCount: 10,
			prevLineLength: 20,
			...overrides,
		};
	}

	describe("no link at cursor", () => {
		it("should return same position when no link", () => {
			const context = createSkipContext({
				lineText: "Plain text with no links",
				cursorCh: 10,
			});
			const result = determineSkipPosition(context);

			expect(result.skipped).toBe(false);
			expect(result.position).toEqual({ line: 0, ch: 10 });
		});
	});

	describe("cursor on left side of link", () => {
		it("should skip to right of link", () => {
			const context = createSkipContext({
				lineText: "Check [[my-note]] for more",
				cursorCh: 8, // Left side of link
			});
			const result = determineSkipPosition(context);

			expect(result.skipped).toBe(true);
			// Link is [[my-note]] which is 12 chars, starts at 6, ends at 18
			expect(result.position).toEqual({ line: 0, ch: 18 }); // After ]]
		});

		it("should skip to next line when link at end of line", () => {
			const context = createSkipContext({
				lineText: "Check [[my-note]]",
				cursorCh: 8,
				lineCount: 5,
			});
			const result = determineSkipPosition(context);

			expect(result.skipped).toBe(true);
			expect(result.position).toEqual({ line: 1, ch: 0 });
		});
	});

	describe("cursor on right side of link", () => {
		it("should skip to left of link", () => {
			const context = createSkipContext({
				lineText: "Check [[my-note]] for more",
				cursorCh: 15, // Right side of link
			});
			const result = determineSkipPosition(context);

			expect(result.skipped).toBe(true);
			expect(result.position).toEqual({ line: 0, ch: 5 }); // Before [[
		});

		it("should skip to previous line when link at start of line", () => {
			const context = createSkipContext({
				lineText: "[[my-note]] for more",
				cursorCh: 10,
				cursorLine: 3,
				prevLineLength: 15,
			});
			const result = determineSkipPosition(context);

			expect(result.skipped).toBe(true);
			expect(result.position).toEqual({ line: 2, ch: 15 });
		});
	});

	describe("link spans entire line", () => {
		it("should skip to next line when on left side", () => {
			const context = createSkipContext({
				lineText: "[[my-note]]",
				cursorCh: 5,
				cursorLine: 3,
				lineCount: 10,
			});
			const result = determineSkipPosition(context);

			expect(result.skipped).toBe(true);
			expect(result.position).toEqual({ line: 4, ch: 0 });
		});

		it("should skip to previous line when on right side", () => {
			const context = createSkipContext({
				lineText: "[[my-note]]",
				cursorCh: 8,
				cursorLine: 3,
				lineCount: 10,
				prevLineLength: 25,
			});
			const result = determineSkipPosition(context);

			expect(result.skipped).toBe(true);
			expect(result.position).toEqual({ line: 2, ch: 25 });
		});

		it("should handle single line document", () => {
			const context = createSkipContext({
				lineText: "[[my-note]]",
				cursorCh: 5,
				cursorLine: 0,
				lineCount: 1,
			});
			const result = determineSkipPosition(context);

			expect(result.skipped).toBe(true);
			// Best effort - end of link
			expect(result.position.line).toBe(0);
		});
	});

	describe("cursor at exact center", () => {
		it("should treat center as left side (skip right)", () => {
			// Link from 6 to 17, center at 11.5
			const context = createSkipContext({
				lineText: "Test [[link]] end",
				cursorCh: 11, // At or before center
			});
			const result = determineSkipPosition(context);

			expect(result.skipped).toBe(true);
			// Link is [[link]] which is 8 chars, starts at 5, ends at 13
			// Center is at 9, so cursor at 11 is on right side
			expect(result.position.ch).toBe(4); // Skipped left
		});
	});
});
