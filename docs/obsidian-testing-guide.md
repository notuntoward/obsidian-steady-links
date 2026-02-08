# Complete Guide: Testing Obsidian Plugins with Vitest 4.x

> **Last verified:** February 2026 with Vitest 4.0.18, Obsidian API 1.11.x

---

## Table of Contents

1. [Overview & Philosophy](#overview--philosophy)
2. [Vitest 4.x Setup](#vitest-4x-setup)
3. [Mocking the Obsidian API](#mocking-the-obsidian-api)
4. [Pool Selection (Critical)](#pool-selection-critical)
5. [Coverage Configuration](#coverage-configuration)
6. [Writing Testable Plugin Code](#writing-testable-plugin-code)
7. [Test File Best Practices](#test-file-best-practices)
8. [Common Mistakes](#common-mistakes)
9. [Troubleshooting](#troubleshooting)
10. [Full Configuration Reference](#full-configuration-reference)

---

## Overview & Philosophy

Obsidian plugins are TypeScript projects that depend on the `obsidian` npm package,
which is **type-only at dev time** — it has no runtime entry point. This creates a
unique testing challenge: you can't import from `obsidian` in a test runner without
providing your own mock module.

The highest-ROI testing strategy is:

1. **Extract business logic** into pure functions in separate files (e.g., `utils.ts`)
2. **Test those pure functions** exhaustively — no mocking needed
3. **Mock the Obsidian API minimally** for anything that touches it directly
4. **Keep `main.ts` thin** — it should be orchestration only, not business logic

---

## Vitest 4.x Setup

### package.json

```json
{
  "devDependencies": {
    "vitest": "^4.0.0",
    "@vitest/coverage-v8": "^4.0.0",
    "@vitest/ui": "^4.0.0"
  },
  "scripts": {
    "test": "vitest",
    "test:run": "vitest run",
    "test:coverage": "vitest run --coverage",
    "test:ui": "vitest --ui"
  }
}
```

### tsconfig.json

Add `"vitest/globals"` to the `types` array so TypeScript recognizes global test
functions when `globals: true` is set:

```json
{
  "compilerOptions": {
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

---

## Mocking the Obsidian API

The `obsidian` npm package has no runtime entry point — Vite/Vitest can't resolve it.
**You must provide a mock module.**

### ❌ Wrong: `vi.mock()` in a setup file

```typescript
// tests/setup.ts — DOES NOT WORK reliably with Vitest 4.x vmThreads pool
vi.mock('obsidian', () => ({
  TFile: class TFile { /* ... */ },
  Plugin: class Plugin { /* ... */ },
}));
```

This fails because `vmThreads` resolves modules in a VM context **before** setup
files can register mocks. You'll get:

```
Error: Failed to resolve entry for package "obsidian".
The package may have incorrect main/module/exports specified in its package.json.
```

### ✅ Correct: Vite resolve alias

Create a mock module file and point to it via a Vite resolve alias:

**`tests/__mocks__/obsidian.ts`**

```typescript
/**
 * Mock module for the Obsidian API.
 * Only export what your source code actually uses.
 */

export class TFile {
  path = '';
  name = '';
  basename = '';
  extension = '';
  vault: unknown = null;
  parent: unknown = null;
  stat = { ctime: 0, mtime: 0, size: 0 };
}

export class Plugin {
  app: unknown = {};
  manifest: unknown = {};
  addCommand() { return undefined; }
  addSettingTab() { return undefined; }
  loadData() { return Promise.resolve({}); }
  saveData() { return Promise.resolve(); }
  registerEvent() { return undefined; }
  registerDomEvent() { return undefined; }
  registerInterval() { return 0; }
}

export class Modal {
  app: unknown = {};
  containerEl = { createDiv: () => ({}) };
  open() { return undefined; }
  close() { return undefined; }
  onOpen() { return undefined; }
  onClose() { return undefined; }
}

export class PluginSettingTab {
  app: unknown = {};
  plugin: unknown = {};
  containerEl = { empty: () => {}, createEl: () => ({}) };
  display() { return undefined; }
  hide() { return undefined; }
}

export class Setting {
  settingEl = {};
  constructor(_containerEl?: unknown) {}
  setName() { return this; }
  setDesc() { return this; }
  addText() { return this; }
  addToggle() { return this; }
  addDropdown() { return this; }
  addButton() { return this; }
  addTextArea() { return this; }
}

export class Notice {
  constructor(_message: string, _timeout?: number) {}
}

// Add more stubs as your plugin grows
export class MarkdownView {}
export class Editor {}
export class App {}
export class Vault {}
export class Workspace {}
export const Pos = undefined;
```

**`vitest.config.ts`** — wire it up:

```typescript
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      obsidian: path.resolve(__dirname, 'tests/__mocks__/obsidian.ts'),
    },
  },
  test: {
    // ... (see Pool Selection section below)
  },
});
```

> **Key insight:** The Obsidian API is type-only, so there is **no coupling** between
> Obsidian API versions and Vitest versions. All Vitest versions work with all
> Obsidian API versions.

---

## Pool Selection (Critical)

Vitest 4.0 completely rewrote its pool (worker) architecture. This is the single
most important configuration decision for Obsidian plugin testing.

### Test results by pool type (empirically verified, February 2026)

| Pool | Test Execution | Coverage (v8) | Coverage (istanbul) |
|:---|:---|:---|:---|
| `threads` (Vitest 4 default) | ❌ "No test suite found" | N/A | N/A |
| `forks` | ❌ "No test suite found" | N/A | N/A |
| **`vmThreads`** | ✅ All tests pass | ⚠️ Reports 0% (known issue) | ❌ Bug in `getCoverageMapForUncoveredFiles` |
| `vmForks` | ✅ All tests pass | ⚠️ Reports 0% (known issue) | ❌ Same bug |

### Recommendation

**Use `pool: 'vmThreads'`** — it's the only pool that reliably collects and runs
test suites in Vitest 4.x for projects with the resolve alias pattern needed for
Obsidian.

```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    pool: 'vmThreads',
  },
});
```

### Why do `threads` and `forks` fail?

The non-VM pools (`threads`, `forks`) use standard Node.js worker threads or child
processes. In Vitest 4.x, these pools changed how modules are loaded and how global
test functions (`describe`, `it`, `expect`) are injected. When combined with the
Obsidian module resolution pattern (resolve aliases pointing to mock files), the
test runner loads the files but fails to register the test suites.

The VM pools (`vmThreads`, `vmForks`) create isolated V8 VM contexts with explicit
module loading, which correctly handles the resolve alias + globals pattern.

---

## Coverage Configuration

### The vmThreads coverage problem

Both `v8` and `istanbul` coverage providers have issues with `vmThreads` in
Vitest 4.0.18:

- **v8 provider**: Reports 0% coverage for all files. The VM context isolation
  prevents v8's native coverage APIs from instrumenting the actual file system paths.
- **istanbul provider**: Crashes with `Error: Coverage must be initialized with a
  path or an object` in `getCoverageMapForUncoveredFiles`.

### Recommended approach

Use `v8` for now — it doesn't crash and at least lists the files. Coverage accuracy
with VM pools is expected to improve in future Vitest releases.

```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    pool: 'vmThreads',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/main.ts'], // Too coupled to Obsidian to unit test
    },
  },
});
```

> **Note:** If you need accurate coverage numbers today, you can run coverage
> separately with a different pooling strategy, or use Vitest 3.x for the coverage
> run. But for day-to-day development, `vmThreads` with tests passing is far more
> valuable than coverage numbers.

---

## Writing Testable Plugin Code

### The #1 rule: Extract business logic

```typescript
// ❌ BAD — Untestable: business logic buried in a Plugin callback
export default class MyPlugin extends Plugin {
  async onload() {
    this.addCommand({
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        const content = await this.app.vault.read(file);
        // 100 lines of business logic...
        const result = content.replace(/\[\s\]/g, '[x]');
        await this.app.vault.modify(file, result);
      }
    });
  }
}
```

```typescript
// ✅ GOOD — Business logic in a pure, testable function
// src/utils.ts
export function checkAllTodos(content: string): string {
  return content.replace(/\[\s\]/g, '[x]');
}

