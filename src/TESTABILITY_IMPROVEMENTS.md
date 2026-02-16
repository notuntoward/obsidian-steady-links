# Testability Improvements for Steady Links

This document outlines recommended changes to improve the testability of the codebase, organized by priority and impact.

## Current State Assessment

### What's Working Well

1. **[`modalLogic.ts`](src/modalLogic.ts)** - Excellent separation of pure business logic from Obsidian API. All functions are easily testable with comprehensive tests in [`modalLogic.test.ts`](tests/modalLogic.test.ts).

2. **[`utils.ts`](src/utils.ts)** - Contains many pure functions for link parsing, validation, and URL handling. These are highly testable.

3. **[`linkSyntaxHider.ts`](src/linkSyntaxHider.ts)** - Core logic functions like `findMarkdownLinkSyntaxRanges`, `findWikiLinkSyntaxRanges`, `correctCursorPos`, and `listContinuation` are exported and testable.

4. **Mock Infrastructure** - Basic Obsidian API mock exists in [`tests/__mocks__/obsidian.ts`](tests/__mocks__/obsidian.ts).

---

## Priority 1: High Impact, Low Effort

### 1.1 Extract Editor Operations from `main.ts`

**Problem:** The `editorCallback` in [`main.ts`](src/main.ts:42-139) contains ~100 lines of business logic mixed with Obsidian API calls, making it impossible to unit test.

**Solution:** Extract the link detection and preparation logic into a pure function.

```typescript
// NEW FILE: src/linkOperations.ts

export interface EditorContext {
  cursorLine: number;
  cursorCh: number;
  lineText: string;
  selection: string;
  clipboardText: string;
}

export interface LinkOperation {
  link: LinkInfo;
  start: number;
  end: number;
  enteredFromLeft: boolean;
  isNewLink: boolean;
  shouldSelectText: boolean;
  conversionNotice: string | null;
}

export function determineLinkOperation(
  context: EditorContext
): LinkOperation | null {
  const { cursorCh, lineText, selection, clipboardText } = context;
  
  const existingLink = detectLinkAtCursor(lineText, cursorCh);
  
  if (existingLink) {
    return {
      link: existingLink.link,
      start: existingLink.start,
      end: existingLink.end,
      enteredFromLeft: existingLink.enteredFromLeft,
      isNewLink: false,
      shouldSelectText: false,
      conversionNotice: null,
    };
  }
  
  const cursorUrl = urlAtCursor(lineText, cursorCh);
  const linkContext = determineLinkFromContext({
    selection,
    clipboardText,
    cursorUrl,
    line: lineText,
    cursorCh,
  });
  
  return {
    link: {
      text: linkContext.text,
      destination: linkContext.destination,
      isWiki: linkContext.isWiki,
      isEmbed: false,
    },
    start: linkContext.start,
    end: linkContext.end,
    enteredFromLeft: true,
    isNewLink: true,
    shouldSelectText: linkContext.shouldSelectText,
    conversionNotice: linkContext.conversionNotice,
  };
}
```

**Benefit:** The core decision-making logic becomes testable without mocking the Editor API.

---

### 1.2 Create Test Data Factories

**Problem:** Test data is constructed inline, making tests verbose and hard to maintain.

**Solution:** Create a factory module for test data.

```typescript
// NEW FILE: tests/factories.ts

import { LinkInfo, SuggestionItem, PluginSettings } from '../src/types';

export function createLink(overrides: Partial<LinkInfo> = {}): LinkInfo {
  return {
    text: 'Example Link',
    destination: 'example-note',
    isWiki: true,
    isEmbed: false,
    ...overrides,
  };
}

export function createUrlLink(overrides: Partial<LinkInfo> = {}): LinkInfo {
  return createLink({
    text: 'https://example.com',
    destination: 'https://example.com',
    isWiki: false,
    ...overrides,
  });
}

export function createSuggestion(overrides: Partial<SuggestionItem> = {}): SuggestionItem {
  return {
    type: 'file',
    basename: 'Example Note',
    path: 'folder/example-note.md',
    ...overrides,
  };
}

export function createSettings(overrides: Partial<PluginSettings> = {}): PluginSettings {
  return {
    keepLinksSteady: false,
    ...overrides,
  };
}

// For linkSyntaxHider tests
export function createHiddenRange(overrides: Partial<HiddenRange> = {}): HiddenRange {
  return {
    from: 5,
    to: 10,
    side: 'leading',
    ...overrides,
  };
}
```

**Benefit:** Reduces test boilerplate and ensures consistency across tests.

---

### 1.3 Add Clipboard Service Abstraction

