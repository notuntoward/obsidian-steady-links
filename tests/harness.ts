/**
 * Test Harness Utilities
 *
 * Provides high-level utilities for setting up integration-style tests
 * with realistic editor, file, and application state.
 */

import { App, Editor, TFile, createTestApp, createMockEditor, EditorState } from './__mocks__/obsidian';
import { PluginSettings } from '../src/types';
import { createSettings } from './factories';
import { ClipboardService, createMockClipboard, MockClipboardOptions } from '../src/clipboard';

// ============================================================================
// Test Harness
// ============================================================================

/**
 * Complete test harness for plugin testing
 */
export interface TestHarness {
	/** The mock Obsidian App instance */
	app: App;
	/** The mock Editor instance */
	editor: Editor;
	/** The mock clipboard service */
	clipboard: ClipboardService & {
		getText(): string;
		setText(text: string): void;
		getWriteHistory(): string[];
	};
	/** Current plugin settings */
	settings: PluginSettings;

	// Editor state manipulation
	/** Set the content of a specific line */
	setLine(line: number, text: string): void;
	/** Set all lines in the editor */
	setLines(lines: string[]): void;
	/** Set the cursor position */
	setCursor(line: number, ch: number): void;
	/** Set a text selection */
	setSelection(from: { line: number; ch: number }, to: { line: number; ch: number }): void;
	/** Clear any selection */
	clearSelection(): void;

	// Clipboard manipulation
	/** Set clipboard content */
	setClipboard(text: string): void;

	// Settings manipulation
	/** Update settings */
	updateSettings(overrides: Partial<PluginSettings>): void;

	// File system manipulation
	/** Add a file to the vault */
	addFile(path: string, content?: string): TFile;
	/** Set the active file */
	setActiveFile(path: string): void;

	// Assertions
	/** Assert a line equals expected content */
	assertLineEquals(line: number, expected: string): void;
	/** Assert cursor position */
	assertCursorEquals(expected: { line: number; ch: number }): void;
	/** Assert selection range */
	assertSelectionEquals(from: { line: number; ch: number }, to: { line: number; ch: number }): void;
	/** Assert no selection */
	assertNoSelection(): void;
	/** Assert clipboard content */
	assertClipboardEquals(expected: string): void;

	// State retrieval
	/** Get current editor state snapshot */
	getEditorState(): EditorState;
	/** Get current line content */
	getLine(line: number): string;
	/** Get current cursor position */
	getCursor(): { line: number; ch: number };
}

/**
 * Options for creating a test harness
 */
export interface TestHarnessOptions {
	/** Initial editor lines */
	lines?: string[];
	/** Initial cursor position */
	cursor?: { line: number; ch: number };
	/** Initial selection */
	selection?: {
		from: { line: number; ch: number };
		to: { line: number; ch: number };
	};
	/** Initial clipboard content */
	clipboardText?: string;
	/** Initial settings */
	settings?: Partial<PluginSettings>;
	/** Files to add to vault */
	files?: Array<{ path: string; content?: string }>;
	/** Active file path */
	activeFilePath?: string;
}

/**
 * Create a complete test harness for plugin testing
 *
 * @example
 * ```ts
 * const harness = createTestHarness({
 *   lines: ['Check out [[my-note]] for more'],
 *   cursor: { line: 0, ch: 12 },
 *   clipboardText: 'https://example.com',
 * });
 *
 * // Test link detection
 * const result = determineLinkOperation({
 *   cursorLine: 0,
 *   cursorCh: 12,
 *   lineText: harness.getLine(0),
 *   selection: '',
 *   clipboardText: harness.clipboard.getText(),
 * });
 * ```
 */
