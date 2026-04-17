/**
 * Mock module for the Obsidian API.
 *
 * The real "obsidian" npm package is type-only (no runtime entry point).
 * This file is resolved via a Vite alias in vitest.config.ts so that any
 * `import { ... } from "obsidian"` in source files works at test time.
 *
 * This mock provides:
 * - Basic class stubs for Plugin, Modal, Setting, etc.
 * - Stateful mocks for Editor, Vault, Workspace, MetadataCache
 * - Factory functions for creating test scenarios
 */

// ============================================================================
// TFile - File representation
// ============================================================================

export class TFile {
	path = "";
	name = "";
	basename = "";
	extension = "";
	vault: Vault | null = null;
	parent: { path: string } | null = null;
	stat = { ctime: 0, mtime: 0, size: 0 };

	constructor(overrides: Partial<TFile> = {}) {
		Object.assign(this, overrides);
		// Auto-derive name and basename from path if not provided
		if (this.path && !this.name) {
			const parts = this.path.split("/");
			this.name = parts[parts.length - 1] || "";
		}
		if (this.name && !this.basename && this.extension) {
			this.basename = this.name.slice(0, -(this.extension.length + 1));
		} else if (this.name && !this.basename) {
			const dotIndex = this.name.lastIndexOf(".");
			this.basename = dotIndex > 0 ? this.name.slice(0, dotIndex) : this.name;
			this.extension = dotIndex > 0 ? this.name.slice(dotIndex + 1) : "";
		}
	}
}

// ============================================================================
// MetadataCache - File metadata and frontmatter
// ============================================================================

export interface CachedMetadata {
	frontmatter?: Record<string, unknown>;
	headings?: Array<{ heading: string; level: number; position: any }>;
	sections?: Array<{ type: string; position: any }>;
	links?: Array<{ link: string; position: any }>;
	embeds?: Array<{ link: string; position: any }>;
}

export class MetadataCache {
	private fileCache: Map<string, CachedMetadata> = new Map();

	getFileCache(file: TFile): CachedMetadata | null {
		return this.fileCache.get(file.path) || null;
	}

	// Test helper methods
	setFileCache(path: string, cache: CachedMetadata): void {
		this.fileCache.set(path, cache);
	}

	clear(): void {
		this.fileCache.clear();
	}
}

// ============================================================================
// Vault - File system operations
// ============================================================================

export class Vault {
	private files: TFile[] = [];
	private fileContents: Map<string, string> = new Map();

	getFiles(): TFile[] {
		return [...this.files];
	}

	getMarkdownFiles(): TFile[] {
		return this.files.filter((f) => f.extension === "md");
	}

	async read(file: TFile): Promise<string> {
		return this.fileContents.get(file.path) || "";
	}

	async cachedRead(file: TFile): Promise<string> {
		return this.fileContents.get(file.path) || "";
	}

	async modify(file: TFile, content: string): Promise<void> {
		this.fileContents.set(file.path, content);
	}

	getAbstractFileByPath(path: string): TFile | null {
		return this.files.find((f) => f.path === path) || null;
	}

	// Test helper methods
	setFiles(files: TFile[]): void {
		this.files = files;
	}

	addFile(file: TFile, content: string = ""): void {
		this.files.push(file);
		file.vault = this;
		this.fileContents.set(file.path, content);
	}

	setFileContent(path: string, content: string): void {
		this.fileContents.set(path, content);
	}

	getFileContent(path: string): string {
		return this.fileContents.get(path) || "";
	}

	clear(): void {
		this.files = [];
		this.fileContents.clear();
	}
}

// ============================================================================
// Workspace - Editor and view management
// ============================================================================

export class Workspace {
	private activeFile: TFile | null = null;
	private activeEditor: Editor | null = null;

	leftSplit: any;
	rightSplit: any;
	leftRibbon: any;
	rightRibbon: any;
	activeLeaf: any;
	layoutReady: boolean;
	requestSaveLayout: any;
	requestSaveHistory: any;
	containerEl: any;
	layoutChanged: any;
	protocolHandlers: any;
	editorExtensions: any;
	mobileToolbar: any;
	rootSplit: any;
	onLayoutReady: any;
	changeLayout: any;
	getLayout: any;
	createLeafInParent: any;
	createLeafBySplit: any;
	splitActiveLeaf: any;
	duplicateLeaf: any;
	getUnpinnedLeaf: any;
	getLeaf: any;
	moveLeafToPopout: any;
	openPopoutLeaf: any;

