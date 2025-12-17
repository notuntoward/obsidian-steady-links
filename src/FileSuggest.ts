import { App, TFile, AbstractInputSuggest } from "obsidian";
import { SuggestionItem } from "./types";
import type { LinkEditModal } from "./LinkEditModal";

export class FileSuggest extends AbstractInputSuggest<SuggestionItem> {
	modal: LinkEditModal;
	inputEl: HTMLInputElement;

	constructor(app: App, textInputEl: HTMLInputElement, modal: LinkEditModal) {
		super(app, textInputEl);
		this.modal = modal;
		this.inputEl = textInputEl;
	}

	async getSuggestions(query: string): Promise<SuggestionItem[]> {
		if (this.modal.isUrl(query)) return [];

		const trimmedQuery = query.trim();

		// Non-wiki: just files.
		if (!this.modal.isWiki) {
			return this.getFiles(trimmedQuery);
		}

		// --- WIKILINK MODE PATTERNS ---
		// 1) "##heading" in all files
		if (trimmedQuery.startsWith("##")) {
			const headingQuery = trimmedQuery.slice(2).toLowerCase();
			const allHeadings = this.getAllHeadings();
			if (!headingQuery) return allHeadings;
			return allHeadings.filter((h) =>
				h.heading && h.heading.toLowerCase().includes(headingQuery)
			);
		}

		// 2) "#^block" in current file (must come BEFORE single # check)
		if (trimmedQuery.startsWith("#^")) {
			const blockQuery = trimmedQuery.slice(2).toLowerCase();
			const activeFile = this.app.workspace.getActiveFile();
			if (!activeFile) return [];
			return await this.getAllBlocksInFile(activeFile, blockQuery);
		}

		// 3) "#heading" in current file
		if (trimmedQuery.startsWith("#") && !trimmedQuery.startsWith("##")) {
			const headingQuery = trimmedQuery.slice(1).toLowerCase();
			const allHeadings = this.getHeadingsInCurrentFile();
			if (!headingQuery) return allHeadings;
			return allHeadings.filter((h) =>
				h.heading && h.heading.toLowerCase().includes(headingQuery)
			);
		}

		// 4) "^block" in current file
		if (trimmedQuery.startsWith("^")) {
			const blockQuery = trimmedQuery.slice(1).toLowerCase();
			const activeFile = this.app.workspace.getActiveFile();
			if (!activeFile) return [];
			return await this.getAllBlocksInFile(activeFile, blockQuery);
		}

		// 5) "file#^block" in specific file (must come BEFORE file#heading check)
		if (trimmedQuery.includes("#^")) {
			const [fileName, blockQuery = ""] = trimmedQuery.split("#^");
			const file = this.findFile(fileName);
			if (!file) return [];
			return await this.getAllBlocksInFile(file, blockQuery);
		}

		// 6) "file#heading" in specific file
		if (trimmedQuery.includes("#") && !trimmedQuery.startsWith("#")) {
			const [fileName, headingQuery = ""] = trimmedQuery.split("#");
			return this.getHeadingsInFile(fileName, headingQuery);
		}

		// 7) "file^block" in specific file (without #)
		if (trimmedQuery.includes("^") && !trimmedQuery.startsWith("^")) {
			const [fileName, blockQuery = ""] = trimmedQuery.split("^");
			const file = this.findFile(fileName);
			if (!file) return [];
			return await this.getAllBlocksInFile(file, blockQuery);
		}

		// 8) Default: [[file]]
		return this.getFiles(trimmedQuery);
	}

	getFiles(query: string): SuggestionItem[] {
		const files = this.app.vault.getFiles();
		const lowerQuery = query.toLowerCase();
		const currentFile = this.app.workspace.getActiveFile();
		const currentDir = currentFile ? currentFile.parent?.path : "";
		
		const results: SuggestionItem[] = [];
		
		for (const f of files) {
			const matchesQuery =
				f.path.toLowerCase().includes(lowerQuery) ||
				f.basename.toLowerCase().includes(lowerQuery);
			
			if (!matchesQuery) {
				// Check if query matches any aliases
				const aliases = this.getFileAliases(f);
				const aliasMatches = aliases.some(alias =>
					alias.toLowerCase().includes(lowerQuery)
				);
				if (!aliasMatches) continue;
			}
			
			const fileDir = f.parent?.path || "";
			const showPath = fileDir !== currentDir && fileDir !== "";
			
			// Add the file itself
			results.push({
				type: "file" as const,
				file: f,
				basename: f.basename,
				path: f.path,
				name: f.name,
				extension: f.extension,
				displayPath: showPath ? fileDir + "/" : "",
			});
			
			// Add aliases as separate suggestions
			const aliases = this.getFileAliases(f);
			for (const alias of aliases) {
				if (alias.toLowerCase().includes(lowerQuery)) {
					results.push({
						type: "alias" as const,
						file: f,
						alias: alias,
						basename: f.basename,
						path: f.path,
						name: f.name,
						extension: f.extension,
						displayPath: showPath ? fileDir + "/" : "",
					});
				}
			}
		}
		
		// Sort by modification time, putting files before aliases
		results.sort((a, b) => {
			if (a.file && b.file) {
				if (a.type === "file" && b.type === "alias") return -1;
				if (a.type === "alias" && b.type === "file") return 1;
				return b.file.stat.mtime - a.file.stat.mtime;
			}
			return 0;
		});
		
		return results.slice(0, 20);
	}
	