**Problem:** Direct use of `navigator.clipboard.readText()` in [`EditLinkModal.ts`](src/EditLinkModal.ts:292-324) and [`main.ts`](src/main.ts:65-70) makes tests dependent on browser APIs.

**Solution:** Create an injectable clipboard service.

```typescript
// NEW FILE: src/services/clipboard.ts

export interface ClipboardService {
  readText(): Promise<string>;
  writeText(text: string): Promise<void>;
}

export const browserClipboard: ClipboardService = {
  async readText() {
    return navigator.clipboard.readText();
  },
  async writeText(text: string) {
    return navigator.clipboard.writeText(text);
  },
};

// For testing
export const mockClipboard = (initialText: string = ''): ClipboardService => {
  let text = initialText;
  return {
    async readText() { return text; },
    async writeText(newText: string) { text = newText; },
  };
};
```

**Usage in main.ts:**
```typescript
export default class SteadyLinksPlugin extends Plugin {
  clipboard: ClipboardService = browserClipboard;
  
  // In editorCallback:
  const clipboardText = await this.clipboard.readText();
}
```

**Benefit:** Tests can inject mock clipboard without relying on browser APIs.

---

## Priority 2: Medium Impact, Medium Effort

### 2.1 Extract FileSuggest Query Logic

**Problem:** [`FileSuggest.ts`](src/FileSuggest.ts) has complex query parsing logic tightly coupled to Obsidian's `App` and metadata cache.

**Solution:** Extract the query parsing and filtering logic into pure functions.

```typescript
// NEW FILE: src/suggestionQuery.ts

export type QueryType = 
  | 'global-heading'      // ##heading
  | 'current-block'       // #^block
  | 'current-heading'     // #heading
  | 'block'               // ^block
  | 'file-block'          // file#^block
  | 'file-heading'        // file#heading
  | 'file-block-no-hash'  // file^block
  | 'file';               // file

export interface ParsedQuery {
  type: QueryType;
  fileName?: string;
  searchTerm?: string;
}

export function parseSuggestionQuery(query: string): ParsedQuery {
  const trimmed = query.trim();
  
  if (trimmed.startsWith('##')) {
    return { type: 'global-heading', searchTerm: trimmed.slice(2) };
  }
  if (trimmed.startsWith('#^')) {
    return { type: 'current-block', searchTerm: trimmed.slice(2) };
  }
  if (trimmed.startsWith('#') && !trimmed.startsWith('##')) {
    return { type: 'current-heading', searchTerm: trimmed.slice(1) };
  }
  if (trimmed.startsWith('^')) {
    return { type: 'block', searchTerm: trimmed.slice(1) };
  }
  if (trimmed.includes('#^')) {
    const [fileName, searchTerm] = trimmed.split('#^');
    return { type: 'file-block', fileName, searchTerm };
  }
  if (trimmed.includes('#') && !trimmed.startsWith('#')) {
    const [fileName, searchTerm] = trimmed.split('#');
    return { type: 'file-heading', fileName, searchTerm };
  }
  if (trimmed.includes('^') && !trimmed.startsWith('^')) {
    const [fileName, searchTerm] = trimmed.split('^');
    return { type: 'file-block-no-hash', fileName, searchTerm };
  }
  return { type: 'file', searchTerm: trimmed };
}
```

**Benefit:** Query parsing can be tested independently of Obsidian's metadata cache.

---

### 2.2 Create Editor Abstraction for Testing

**Problem:** The `Editor` class from Obsidian is used directly in [`main.ts`](src/main.ts), making it hard to test the `applyLinkEdit` method.

**Solution:** Create a minimal interface and mock.

```typescript
// ADD TO: tests/__mocks__/obsidian.ts

export interface MockEditorState {
  lines: string[];
  cursor: { line: number; ch: number };
  selection: { from: { line: number; ch: number }; to: { line: number; ch: number } } | null;
}

export function createMockEditor(state: MockEditorState) {
  return {
    getCursor: () => state.cursor,
    setCursor: (pos: { line: number; ch: number }) => { state.cursor = pos; },
    getLine: (line: number) => state.lines[line] || '',
    getSelection: () => {
      if (!state.selection) return '';
      const from = state.selection.from;
      const to = state.selection.to;
      return state.lines[from.line].slice(from.ch, to.ch);
    },
    somethingSelected: () => state.selection !== null,
    replaceRange: (text: string, from: { line: number; ch: number }, to: { line: number; ch: number }) => {
      const line = state.lines[from.line];
      state.lines[from.line] = line.slice(0, from.ch) + text + line.slice(to.ch);
    },
    lineCount: () => state.lines.length,
    getCursor: (pos: string) => {
      if (!state.selection) return state.cursor;
      return pos === 'from' ? state.selection.from : state.selection.to;
    },
  };
}
```