	constructor() {
		this.leftSplit = {};
		this.rightSplit = {};
		this.leftRibbon = {};
		this.rightRibbon = {};
		this.activeLeaf = null;
		this.layoutReady = false;
		this.requestSaveLayout = {};
		this.requestSaveHistory = {};
		this.containerEl = {};
		this.layoutChanged = {};
		this.protocolHandlers = {};
		this.editorExtensions = [];
		this.mobileToolbar = {};
		this.rootSplit = {};
		this.onLayoutReady = {};
		this.changeLayout = {};
		this.getLayout = {};
		this.createLeafInParent = {};
		this.createLeafBySplit = {};
		this.splitActiveLeaf = {};
		this.duplicateLeaf = {};
		this.getUnpinnedLeaf = {};
		this.getLeaf = {};
		this.moveLeafToPopout = {};
		this.openPopoutLeaf = {};
	}

	getActiveFile(): TFile | null {
		return this.activeFile;
	}

	getActiveViewOfType(_type: any): { editor?: Editor; file?: TFile } | null {
		if (this.activeEditor) {
			return { editor: this.activeEditor, file: this.activeFile || undefined };
		}
		return null;
	}

	updateOptions(): void {
		// No-op in tests
	}

	getLeavesOfType(_type: string): any[] {
		return [];
	}

	// Test helper methods
	setActiveFile(file: TFile | null): void {
		this.activeFile = file;
	}

	setActiveEditor(editor: Editor | null): void {
		this.activeEditor = editor;
	}
}

// ============================================================================
// Editor - Text editing operations
// ============================================================================

export interface EditorState {
	lines: string[];
	cursor: { line: number; ch: number };
	selection: { from: { line: number; ch: number }; to: { line: number; ch: number } } | null;
}

export class Editor {
	private state: EditorState;

	constructor(initialState?: Partial<EditorState>) {
		this.state = {
			lines: [""],
			cursor: { line: 0, ch: 0 },
			selection: null,
			...initialState,
		};
	}

	// Read operations
	getCursor(pos?: string): { line: number; ch: number } {
		if (pos === "from" && this.state.selection) {
			return this.state.selection.from;
		}
		if (pos === "to" && this.state.selection) {
			return this.state.selection.to;
		}
		return { ...this.state.cursor };
	}

	getLine(line: number): string {
		return this.state.lines[line] ?? "";
	}

	getSelection(): string {
		if (!this.state.selection) return "";
		const { from, to } = this.state.selection;
		if (from.line !== to.line) {
			// Multi-line selection (simplified)
			return this.state.lines.slice(from.line, to.line + 1).join("\n");
		}
		return this.state.lines[from.line]?.slice(from.ch, to.ch) ?? "";
	}

	somethingSelected(): boolean {
		return this.state.selection !== null;
	}

	lineCount(): number {
		return this.state.lines.length;
	}

	getRange(from: { line: number; ch: number }, to: { line: number; ch: number }): string {
		if (from.line === to.line) {
			return this.state.lines[from.line]?.slice(from.ch, to.ch) ?? "";
		}
		// Multi-line range (simplified)
		const lines: string[] = [];
		lines.push(this.state.lines[from.line]?.slice(from.ch) ?? "");
		for (let i = from.line + 1; i < to.line; i++) {
			lines.push(this.state.lines[i] ?? "");
		}
		lines.push(this.state.lines[to.line]?.slice(0, to.ch) ?? "");
		return lines.join("\n");
	}

	// Write operations
	setCursor(pos: { line: number; ch: number }): void {
		this.state.cursor = { ...pos };
		this.state.selection = null;
	}

	setSelection(from: { line: number; ch: number }, to: { line: number; ch: number }): void {
		this.state.selection = { from: { ...from }, to: { ...to } };
		this.state.cursor = { ...to };
	}

	replaceRange(
		text: string,
		from: { line: number; ch: number },
		to?: { line: number; ch: number }
	): void {
		const toPos = to ?? from;

		if (from.line === toPos.line) {
			// Same line replacement
			const line = this.state.lines[from.line] ?? "";
			this.state.lines[from.line] = line.slice(0, from.ch) + text + line.slice(toPos.ch);
		} else {
			// Multi-line replacement (simplified)
			const before = this.state.lines[from.line]?.slice(0, from.ch) ?? "";
			const after = this.state.lines[toPos.line]?.slice(toPos.ch) ?? "";
			const newLines = (before + text + after).split("\n");
			this.state.lines.splice(from.line, toPos.line - from.line + 1, ...newLines);
		}

		// Clear selection after edit
		this.state.selection = null;
	}

