/**
 * Mock module for the Obsidian API.
 *
 * The real "obsidian" npm package is type-only (no runtime entry point).
 * This file is resolved via a Vite alias in vitest.config.ts so that any
 * `import { … } from "obsidian"` in source files works at test time.
 *
 * Only the symbols actually used by the source code need to be exported.
 * Add more stubs here as your plugin grows.
 */

// ---- Types used as values in source code ----

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

export class MarkdownView {}
export class Editor {}
export class App {}
export class Vault {}
export class Workspace {}

// Type-only exports that may be referenced — provide undefined/empty stubs
export const Pos = undefined;