**Benefit:** Can test `applyLinkEdit` and other editor operations with controlled state.

---

### 2.3 Improve Mock Coverage in `obsidian.ts`

**Problem:** The current mock in [`tests/__mocks__/obsidian.ts`](tests/__mocks__/obsidian.ts) is minimal and doesn't support all used APIs.

**Solution:** Expand the mock to cover more scenarios.

```typescript
// EXPANDED: tests/__mocks__/obsidian.ts

export class TFile {
  path = '';
  name = '';
  basename = '';
  extension = '';
  parent: { path: string } | null = null;
  stat = { ctime: 0, mtime: 0, size: 0 };
  
  constructor(overrides: Partial<TFile> = {}) {
    Object.assign(this, overrides);
  }
}

export class MetadataCache {
  private fileCache: Map<string, any> = new Map();
  
  getFileCache(file: TFile) {
    return this.fileCache.get(file.path);
  }
  
  // For testing
  setFileCache(path: string, cache: any) {
    this.fileCache.set(path, cache);
  }
}

export class Vault {
  private files: TFile[] = [];
  
  getFiles() { return this.files; }
  getMarkdownFiles() { return this.files.filter(f => f.extension === 'md'); }
  async read(file: TFile) { return ''; }
  async cachedRead(file: TFile) { return ''; }
  async modify(file: TFile, content: string) {}
  
  // For testing
  setFiles(files: TFile[]) { this.files = files; }
}

export class Workspace {
  private activeFile: TFile | null = null;
  
  getActiveFile() { return this.activeFile; }
  updateOptions() {}
  
  // For testing
  setActiveFile(file: TFile | null) { this.activeFile = file; }
}

export class App {
  vault = new Vault();
  workspace = new Workspace();
  metadataCache = new MetadataCache();
}
```

**Benefit:** Tests can set up realistic scenarios with files, metadata, and workspace state.

---

## Priority 3: Lower Impact, Higher Effort

### 3.1 Extract Modal State Machine

**Problem:** [`EditLinkModal.ts`](src/EditLinkModal.ts) mixes UI concerns with state management, making it hard to test the interaction flow.

**Solution:** Extract a state machine that can be tested independently.

```typescript
// NEW FILE: src/modalState.ts

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

export type ModalAction =
  | { type: 'SET_TEXT'; value: string }
  | { type: 'SET_DESTINATION'; value: string }
  | { type: 'TOGGLE_WIKI' }
  | { type: 'TOGGLE_EMBED' }
  | { type: 'SUBMIT' };

export function modalReducer(state: ModalState, action: ModalAction): ModalState {
  switch (action.type) {
    case 'SET_TEXT':
      return { ...state, text: action.value };
    case 'SET_DESTINATION': {
      const isNowUrl = isUrl(action.value);
      return {
        ...state,
        destination: action.value,
        isWiki: isNowUrl ? false : state.isWiki,
      };
    }
    case 'TOGGLE_WIKI':
      return { ...state, isWiki: !state.isWiki };
    case 'TOGGLE_EMBED':
      return { ...state, isEmbed: !state.isEmbed };
    default:
      return state;
  }
}
```

**Benefit:** State transitions can be tested without DOM interaction.

---

### 3.2 Add Integration Test Utilities

**Problem:** Testing the full plugin flow requires manual setup in Obsidian.

**Solution:** Create test harness utilities for integration-style tests.

```typescript
// NEW FILE: tests/harness.ts

import { createMockEditor, MockEditorState } from './__mocks__/obsidian';

export interface TestHarness {
  editor: ReturnType<typeof createMockEditor>;
  clipboard: { text: string };
  settings: PluginSettings;
  
  // Actions
  setLine(line: number, text: string): void;
  setCursor(line: number, ch: number): void;
  setClipboard(text: string): void;
  selectText(from: { line: number; ch: number }, to: { line: number; ch: number }): void;
  
  // Assertions
  assertLineEquals(line: number, expected: string): void;
  assertCursorEquals(expected: { line: number; ch: number }): void;
}

export function createTestHarness(initialState: {
  lines?: string[];
  cursor?: { line: number; ch: number };
  clipboard?: string;
  settings?: Partial<PluginSettings>;
} = {}): TestHarness {
  const editorState: MockEditorState = {
    lines: initialState.lines || [''],
    cursor: initialState.cursor || { line: 0, ch: 0 },
    selection: null,
  };
  
  const clipboardText = { text: initialState.clipboard || '' };
  const settings = createSettings(initialState.settings);
  
  return {
    editor: createMockEditor(editorState),
    clipboard: clipboardText,
    settings,
    
    setLine(line, text) {
      editorState.lines[line] = text;
    },
    setCursor(line, ch) {
      editorState.cursor = { line, ch };
    },
    setClipboard(text) {
      clipboardText.text = text;
    },
    selectText(from, to) {
      editorState.selection = { from, to };
    },
    
    assertLineEquals(line, expected) {
      expect(editorState.lines[line]).toBe(expected);
    },
    assertCursorEquals(expected) {
      expect(editorState.cursor).toEqual(expected);
    },
  };
}
```