// src/main.ts — thin orchestration layer
import { checkAllTodos } from './utils';

export default class MyPlugin extends Plugin {
  async onload() {
    this.addCommand({
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return;
        const content = await this.app.vault.read(file);
        const result = checkAllTodos(content);
        await this.app.vault.modify(file, result);
      }
    });
  }
}
```

### Use dependency injection for testability

```typescript
// ✅ Function that accepts an "adapter" instead of touching the Obsidian API directly
export interface VaultAdapter {
  read(file: TFile): Promise<string>;
  modify(file: TFile, content: string): Promise<void>;
}

export async function processFile(vault: VaultAdapter, file: TFile): Promise<void> {
  const content = await vault.read(file);
  const result = checkAllTodos(content);
  await vault.modify(file, result);
}

// In tests, provide a simple mock:
const mockVault: VaultAdapter = {
  read: vi.fn().mockResolvedValue('- [ ] task'),
  modify: vi.fn().mockResolvedValue(undefined),
};
```

---

## Test File Best Practices

### Always name your `describe()` blocks

```typescript
// ❌ BAD — Vitest 4.x may not collect anonymous suites
describe(() => {
  it('does something', () => { /* ... */ });
});

// ✅ GOOD
describe('checkAllTodos', () => {
  it('should check all unchecked todos', () => { /* ... */ });
});
```

### Import explicitly or use globals — but be consistent

Both approaches work with `globals: true` in the config:

```typescript
// Approach A: Explicit imports (recommended for clarity)
import { describe, it, expect } from 'vitest';