	replaceSelection(text: string): void {
		if (!this.state.selection) return;
		const { from, to } = this.state.selection;
		this.replaceRange(text, from, to);
	}

	// Test helper methods
	getState(): EditorState {
		return {
			lines: [...this.state.lines],
			cursor: { ...this.state.cursor },
			selection: this.state.selection
				? {
						from: { ...this.state.selection.from },
						to: { ...this.state.selection.to },
					}
				: null,
		};
	}

	setState(state: Partial<EditorState>): void {
		if (state.lines) this.state.lines = [...state.lines];
		if (state.cursor) this.state.cursor = { ...state.cursor };
		if (state.selection !== undefined) {
			this.state.selection = state.selection
				? {
						from: { ...state.selection.from },
						to: { ...state.selection.to },
					}
				: null;
		}
	}

	setLines(lines: string[]): void {
		this.state.lines = [...lines];
	}

	setLine(line: number, text: string): void {
		while (this.state.lines.length <= line) {
			this.state.lines.push("");
		}
		this.state.lines[line] = text;
	}
}

// ============================================================================
// App - Main application container
// ============================================================================

export class App {
	vault: Vault;
	workspace: Workspace;
	metadataCache: MetadataCache;
	keymap: any;
	scope: any;
	fileManager: any;
	lastEvent: any;
	customCss: any;
	dom: any;
	loadProgress: any;
	commands: any;
	renderContext: any;
	isDarkMode: boolean;
	loadLocalStorage: any;
	saveLocalStorage: any;

	constructor() {
		this.vault = new Vault();
		this.workspace = new Workspace();
		this.metadataCache = new MetadataCache();
		this.keymap = {};
		this.scope = {};
		this.fileManager = {};
		this.lastEvent = null;
		this.customCss = {};
		this.dom = {};
		this.loadProgress = {};
		this.commands = {};
		this.renderContext = {};
		this.isDarkMode = false;
		this.loadLocalStorage = {};
		this.saveLocalStorage = {};
	}

	// Test helper to reset all state
	reset(): void {
		this.vault.clear();
		this.workspace.setActiveFile(null);
		this.workspace.setActiveEditor(null);
		this.metadataCache.clear();
	}
}

// ============================================================================
// Plugin base class
// ============================================================================

export class Plugin {
	app: App;
	manifest: unknown = {};
	private settings: Record<string, unknown> = {};

	constructor(app?: App) {
		this.app = app ?? new App();
	}

	addCommand(): this {
		return this;
	}
	addSettingTab(): this {
		return this;
	}
	registerEditorExtension(): this {
		return this;
	}

	async loadData(): Promise<Record<string, unknown>> {
		return { ...this.settings };
	}

	async saveData(data: Record<string, unknown>): Promise<void> {
		this.settings = { ...data };
	}

	registerEvent(): this {
		return this;
	}
	registerDomEvent(): this {
		return this;
	}
	registerInterval(): number {
		return 0;
	}
}

// ============================================================================
// Modal base class
// ============================================================================

export class Modal {
	app: App;
	containerEl: HTMLElement;
	modalEl: HTMLElement;
	contentEl: HTMLElement;
	private _open = false;

	constructor(app: App) {
		this.app = app;
		// Create mock DOM elements
		this.containerEl = document.createElement("div");
		this.modalEl = document.createElement("div");
		this.contentEl = document.createElement("div");
		this.containerEl.appendChild(this.modalEl);
		this.modalEl.appendChild(this.contentEl);
	}

	open(): void {
		this._open = true;
		this.onOpen();
	}

	close(): void {
		this._open = false;
		this.onClose();
	}

	onOpen(): void {}
	onClose(): void {
		this.contentEl.empty();
	}

	isOpen(): boolean {
		return this._open;
	}
}

// ============================================================================
// PluginSettingTab
// ============================================================================

export class PluginSettingTab {
	app: App;
	plugin: Plugin;
	containerEl: HTMLElement;

	constructor(app: App, plugin: Plugin) {
		this.app = app;
		this.plugin = plugin;
		this.containerEl = document.createElement("div");
	}

	display(): void {}
	hide(): void {}
}

// ============================================================================
// Setting UI component
// ============================================================================

export class Setting {
	settingEl: HTMLElement;
	nameEl: HTMLElement;
	descEl: HTMLElement;
	controlEl: HTMLElement;

