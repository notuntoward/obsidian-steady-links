/**
 * Test Data Factories
 * 
 * These factories create consistent test data objects with sensible defaults,
 * reducing boilerplate in tests and ensuring consistency across the test suite.
 */

import { LinkInfo, SuggestionItem, PluginSettings } from '../src/types';
import type { HiddenRange } from '../src/linkSyntaxHider';

// ============================================================================
// Link Factories
// ============================================================================

/**
 * Create a LinkInfo object with sensible defaults
 */
export function createLink(overrides: Partial<LinkInfo> = {}): LinkInfo {
  return {
    text: 'Example Link',
    destination: 'example-note',
    isWiki: true,
    isEmbed: false,
    ...overrides,
  };
}

/**
 * Create a URL-based LinkInfo (Markdown format)
 */
export function createUrlLink(overrides: Partial<LinkInfo> = {}): LinkInfo {
  return createLink({
    text: 'https://example.com',
    destination: 'https://example.com',
    isWiki: false,
    ...overrides,
  });
}

/**
 * Create a WikiLink with display text different from destination
 */
export function createWikiLinkWithDisplay(overrides: Partial<LinkInfo> = {}): LinkInfo {
  return createLink({
    text: 'Display Text',
    destination: 'note-file',
    isWiki: true,
    ...overrides,
  });
}

/**
 * Create a Markdown link with separate text and destination
 */
export function createMarkdownLink(overrides: Partial<LinkInfo> = {}): LinkInfo {
  return createLink({
    text: 'Click Here',
    destination: 'https://example.com/path',
    isWiki: false,
    ...overrides,
  });
}

/**
 * Create an embed link (image or transclusion)
 */
export function createEmbedLink(overrides: Partial<LinkInfo> = {}): LinkInfo {
  return createLink({
    text: 'image.png',
    destination: 'attachments/image.png',
    isWiki: true,
    isEmbed: true,
    ...overrides,
  });
}

// ============================================================================
// SuggestionItem Factories
// ============================================================================

/**
 * Create a file suggestion item
 */
export function createFileSuggestion(overrides: Partial<SuggestionItem> = {}): SuggestionItem {
  return {
    type: 'file',
    basename: 'Example Note',
    path: 'folder/example-note.md',
    name: 'example-note.md',
    extension: 'md',
    displayPath: 'folder/',
    ...overrides,
  };
}

/**
 * Create a heading suggestion item
 */
export function createHeadingSuggestion(overrides: Partial<SuggestionItem> = {}): SuggestionItem {
  return {
    type: 'heading',
    heading: 'Introduction',
    level: 1,
    ...overrides,
  };
}

/**
 * Create a block suggestion item
 */
export function createBlockSuggestion(overrides: Partial<SuggestionItem> = {}): SuggestionItem {
  return {
    type: 'block',
    blockId: 'abc123',
    blockText: 'This is a paragraph with a block ID',
    ...overrides,
  };
}

/**
 * Create an alias suggestion item
 */
export function createAliasSuggestion(overrides: Partial<SuggestionItem> = {}): SuggestionItem {
  return {
    type: 'alias',
    alias: 'My Note Alias',
    basename: 'actual-note-name',
    path: 'notes/actual-note-name.md',
    ...overrides,
  };
}

// ============================================================================
// Settings Factories
// ============================================================================

/**
 * Create plugin settings with defaults
 */
export function createSettings(overrides: Partial<PluginSettings> = {}): PluginSettings {
  return {
    keepLinksSteady: false,
    ...overrides,
  };
}

// ============================================================================
// HiddenRange Factories (for linkSyntaxHider tests)
// ============================================================================

/**
 * Create a hidden range for testing cursor correction
 */
export function createHiddenRange(overrides: Partial<HiddenRange> = {}): HiddenRange {
  return {
    from: 5,
    to: 10,
    side: 'leading',
    ...overrides,
  };
}

/**
 * Create a leading hidden range (before link text)
 */
export function createLeadingRange(overrides: Partial<HiddenRange> = {}): HiddenRange {
  return createHiddenRange({
    from: 0,
    to: 2,
    side: 'leading',
    ...overrides,
  });
}