export function createTestHarness(options: TestHarnessOptions = {}): TestHarness {
	// Create app with files
	const app = createTestApp({
		files: options.files,
		activeFile: options.activeFilePath,
	});

	// Create editor with initial state
	const editor = createMockEditor(options.lines ?? ['']);
	if (options.cursor) {
		editor.setCursor(options.cursor);
	}
	if (options.selection) {
		editor.setSelection(options.selection.from, options.selection.to);
	}

	// Set editor as active
	app.workspace.setActiveEditor(editor);

	// Create clipboard
	const clipboard = createMockClipboard({
		initialText: options.clipboardText ?? '',
	});

	// Create settings
	const settings = createSettings(options.settings);

	return {
		app,
		editor,
		clipboard,
		settings,

		// Editor manipulation
		setLine(line, text) {
			editor.setLine(line, text);
		},

		setLines(lines) {
			editor.setLines(lines);
		},

		setCursor(line, ch) {
			editor.setCursor({ line, ch });
		},

		setSelection(from, to) {
			editor.setSelection(from, to);
		},

		clearSelection() {
			const cursor = editor.getCursor();
			editor.setCursor(cursor);
		},

		// Clipboard manipulation
		setClipboard(text) {
			clipboard.setText(text);
		},

		// Settings manipulation
		updateSettings(overrides) {
			Object.assign(settings, overrides);
		},

		// File system manipulation
		addFile(path, content = '') {
			const file = new TFile({ path });
			app.vault.addFile(file, content);
			return file;
		},

		setActiveFile(path) {
			const file = app.vault.getAbstractFileByPath(path);
			if (file) {
				app.workspace.setActiveFile(file);
			}
		},

		// Assertions
		assertLineEquals(line, expected) {
			const actual = editor.getLine(line);
			if (actual !== expected) {
				throw new Error(`Line ${line} assertion failed:\n  Expected: "${expected}"\n  Actual:   "${actual}"`);
			}
		},

		assertCursorEquals(expected) {
			const actual = editor.getCursor();
			if (actual.line !== expected.line || actual.ch !== expected.ch) {
				throw new Error(`Cursor assertion failed:\n  Expected: ${JSON.stringify(expected)}\n  Actual:   ${JSON.stringify(actual)}`);
			}
		},

		assertSelectionEquals(from, to) {
			const cursor = editor.getCursor('from');
			const head = editor.getCursor('to');
			if (cursor.line !== from.line || cursor.ch !== from.ch || head.line !== to.line || head.ch !== to.ch) {
				throw new Error(`Selection assertion failed:\n  Expected: ${JSON.stringify(from)} to ${JSON.stringify(to)}`);
			}
		},

		assertNoSelection() {
			if (editor.somethingSelected()) {
				throw new Error('Expected no selection, but selection exists');
			}
		},

		assertClipboardEquals(expected) {
			const actual = clipboard.getText();
			if (actual !== expected) {
				throw new Error(`Clipboard assertion failed:\n  Expected: "${expected}"\n  Actual:   "${actual}"`);
			}
		},

		// State retrieval
		getEditorState() {
			return editor.getState();
		},

		getLine(line) {
			return editor.getLine(line);
		},

		getCursor() {
			return editor.getCursor();
		},
	};
}

// ============================================================================
// Specialized Harness Factories
// ============================================================================

/**
 * Create a harness pre-configured for link editing tests
 */
export function createLinkEditHarness(options: {
	/** Line with a link to edit */
	linkLine?: string;
	/** Cursor position within the link */
	cursorInLink?: number;
	/** Whether to position cursor on wiki link */
	onWikiLink?: boolean;
	/** Whether to position cursor on markdown link */
	onMarkdownLink?: boolean;
} = {}): TestHarness {
	let lines: string[];
	let cursorCh: number;

	if (options.linkLine) {
		lines = [options.linkLine];
		cursorCh = options.cursorInLink ?? 0;
	} else if (options.onWikiLink) {
		lines = ['Check out [[my-note|My Note]] for more info'];
		cursorCh = 12; // Inside the wiki link
	} else if (options.onMarkdownLink) {
		lines = ['Click [here](https://example.com) for details'];
		cursorCh = 10; // Inside the markdown link
	} else {
		lines = ['This is a plain text line'];
		cursorCh = 10;
	}

	return createTestHarness({
		lines,
		cursor: { line: 0, ch: cursorCh },
	});
}

/**
 * Create a harness pre-configured for file suggestion tests
 */
export function createFileSuggestHarness(options: {
	/** Files to add to vault */
	files?: Array<{ path: string; content?: string; metadata?: any }>;
	/** Active file path */
	activeFilePath?: string;
	/** Query text in the input */
	query?: string;
} = {}): TestHarness & { query: string } {
	const harness = createTestHarness({
		files: options.files ?? [
			{ path: 'notes/note1.md', content: '# Heading 1\n\nContent' },
			{ path: 'notes/note2.md', content: '# Another Note\n\n## Subheading' },
		],
		activeFilePath: options.activeFilePath ?? 'notes/note1.md',
	});

	return {
		...harness,
		query: options.query ?? '',
	};
}

// ============================================================================
// Assertion Helpers
// ============================================================================

/**
 * Assert that a value is not null or undefined
 */
export function assertDefined<T>(value: T | null | undefined, message?: string): asserts value is T {
	if (value === null || value === undefined) {
		throw new Error(message ?? 'Expected value to be defined');
	}
}

/**
 * Assert that a link info object matches expected values
 */
export function assertLinkEquals(
	actual: { text: string; destination: string; isWiki: boolean; isEmbed: boolean },
	expected: Partial<{ text: string; destination: string; isWiki: boolean; isEmbed: boolean }>
): void {
	if (expected.text !== undefined && actual.text !== expected.text) {
		throw new Error(`Link text mismatch: expected "${expected.text}", got "${actual.text}"`);
	}
	if (expected.destination !== undefined && actual.destination !== expected.destination) {
		throw new Error(`Link destination mismatch: expected "${expected.destination}", got "${actual.destination}"`);
	}
	if (expected.isWiki !== undefined && actual.isWiki !== expected.isWiki) {
		throw new Error(`Link isWiki mismatch: expected ${expected.isWiki}, got ${actual.isWiki}`);
	}
	if (expected.isEmbed !== undefined && actual.isEmbed !== expected.isEmbed) {
		throw new Error(`Link isEmbed mismatch: expected ${expected.isEmbed}, got ${actual.isEmbed}`);
	}
}