	constructor(containerEl?: HTMLElement) {
		this.settingEl = document.createElement("div");
		this.nameEl = document.createElement("div");
		this.descEl = document.createElement("div");
		this.controlEl = document.createElement("div");
		this.settingEl.appendChild(this.nameEl);
		this.settingEl.appendChild(this.descEl);
		this.settingEl.appendChild(this.controlEl);
		containerEl?.appendChild(this.settingEl);
	}

	setName(name: string): this {
		this.nameEl.textContent = name;
		return this;
	}

	setDesc(desc: string): this {
		this.descEl.textContent = desc;
		return this;
	}

	addText(cb: (text: TextComponent) => void): this {
		const component = new TextComponent(this.controlEl);
		cb(component);
		return this;
	}

	addToggle(cb: (toggle: ToggleComponent) => void): this {
		const component = new ToggleComponent(this.controlEl);
		cb(component);
		return this;
	}

	addDropdown(cb: (dropdown: DropdownComponent) => void): this {
		const component = new DropdownComponent(this.controlEl);
		cb(component);
		return this;
	}

	addButton(cb: (button: ButtonComponent) => void): this {
		const component = new ButtonComponent(this.controlEl);
		cb(component);
		return this;
	}

	addTextArea(cb: (textarea: TextAreaComponent) => void): this {
		const component = new TextAreaComponent(this.controlEl);
		cb(component);
		return this;
	}

	then(cb: (setting: this) => void): this {
		cb(this);
		return this;
	}
}

// UI Component stubs
export class TextComponent {
	inputEl: HTMLInputElement;
	private onChangeCb?: (value: string) => void;

	constructor(container: HTMLElement) {
		this.inputEl = document.createElement("input");
		this.inputEl.type = "text";
		container.appendChild(this.inputEl);
		this.inputEl.addEventListener("input", () => {
			this.onChangeCb?.(this.inputEl.value);
		});
	}

	setValue(value: string): this {
		this.inputEl.value = value;
		return this;
	}

	getValue(): string {
		return this.inputEl.value;
	}

	onChange(cb: (value: string) => void): this {
		this.onChangeCb = cb;
		return this;
	}

	setPlaceholder(placeholder: string): this {
		this.inputEl.placeholder = placeholder;
		return this;
	}
}

export class ToggleComponent {
	toggleEl: HTMLElement;
	private value = false;
	private onChangeCb?: (value: boolean) => void;

	constructor(container: HTMLElement) {
		this.toggleEl = document.createElement("div");
		this.toggleEl.className = "checkbox-container";
		container.appendChild(this.toggleEl);
		this.toggleEl.addEventListener("click", () => {
			this.value = !this.value;
			this.toggleEl.classList.toggle("is-enabled", this.value);
			this.onChangeCb?.(this.value);
		});
	}

	setValue(value: boolean): this {
		this.value = value;
		this.toggleEl.classList.toggle("is-enabled", value);
		return this;
	}

	getValue(): boolean {
		return this.value;
	}

	onChange(cb: (value: boolean) => void): this {
		this.onChangeCb = cb;
		return this;
	}
}

export class DropdownComponent {
	selectEl: HTMLSelectElement;
	private onChangeCb?: (value: string) => void;

	constructor(container: HTMLElement) {
		this.selectEl = document.createElement("select");
		container.appendChild(this.selectEl);
		this.selectEl.addEventListener("change", () => {
			this.onChangeCb?.(this.selectEl.value);
		});
	}

	addOption(value: string, display: string): this {
		const option = document.createElement("option");
		option.value = value;
		option.textContent = display;
		this.selectEl.appendChild(option);
		return this;
	}

	setValue(value: string): this {
		this.selectEl.value = value;
		return this;
	}

	getValue(): string {
		return this.selectEl.value;
	}

	onChange(cb: (value: string) => void): this {
		this.onChangeCb = cb;
		return this;
	}
}

export class ButtonComponent {
	buttonEl: HTMLButtonElement;
	private onClickCb?: () => void;

	constructor(container: HTMLElement) {
		this.buttonEl = document.createElement("button");
		container.appendChild(this.buttonEl);
		this.buttonEl.addEventListener("click", () => {
			this.onClickCb?.();
		});
	}

	setButtonText(text: string): this {
		this.buttonEl.textContent = text;
		return this;
	}

	setCta(): this {
		this.buttonEl.classList.add("mod-cta");
		return this;
	}