**Benefit:** Enables more realistic integration tests without full Obsidian environment.

---

### 3.3 Add Property-Based Testing for Link Parsing

**Problem:** Link parsing has many edge cases that are hard to cover with example-based tests.

**Solution:** Use property-based testing with fast-check.

```typescript
// NEW FILE: tests/utils.property.test.ts

import * as fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { parseWikiLink, parseMarkdownLink, buildLinkText } from '../src/utils';

describe('link parsing properties', () => {
  it('should round-trip wiki links', () => {
    fc.assert(
      fc.property(
        fc.record({
          destination: fc.string().filter(s => !s.includes(']]') && !s.includes('|')),
          text: fc.string().filter(s => !s.includes(']]')),
          isEmbed: fc.boolean(),
        }),
        ({ destination, text, isEmbed }) => {
          const linkText = isEmbed 
            ? `![[${destination}|${text}]]` 
            : `[[${destination}|${text}]]`;
          
          const parsed = parseWikiLink(linkText);
          expect(parsed).not.toBeNull();
          expect(parsed!.destination).toBe(destination);
          expect(parsed!.text).toBe(text);
          expect(parsed!.isEmbed).toBe(isEmbed);
        }
      )
    );
  });
  
  it('should round-trip through buildLinkText', () => {
    fc.assert(
      fc.property(
        fc.record({
          text: fc.string(),
          destination: fc.string().filter(s => !s.includes(')')),
          isWiki: fc.boolean(),
          isEmbed: fc.boolean(),
        }),
        (link) => {
          const built = buildLinkText(link);
          
          if (link.isWiki) {
            const parsed = parseWikiLink(built);
            expect(parsed).not.toBeNull();
          } else {
            const parsed = parseMarkdownLink(built);
            expect(parsed).not.toBeNull();
          }
        }
      )
    );
  });
});
```

**Benefit:** Discovers edge cases automatically through random test generation.

---

## Recommended Test File Structure

```
tests/
  __mocks__/
    obsidian.ts          # Expanded Obsidian API mocks
  factories.ts           # Test data factories
  harness.ts             # Integration test utilities
  unit/
    utils.test.ts        # Pure function tests
    modalLogic.test.ts   # (existing)
    linkOperations.test.ts  # New: extracted from main.ts
    suggestionQuery.test.ts # New: extracted from FileSuggest.ts
    modalState.test.ts   # New: state machine tests
  integration/
    linkEdit.test.ts     # Full link editing flow
    fileSuggest.test.ts  # File suggestion flow
  property/
    utils.property.test.ts  # Property-based tests
```

---

## Summary of Changes

| File | Change Type | Effort | Impact |
|------|-------------|--------|--------|
| `src/linkOperations.ts` | New file | Low | High |
| `src/services/clipboard.ts` | New file | Low | Medium |
| `src/suggestionQuery.ts` | New file | Medium | Medium |
| `src/modalState.ts` | New file | Medium | Low |
| `tests/factories.ts` | New file | Low | High |
| `tests/harness.ts` | New file | Medium | Medium |
| `tests/__mocks__/obsidian.ts` | Expand | Medium | High |
| `src/main.ts` | Refactor | Low | High |
| `src/EditLinkModal.ts` | Refactor | Medium | Medium |
| `src/FileSuggest.ts` | Refactor | Medium | Low |

---

## Implementation Order

1. **Start with factories** - Immediate test quality improvement
2. **Expand mocks** - Enables more test scenarios
3. **Extract `linkOperations.ts`** - Unlocks testing of main plugin logic
4. **Add clipboard service** - Removes browser dependency
5. **Extract `suggestionQuery.ts`** - Tests complex query parsing
6. **Add test harness** - Enables integration tests
7. **Consider state machine** - If modal complexity grows
8. **Add property tests** - For comprehensive edge case coverage