	getFileAliases(file: TFile): string[] {
		const cache = this.app.metadataCache.getFileCache(file);
		if (!cache || !cache.frontmatter) return [];
		
		const aliases: string[] = [];
		const frontmatter = cache.frontmatter;
		
		// Handle both alias and aliases fields
		if (frontmatter.alias) {
			if (Array.isArray(frontmatter.alias)) {
				aliases.push(...frontmatter.alias);
			} else if (typeof frontmatter.alias === 'string') {
				aliases.push(frontmatter.alias);
			}
		}
		
		if (frontmatter.aliases) {
			if (Array.isArray(frontmatter.aliases)) {
				aliases.push(...frontmatter.aliases);
			} else if (typeof frontmatter.aliases === 'string') {
				aliases.push(frontmatter.aliases);
			}
		}
		
		return aliases.filter(alias => alias && typeof alias === 'string');
	}

	getHeadingsInCurrentFile(): SuggestionItem[] {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) return [];
		const cache = this.app.metadataCache.getFileCache(activeFile);
		if (!cache || !cache.headings) return [];
		return cache.headings.map((h) => ({
			type: "heading" as const,
			heading: h.heading,
			level: h.level,
			file: activeFile,
		}));
	}

	getAllHeadings(): SuggestionItem[] {
		const files = this.app.vault.getMarkdownFiles();
		const all: SuggestionItem[] = [];
		for (const file of files) {
			const cache = this.app.metadataCache.getFileCache(file);
			if (cache && cache.headings) {
				cache.headings.forEach((h) => {
					all.push({
						type: "heading",
						heading: h.heading,
						level: h.level,
						file,
					});
				});
			}
		}
		return all.slice(0, 50);
	}

	getHeadingsInFile(fileName: string, headingQuery = ""): SuggestionItem[] {
		const files = this.app.vault.getFiles();
		const lowerFileName = fileName.toLowerCase();
		const file = files.find(
			(f) =>
				f.basename.toLowerCase() === lowerFileName ||
				f.path.toLowerCase().includes(lowerFileName)
		);
		if (!file) return [];

		const cache = this.app.metadataCache.getFileCache(file);
		if (!cache || !cache.headings) return [];

		const lowerHeadingQuery = headingQuery.toLowerCase();
		return cache.headings
			.filter(
				(h) => !headingQuery || h.heading.toLowerCase().includes(lowerHeadingQuery)
			)
			.map((h) => ({
				type: "heading" as const,
				heading: h.heading,
				level: h.level,
				file,
			}));
	}

	findFile(fileName: string): TFile | undefined {
		const files = this.app.vault.getFiles();
		const lowerFileName = fileName.toLowerCase();
		return files.find(
			(f) =>
				f.basename.toLowerCase() === lowerFileName ||
				f.path.toLowerCase().includes(lowerFileName)
		);
	}

	async getAllBlocksInFile(file: TFile, blockQuery = ""): Promise<SuggestionItem[]> {
		const cache = this.app.metadataCache.getFileCache(file);
		if (!cache) return [];

		const content = await this.app.vault.cachedRead(file);
		const lines = content.split("\n");
		const results: SuggestionItem[] = [];

		if (cache.sections) {
			for (const section of cache.sections) {
				if (["paragraph", "list", "blockquote", "code"].includes(section.type)) {
					const startLine = section.position.start.line;
					const endLine = section.position.end.line;
					const blockText = lines.slice(startLine, endLine + 1).join("\n");
					const blockIdMatch = blockText.match(/\^([a-zA-Z0-9-]+)\s*$/);
					const blockId = blockIdMatch ? blockIdMatch[1] : null;
					const displayText = blockId
						? blockText.replace(/\s*\^[a-zA-Z0-9-]+\s*$/, "")
						: blockText;

					if (blockQuery) {
						const q = blockQuery.toLowerCase();
						const matchesId = blockId && blockId.toLowerCase().includes(q);
						const matchesText = displayText.toLowerCase().includes(q);
						if (!matchesId && !matchesText) continue;
					}

					results.push({
						type: "block",
						blockId,
						blockText: displayText.trim(),
						file,
						position: section.position,
					});
				}
			}
		}

		return results;
	}

	generateBlockId(): string {
		return Math.random().toString(36).substr(2, 6);
	}

	async addBlockIdToFile(file: TFile, position: any, blockId: string) {
		const content = await this.app.vault.read(file);
		const lines = content.split("\n");
		const endLine = position.end.line;
		lines[endLine] = lines[endLine].trimEnd() + ` ^${blockId}`;
		await this.app.vault.modify(file, lines.join("\n"));
	}

	renderSuggestion(item: SuggestionItem, el: HTMLElement): void {
		el.addClass("mod-complex");
		const content = el.createDiv({ cls: "suggestion-content" });

		if (item.type === "heading") {
			content.createDiv({
				text: item.heading || "",
				cls: "suggestion-title",
			});
			const aux = el.createDiv({ cls: "suggestion-aux" });
			aux.createSpan({
				text: `H${item.level}`,
				cls: "suggestion-flair",
			});

			if (item.file) {
				const currentQuery = this.inputEl.value.trim();
				const currentFile = this.app.workspace.getActiveFile();
				const isFilenameHeadingPattern =
					currentQuery.includes("#") &&
					!currentQuery.startsWith("#") &&
					!currentQuery.startsWith("##");
				const showPath =
					!isFilenameHeadingPattern &&
					(!currentFile || item.file.path !== currentFile.path);

				if (showPath) {
					content.createDiv({
						text: item.file.path,
						cls: "suggestion-note",
					});
				}
			}
		} else if (item.type === "block") {
			const blockText = item.blockText || "";
			const displayText =
				blockText.length > 100 ? blockText.substring(0, 100) + "..." : blockText;
			content.createDiv({
				text: displayText,
				cls: "suggestion-title",
			});
			if (item.blockId) {
				content.createDiv({
					text: `^${item.blockId}`,
					cls: "suggestion-note",
				});
			}
		} else if (item.type === "alias") {
			// Alias
			const displayName = item.alias || "";
			const displayPath = item.displayPath || "";
			
			content.createDiv({ text: displayName, cls: "suggestion-title" });
			
			// Show the actual filename as a note
			content.createDiv({
				text: `→ ${item.basename || ""}`,
				cls: "suggestion-note"
			});
			
			// Only show path if it's in a different folder than current note
			if (displayPath && displayPath !== "/") {
				content.createDiv({ text: displayPath, cls: "suggestion-note" });
			}
		} else {
			// File
			const displayName = item.basename || "";
			const displayPath = item.displayPath || "";
			
			content.createDiv({ text: displayName, cls: "suggestion-title" });
			
			// Only show path if it's in a different folder than current note
			if (displayPath && displayPath !== "/") {
				content.createDiv({ text: displayPath, cls: "suggestion-note" });
			}
		}
	}

	async selectSuggestion(item: SuggestionItem): Promise<void> {
		let linkValue: string;

		if (item.type === "heading") {
			const currentFile = this.app.workspace.getActiveFile();
			if (item.file && currentFile && item.file.path === currentFile.path) {
				linkValue = `#${item.heading}`;
			} else if (item.file) {
				const fileName = item.file.basename;
				linkValue = `${fileName}#${item.heading}`;
			} else {
				linkValue = `#${item.heading}`;
			}
		} else if (item.type === "block") {
			if (!item.blockId) {
				const newBlockId = this.generateBlockId();
				if (item.file && item.position) {
					await this.addBlockIdToFile(item.file, item.position, newBlockId);
					item.blockId = newBlockId;
				}
			}

			const currentFile = this.app.workspace.getActiveFile();
			if (item.file && currentFile && item.file.path === currentFile.path) {
				linkValue = `#^${item.blockId}`;
			} else if (item.file) {
				const fileName = item.file.basename;
				linkValue = `${fileName}#^${item.blockId}`;
			} else {
				linkValue = `#^${item.blockId}`;
			}
		} else if (item.type === "alias") {
			// Alias - use the actual file basename as the link value, not the alias text
			if (item.file && item.file.extension === "md") {
				linkValue = item.file.basename || "";
			} else if (item.file) {
				linkValue = item.file.name || "";
			} else {
				linkValue = item.alias || "";
			}
		} else {
			// File - don't include path in the final link value
			if (item.extension === "md") {
				linkValue = item.basename || "";
			} else {
				linkValue = item.name || "";
			}
		}

		this.inputEl.value = linkValue;
		this.modal.handleDestInput();
		this.close();

		if (document.activeElement !== this.inputEl) {
			this.inputEl.focus();
		}
	}

	// Helper method to check if suggestions are open
	get isSuggestOpen(): boolean {
		// Check if the suggestion container exists and has suggestions
		const container = document.querySelector(".suggestion-container");
		return container !== null && !container.hasClass("is-hidden");
	}

	selectCurrentSuggestion(): void {
		// Find the selected suggestion and trigger its click event
		const selected = document.querySelector(".suggestion-item.is-selected") as HTMLElement;
		if (selected) {
			selected.click();
		}
	}
}