	onClick(cb: () => void): this {
		this.onClickCb = cb;
		return this;
	}

	setDisabled(disabled: boolean): this {
		this.buttonEl.disabled = disabled;
		return this;
	}
}

export class TextAreaComponent {
	inputEl: HTMLTextAreaElement;
	private onChangeCb?: (value: string) => void;

	constructor(container: HTMLElement) {
		this.inputEl = document.createElement("textarea");
		container.appendChild(this.inputEl);
		this.inputEl.addEventListener("input", () => {
			this.onChangeCb?.(this.inputEl.value);
		});
	}

	setValue(value: string): this {
		this.inputEl.value = value;
		return this;
	}

	getValue(): string {
		return this.inputEl.value;
	}

	onChange(cb: (value: string) => void): this {
		this.onChangeCb = cb;
		return this;
	}

	setPlaceholder(placeholder: string): this {
		this.inputEl.placeholder = placeholder;
		return this;
	}
}

// ============================================================================
// Notice - User notifications
// ============================================================================

export class Notice {
	private message: string;
	private timeout: number;

	constructor(message: string, timeout?: number) {
		this.message = message;
		this.timeout = timeout ?? 5000;
	}

	getMessage(): string {
		return this.message;
	}

	setMessage(message: string): void {
		this.message = message;
	}

	hide(): void {
		// No-op in tests
	}
}

// ============================================================================
// MarkdownView
// ============================================================================

export class MarkdownView {
	app: App;
	file: TFile | null = null;
	editor: Editor;
	contentEl: HTMLElement;
	containerEl: HTMLElement;

	constructor(app: App, file?: TFile) {
		this.app = app;
		this.file = file ?? null;
		this.editor = new Editor();
		this.contentEl = document.createElement("div");
		this.containerEl = document.createElement("div");
	}

	getMode(): "source" | "preview" | "live" {
		return "source";
	}
}

// ============================================================================
// AbstractInputSuggest - Base class for suggestion providers
// ============================================================================

export abstract class AbstractInputSuggest<T> {
	protected app: App;
	protected inputEl: HTMLInputElement;
	private suggestions: T[] = [];
	private isOpen = false;

	constructor(app: App, inputEl: HTMLInputElement) {
		this.app = app;
		this.inputEl = inputEl;
	}

	abstract getSuggestions(query: string): Promise<T[]>;
	abstract renderSuggestion(item: T, el: HTMLElement): void;
	abstract selectSuggestion(item: T): void;

	// Test helpers
	protected setSuggestions(suggestions: T[]): void {
		this.suggestions = suggestions;
	}

	protected getIsOpen(): boolean {
		return this.isOpen;
	}

	open(): void {
		this.isOpen = true;
	}

	close(): void {
		this.isOpen = false;
	}
}

// ============================================================================
// Type-only exports
// ============================================================================

export const Pos = undefined;

// Event types used in source code
export interface EditorPosition {
	line: number;
	ch: number;
}

export interface EditorChange {
	from: EditorPosition;
	to: EditorPosition;
	text: string;
}

export interface EditorSelection {
	anchor: EditorPosition;
	head: EditorPosition;
}

// ============================================================================
// Test Factory Functions
// ============================================================================

/**
 * Create a fully configured test App with files and metadata
 */
export function createTestApp(
	config: {
		files?: Array<{ path: string; content?: string; metadata?: CachedMetadata }>;
		activeFile?: TFile | string;
		editorState?: Partial<EditorState>;
	} = {}
): App {
	const app = new App();

	// Add files
	if (config.files) {
		for (const fileConfig of config.files) {
			const file = new TFile({ path: fileConfig.path });
			app.vault.addFile(file, fileConfig.content ?? "");
			if (fileConfig.metadata) {
				app.metadataCache.setFileCache(fileConfig.path, fileConfig.metadata);
			}
		}
	}

	// Set active file
	if (config.activeFile) {
		const activeFile =
			typeof config.activeFile === "string"
				? app.vault.getAbstractFileByPath(config.activeFile)
				: config.activeFile;
		if (activeFile) {
			app.workspace.setActiveFile(activeFile);
		}
	}

	// Set up editor
	if (config.editorState) {
		const editor = new Editor(config.editorState);
		app.workspace.setActiveEditor(editor);
	}

	return app;
}

/**
 * Create a mock Editor with initial content
 */
export function createMockEditor(lines: string | string[]): Editor {
	const lineArray = Array.isArray(lines) ? lines : [lines];
	return new Editor({ lines: lineArray });
}