/**
 * Create a trailing hidden range (after link text)
 */
export function createTrailingRange(overrides: Partial<HiddenRange> = {}): HiddenRange {
  return createHiddenRange({
    from: 10,
    to: 12,
    side: 'trailing',
    ...overrides,
  });
}

// ============================================================================
// Editor Context Factories
// ============================================================================

/**
 * Context for testing link operations
 */
export interface EditorContext {
  cursorLine: number;
  cursorCh: number;
  lineText: string;
  selection: string;
  clipboardText: string;
}

/**
 * Create an editor context for testing
 */
export function createEditorContext(overrides: Partial<EditorContext> = {}): EditorContext {
  return {
    cursorLine: 0,
    cursorCh: 0,
    lineText: 'This is a line of text',
    selection: '',
    clipboardText: '',
    ...overrides,
  };
}

/**
 * Create an editor context with cursor on a wiki link
 */
export function createEditorContextOnWikiLink(overrides: Partial<EditorContext> = {}): EditorContext {
  return createEditorContext({
    lineText: 'Check out [[my-note|My Note]] for more info',
    cursorCh: 12, // Inside the link
    ...overrides,
  });
}

/**
 * Create an editor context with cursor on a markdown link
 */
export function createEditorContextOnMarkdownLink(overrides: Partial<EditorContext> = {}): EditorContext {
  return createEditorContext({
    lineText: 'Click [here](https://example.com) for details',
    cursorCh: 10, // Inside the link
    ...overrides,
  });
}

/**
 * Create an editor context with a URL at cursor
 */
export function createEditorContextOnUrl(overrides: Partial<EditorContext> = {}): EditorContext {
  return createEditorContext({
    lineText: 'Visit https://example.com today',
    cursorCh: 10, // On the URL
    ...overrides,
  });
}

// ============================================================================
// Modal State Factories
// ============================================================================

/**
 * State for testing modal behavior
 */
export interface ModalState {
  text: string;
  destination: string;
  isWiki: boolean;
  isEmbed: boolean;
  originalText: string;
  originalDestination: string;
  clipboardUsedText: boolean;
  clipboardUsedDest: boolean;
}

/**
 * Create modal state for testing
 */
export function createModalState(overrides: Partial<ModalState> = {}): ModalState {
  const text = overrides.text ?? 'Link Text';
  const destination = overrides.destination ?? 'note-file';
  return {
    text,
    destination,
    isWiki: true,
    isEmbed: false,
    originalText: text,
    originalDestination: destination,
    clipboardUsedText: false,
    clipboardUsedDest: false,
    ...overrides,
  };
}

// ============================================================================
// Cursor Position Factories
// ============================================================================

/**
 * Create a cursor position
 */
export function createCursor(line: number = 0, ch: number = 0): { line: number; ch: number } {
  return { line, ch };
}

/**
 * Create cursor params for close cursor position tests
 */
export interface CloseCursorParams {
  linkStart: number;
  linkEnd: number;
  lineLength: number;
  line: number;
  preferRight: boolean;
  lineCount: number;
  prevLineLength: number;
}

export function createCloseCursorParams(overrides: Partial<CloseCursorParams> = {}): CloseCursorParams {
  return {
    linkStart: 5,
    linkEnd: 20,
    lineLength: 30,
    line: 3,
    preferRight: false,
    lineCount: 10,
    prevLineLength: 15,
    ...overrides,
  };
}

/**
 * Create cursor params for skip cursor position tests
 */
export interface SkipCursorParams {
  linkStart: number;
  linkEnd: number;
  cursorPos: number;
  lineLength: number;
  line: number;
  lineCount: number;
  prevLineLength: number;
}

export function createSkipCursorParams(overrides: Partial<SkipCursorParams> = {}): SkipCursorParams {
  return {
    linkStart: 5,
    linkEnd: 20,
    cursorPos: 10,
    lineLength: 30,
    line: 3,
    lineCount: 10,
    prevLineLength: 15,
    ...overrides,
  };
}