describe('MyFunction', () => {
  it('works', () => {
    expect(myFunction()).toBe(true);
  });
});
```

```typescript
// Approach B: Global usage (requires globals: true + tsconfig types)
describe('MyFunction', () => {
  it('works', () => {
    expect(myFunction()).toBe(true);
  });
});
```

### Test structure

```
project-root/
├── src/
│   ├── main.ts          # Plugin entry — thin orchestration, hard to test
│   ├── utils.ts          # Pure business logic — easy to test
│   ├── SettingTab.ts     # Settings UI — hard to test
│   └── types.ts          # Type definitions
├── tests/
│   ├── __mocks__/
│   │   └── obsidian.ts   # Obsidian API mock module
│   ├── diagnostic.test.ts  # Smoke test (proves Vitest works at all)
│   └── utils.test.ts       # Main test file for business logic
├── vitest.config.ts
├── tsconfig.json
└── package.json
```

### Include a diagnostic smoke test

When debugging Vitest configuration issues, a trivial test file helps isolate
whether the problem is in your code or in the runner:

```typescript
// tests/diagnostic.test.ts
import { describe, it, expect } from 'vitest';

describe('Diagnostic: Can vitest run at all?', () => {
  it('should be able to run basic tests', () => {
    expect(1 + 1).toBe(2);
  });
});
```

---

## Common Mistakes

### 1. Not isolating business logic from Obsidian API
**Impact:** Untestable code. Tests require complex mocking.
**Fix:** Extract pure functions into `utils.ts` or similar.

### 2. Over-mocking instead of extracting testable functions
**Impact:** Tests are brittle and coupled to implementation details.
**Fix:** If you find yourself mocking more than 2-3 things, refactor instead.

### 3. Not using dependency injection
**Impact:** Functions that directly call `this.app.vault.read()` can't be tested
without a full Obsidian mock.
**Fix:** Accept interfaces as parameters; inject the real implementation in
production and a mock in tests.

### 4. Using `cachedRead()` then writing back
**Impact:** Data loss! `cachedRead()` may return stale content. If you write it
back, you overwrite changes.
**Fix:** Always use `vault.read()` before `vault.modify()`.

### 5. Not cleaning up event listeners
**Impact:** Memory leaks, and tests can interfere with each other.
**Fix:** Use `this.registerEvent()` and `this.registerDomEvent()` so Obsidian
cleans up on plugin unload.

### 6. Using `vi.mock()` for the obsidian module
**Impact:** Doesn't work with `vmThreads` pool in Vitest 4.x.
**Fix:** Use Vite resolve aliases (see [Mocking the Obsidian API](#mocking-the-obsidian-api)).

### 7. Using `pool: 'threads'` or `pool: 'forks'` with Vitest 4.x
**Impact:** "No test suite found" errors.
**Fix:** Use `pool: 'vmThreads'` (see [Pool Selection](#pool-selection-critical)).

### 8. Using private or undocumented Obsidian APIs
**Impact:** Breaks on updates, plugin may be rejected from the community store.
**Fix:** Stick to the public API documented at https://github.com/obsidianmd/obsidian-api.

### 9. Anonymous `describe()` blocks
**Impact:** Vitest 4.x may not recognize or collect them.
**Fix:** Always name your `describe()` blocks.

### 10. Expecting v8 coverage to work with vmThreads
**Impact:** Coverage shows 0% for all files.
**Fix:** This is a known Vitest issue. Accurate coverage with `vmThreads` is expected
to improve in future releases.

---

## Troubleshooting

### "Failed to resolve entry for package 'obsidian'"

**Cause:** The `obsidian` npm package is type-only with no runtime entry point.

**Fix:** Add a resolve alias in `vitest.config.ts`:
```typescript
resolve: {
  alias: {
    obsidian: path.resolve(__dirname, 'tests/__mocks__/obsidian.ts'),
  },
},
```

### "No test suite found in file"

**Cause:** Using `pool: 'threads'` or `pool: 'forks'` in Vitest 4.x.

**Fix:** Switch to `pool: 'vmThreads'`.

### Coverage shows 0% for all files

**Cause:** V8 coverage can't instrument files loaded in VM contexts created by
`vmThreads`/`vmForks` pools.

**Status:** Known Vitest issue as of 4.0.18. Test execution is unaffected.

### istanbul coverage crashes with "Coverage must be initialized with a path"

**Cause:** Bug in `@vitest/coverage-istanbul` when used with VM pools and files
that match `include` but weren't imported during tests.

**Fix:** Use `provider: 'v8'` instead, or wait for a fix in `@vitest/coverage-istanbul`.

---

## Full Configuration Reference

### `vitest.config.ts`

```typescript
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      // The real "obsidian" package is type-only with no runtime entry.
      // Redirect to our mock so imports resolve at test time.
      obsidian: path.resolve(__dirname, 'tests/__mocks__/obsidian.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    pool: 'vmThreads', // Only vm* pools properly collect tests in Vitest 4.x
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/main.ts'],
    },
  },
});
```

### `package.json` (devDependencies)

```json
{
  "devDependencies": {
    "@vitest/coverage-v8": "^4.0.0",
    "@vitest/ui": "^4.0.0",
    "vitest": "^4.0.0"
  }
}
```

### `tsconfig.json` (relevant parts)

```json
{
  "compilerOptions": {
    "module": "ESNext",
    "target": "ES2020",
    "moduleResolution": "bundler",
    "types": ["node", "vitest/globals"],
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

---

## Key Takeaways

1. **Use Vitest 4.x** with `pool: 'vmThreads'` — it's the only pool that reliably
   collects tests for Obsidian plugin projects
2. **Mock obsidian via Vite resolve alias**, not `vi.mock()` — the VM pool resolves
   modules before setup files can register mocks
3. **Extract business logic** into pure functions for the highest testing ROI
4. **Name all `describe()` blocks** to avoid Vitest 4.x collection issues
5. **Mock minimally** — only mock what you absolutely need
6. **Coverage with vmThreads is a known issue** — tests pass correctly even though
   coverage reports 0%
7. **Obsidian API is type-only** — version compatibility between Obsidian and Vitest
   is not a concern
8. **Never use `cachedRead()` before writing** — data loss risk
