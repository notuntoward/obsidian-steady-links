import { App, TFile } from "obsidian";
import { SuggestionItem } from "./types";
import { isUrl } from "./utils";
import { parseSuggestionQuery } from "./suggestionQuery";

export async function getSuggestionItems(
	query: string,
	app: App,
	isWiki: boolean
): Promise<SuggestionItem[]> {
	if (isUrl(query)) return [];

	const trimmedQuery = query.trim();

	// Non-wiki: just files.
	if (!isWiki) {
		return getFiles(trimmedQuery, app);
	}

	const parsed = parseSuggestionQuery(query);

	switch (parsed.type) {
		case "global-heading": {
			const headingQuery = (parsed.searchTerm ?? "").toLowerCase();
			const allHeadings = await getAllHeadings(app);
			if (!headingQuery) return allHeadings;
			return allHeadings.filter(
				(h) => h.heading && h.heading.toLowerCase().includes(headingQuery)
			);
		}
		case "current-block":
		case "block": {
			const blockQuery = (parsed.searchTerm ?? "").toLowerCase();
			const activeFile = app.workspace.getActiveFile();
			if (!activeFile) return [];
			return await getAllBlocksInFile(activeFile, app, blockQuery);
		}
		case "current-heading": {
			const headingQuery = (parsed.searchTerm ?? "").toLowerCase();
			const allHeadings = await getHeadingsInCurrentFile(app);
			if (!headingQuery) return allHeadings;
			return allHeadings.filter(
				(h) => h.heading && h.heading.toLowerCase().includes(headingQuery)
			);
		}
		case "file-block":
		case "file-block-no-hash": {
			const file = findFile(parsed.fileName ?? "", app);
			if (!file) return [];
			const blockQuery = (parsed.searchTerm ?? "").toLowerCase();
			return await getAllBlocksInFile(file, app, blockQuery);
		}
		case "file-heading": {
			return await getHeadingsInFile(parsed.fileName ?? "", app, parsed.searchTerm ?? "");
		}
		case "file-alias": {
			return getFileAliasesForFile(parsed.fileName ?? "", parsed.searchTerm ?? "", app);
		}
		case "file":
		default:
			return getFiles(parsed.searchTerm ?? "", app);
	}
}

export function getFiles(query: string, app: App): SuggestionItem[] {
	const files = app.vault.getFiles();
	const lowerQuery = query.toLowerCase();
	const currentFile = app.workspace.getActiveFile();
	let currentDir = currentFile ? currentFile.parent?.path : "";
	if (currentDir === "/") {
		currentDir = "";
	}

	const results: SuggestionItem[] = [];

	for (const f of files) {
		const aliases = lowerQuery ? getFileAliases(f, app) : [];
		const matchesName =
			f.path.toLowerCase().includes(lowerQuery) ||
			f.basename.toLowerCase().includes(lowerQuery);
		const matchingAliases = aliases.filter((alias) =>
			alias.toLowerCase().includes(lowerQuery)
		);

		// Skip file if neither name nor any alias matches
		if (!matchesName && matchingAliases.length === 0) continue;

		let fileDir = f.parent?.path || "";
		if (fileDir === "/") {
			fileDir = "";
		}
		const showPath = fileDir !== currentDir && fileDir !== "";

		// Always add the file itself when name matches
		if (matchesName) {
			results.push({
				type: "file" as const,
				file: f,
				basename: f.basename,
				path: f.path,
				name: f.name,
				extension: f.extension,
				displayPath: showPath ? fileDir + "/" : "",
			});
		}

		// When there is query text, add alias suggestions:
		// - All aliases if the file name matched (to allow picking an alias for a known file)
		// - Only matching aliases if found via alias search
		// Skip alias rows when query is empty (avoid flooding the list before the user types)
		if (lowerQuery) {
			const aliasesToShow = matchesName ? aliases : matchingAliases;
			for (const alias of aliasesToShow) {
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

	// Add unresolved links to match stock Obsidian suggest
	const unresolved = app.metadataCache.unresolvedLinks;
	const unresolvedPaths = new Set<string>();
	if (unresolved) {
		for (const sourcePath in unresolved) {
			for (const linkPath in unresolved[sourcePath]) {
				unresolvedPaths.add(linkPath);
			}
		}
	}

	for (const linkPath of unresolvedPaths) {
		const parts = linkPath.split("/");
		const filename = parts[parts.length - 1];
		const dotIdx = filename.lastIndexOf(".");
		const basename = dotIdx > 0 ? filename.substring(0, dotIdx) : filename;
		const ext = dotIdx > 0 ? filename.substring(dotIdx + 1) : "";

		const matchesName =
			linkPath.toLowerCase().includes(lowerQuery) ||
			basename.toLowerCase().includes(lowerQuery);

		if (!matchesName) continue;

		// Deduplicate: if we already have this path in results, skip it!
		if (results.some(r => r.path === linkPath)) continue;

		const fileDir = parts.slice(0, -1).join("/");
		const showPath = fileDir !== currentDir && fileDir !== "";

		results.push({
			type: "file" as const,
			basename,
			path: linkPath,
			name: filename,
			extension: ext,
			displayPath: showPath ? fileDir + "/" : "",
		});
	}

	// Sort by modification time, putting files before aliases
	results.sort((a, b) => {
		if (a.file && b.file) {
			if (a.type === "file" && b.type === "alias") return -1;
			if (a.type === "alias" && b.type === "file") return 1;
			return b.file.stat.mtime - a.file.stat.mtime;
		}
		if (a.type === "file" && b.type === "alias") return -1;
		if (a.type === "alias" && b.type === "file") return 1;
		return 0;
	});

	return results.slice(0, 20);
}

export function getFileAliases(file: TFile, app: App): string[] {
	const cache = app.metadataCache.getFileCache(file);
	if (!cache || !cache.frontmatter) return [];

	const aliases: string[] = [];
	const frontmatter = cache.frontmatter;

	// Handle both alias and aliases fields
	if (frontmatter.alias) {
		if (Array.isArray(frontmatter.alias)) {
			aliases.push(...frontmatter.alias.map(String));
		} else if (typeof frontmatter.alias === "string") {
			aliases.push(frontmatter.alias);
		}
	}

	if (frontmatter.aliases) {
		if (Array.isArray(frontmatter.aliases)) {
			aliases.push(...frontmatter.aliases.map(String));
		} else if (typeof frontmatter.aliases === "string") {
			aliases.push(frontmatter.aliases);
		}
	}

	return aliases.filter((alias) => alias && typeof alias === "string");
}

export function getFileAliasesForFile(targetFileName: string, searchTerm: string, app: App): SuggestionItem[] {
	const files = app.vault.getFiles();
	// Strip heading/block suffix from targetFileName to get raw file/note name
	const rawNoteName = targetFileName.split("#")[0].split("^")[0].trim();
	const cleanTarget = rawNoteName.toLowerCase();
	let targetFile: TFile | undefined;

	if (cleanTarget) {
		for (const f of files) {
			if (f.basename.toLowerCase() === cleanTarget || f.name.toLowerCase() === cleanTarget || f.path.toLowerCase() === cleanTarget) {
				targetFile = f;
				break;
			}
		}

		if (!targetFile) {
			for (const f of files) {
				if (f.basename.toLowerCase().includes(cleanTarget)) {
					targetFile = f;
					break;
				}
			}
		}
	}

	const results: SuggestionItem[] = [];
	const lowerSearch = searchTerm.toLowerCase();

	if (targetFile) {
		const aliases = getFileAliases(targetFile, app);
		for (const alias of aliases) {
			if (!lowerSearch || alias.toLowerCase().includes(lowerSearch)) {
				results.push({
					type: "alias",
					file: targetFile,
					alias: alias,
					basename: targetFile.basename,
					path: targetFile.path,
					name: targetFile.name,
					extension: targetFile.extension,
				});
			}
		}
	}

	if (searchTerm.trim().length > 0) {
		const exists = results.some((r) => r.alias?.toLowerCase() === lowerSearch);
		if (!exists) {
			results.push({
				type: "alias",
				file: targetFile,
				alias: searchTerm.trim(),
				basename: targetFile ? targetFile.basename : rawNoteName,
			});
		}
	}

	if (results.length === 0) {
		results.push({
			type: "alias",
			file: targetFile,
			alias: targetFile ? targetFile.basename : (rawNoteName || "alias"),
			basename: targetFile ? targetFile.basename : rawNoteName,
			path: targetFile ? targetFile.path : "",
			name: targetFile ? targetFile.name : "",
			extension: targetFile ? targetFile.extension : "md",
		});
	}

	return results;
}

export function getHeadingsInCurrentFile(app: App): SuggestionItem[] {
	const activeFile = app.workspace.getActiveFile();
	if (!activeFile) return [];
	const cache = app.metadataCache.getFileCache(activeFile);
	if (!cache || !cache.headings) return [];
	return cache.headings.map((h) => ({
		type: "heading" as const,
		heading: h.heading,
		level: h.level,
		file: activeFile,
	}));
}

/**
 * Search headings across every markdown file in the vault, matching stock
 * Obsidian's own `##` global-heading search (`SuggestManager.
 * getGlobalHeadingSuggestions`), which iterates every cached file and
 * returns every matching heading with no result cap. This must stay
 * uncapped for the same reason: capping it (this function previously
 * stopped at 50 results) silently drops real headings from a `##` search
 * the moment the vault has more than 50 headings, which looks like most of
 * the vault's headings have simply vanished.
 */
export function getAllHeadings(app: App): SuggestionItem[] {
	const files = app.vault.getMarkdownFiles();
	const all: SuggestionItem[] = [];
	for (const file of files) {
		const cache = app.metadataCache.getFileCache(file);
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
	return all;
}

export function getHeadingsInFile(fileName: string, app: App, headingQuery = ""): SuggestionItem[] {
	const file = findFile(fileName, app);
	if (!file) return [];

	const cache = app.metadataCache.getFileCache(file);
	if (!cache || !cache.headings) return [];

	const lowerHeadingQuery = headingQuery.toLowerCase();
	return cache.headings
		.filter((h) => !headingQuery || h.heading.toLowerCase().includes(lowerHeadingQuery))
		.map((h) => ({
			type: "heading" as const,
			heading: h.heading,
			level: h.level,
			file,
		}));
}

export function findFile(fileName: string, app: App): TFile | undefined {
	if (!fileName) return undefined;
	const activeFile = app.workspace.getActiveFile();
	const sourcePath = activeFile ? activeFile.path : "";
	let file: TFile | null = null;
	try {
		file = app.metadataCache.getFirstLinkpathDest(fileName, sourcePath);
	} catch {
		file = null;
	}
	if (file) return file;

	// Fallback for partial/subpath matches
	const files = app.vault.getFiles();
	const lowerFileName = fileName.toLowerCase();
	return (
		files.find((f) => f.basename.toLowerCase() === lowerFileName) ||
		files.find((f) => f.path.toLowerCase().includes(lowerFileName))
	);
}

export async function getAllBlocksInFile(file: TFile, app: App, blockQuery = ""): Promise<SuggestionItem[]> {
	const cache = app.metadataCache.getFileCache(file);
	if (!cache) return [];

	const content = await app.vault.cachedRead(file);
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

export function generateBlockId(): string {
	let result = "";
	while (result.length < 6) {
		result += Math.random().toString(36).substring(2);
	}
	return result.substring(0, 6);
}

export async function addBlockIdToFile(file: TFile, app: App, position: any, blockId: string) {
	const content = await app.vault.read(file);
	const lines = content.split("\n");
	const endLine = position.end.line;
	lines[endLine] = lines[endLine].trimEnd() + ` ^${blockId}`;
	await app.vault.modify(file, lines.join("\n"));
}

function highlightMatches(el: HTMLElement, text: string, query: string): void {
	if (!query) {
		el.createSpan({ text });
		return;
	}
	const index = text.toLowerCase().indexOf(query.toLowerCase());
	if (index !== -1) {
		const before = text.substring(0, index);
		const match = text.substring(index, index + query.length);
		const after = text.substring(index + query.length);
		
		if (before) el.createSpan({ text: before });
		el.createSpan({ text: match, cls: "suggestion-highlight" });
		if (after) el.createSpan({ text: after });
	} else {
		el.createSpan({ text });
	}
}

export function renderSuggestionItem(
	item: SuggestionItem,
	el: HTMLElement,
	currentQuery: string,
	app: App
): void {
	el.addClass("mod-complex");
	const content = el.createDiv({ cls: "suggestion-content" });

	const parsed = parseSuggestionQuery(currentQuery);
	const searchTerm = parsed.searchTerm || "";

	if (item.type === "heading") {
		const titleEl = content.createDiv({ cls: "suggestion-title" });
		highlightMatches(titleEl, item.heading || "", searchTerm);

		const aux = el.createDiv({ cls: "suggestion-aux" });
		aux.createSpan({
			text: `H${item.level}`,
			cls: "suggestion-flair",
		});

		if (item.file) {
			const currentFile = app.workspace.getActiveFile();
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
		const titleEl = content.createDiv({ cls: "suggestion-title" });
		highlightMatches(titleEl, displayText, searchTerm);

		if (item.blockId) {
			content.createDiv({
				text: `^${item.blockId}`,
				cls: "suggestion-note",
			});
		}
	} else if (item.type === "alias") {
		const displayName = item.alias || "";
		const displayPath = item.displayPath || "";

		const titleEl = content.createDiv({ cls: "suggestion-title" });
		highlightMatches(titleEl, displayName, searchTerm);

		content.createDiv({
			text: `→ ${item.basename || ""}`,
			cls: "suggestion-note",
		});

		if (displayPath && displayPath !== "/") {
			content.createDiv({ text: displayPath, cls: "suggestion-note" });
		}
	} else {
		const displayName = item.extension === "md" ? (item.basename || "") : (item.name || "");
		const displayPath = item.displayPath || "";

		const titleEl = content.createDiv({ cls: "suggestion-title" });
		highlightMatches(titleEl, displayName, searchTerm);

		if (displayPath && displayPath !== "/") {
			content.createDiv({ text: displayPath, cls: "suggestion-note" });
		}
	}

	// Add hint at bottom of suggestion container dynamically. Stock
	// Obsidian's own suggest (SuggestManager.getInstructions()) only shows
	// the "#"/"^"/"|" mode-switch hints while the query is still a plain
	// file search; once the query has already switched into heading/block/
	// alias mode (e.g. "##", "#Heading", "^block"), it shows "↵ to accept"
	// instead, since typing "#"/"^" again no longer switches anything.
	// Match that exactly rather than always showing the file-mode hints.
	const container = el.closest(".suggestion-container");
	if (container) {
		let hintEl = container.querySelector(".steady-links-hint");
		if (hintEl) hintEl.remove();
		hintEl = container.createDiv({ cls: "steady-links-hint" });
		if (parsed.type === "file") {
			hintEl.createSpan({ text: "Type ", cls: "steady-links-hint-label" });
			hintEl.createSpan({ text: "#", cls: "steady-links-hint-key" });
			hintEl.createSpan({ text: " to link heading   Type ", cls: "steady-links-hint-label" });
			hintEl.createSpan({ text: "^", cls: "steady-links-hint-key" });
			hintEl.createSpan({ text: " to link blocks   Type ", cls: "steady-links-hint-label" });
			hintEl.createSpan({ text: "|", cls: "steady-links-hint-key" });
			hintEl.createSpan({ text: " to change display text", cls: "steady-links-hint-label" });
		} else {
			hintEl.createSpan({ text: "↵", cls: "steady-links-hint-key" });
			hintEl.createSpan({ text: " to accept", cls: "steady-links-hint-label" });
		}
	}
}

/**
 * Compute the link destination (and, where applicable, a starting alias
 * text) for a chosen suggestion item.
 *
 * This is the single shared implementation of the item-type branching that
 * both `FileSuggest` (used inside the Edit Link modal's destination field)
 * and `EditorFileSuggest` (used for in-editor `[[` autocomplete) previously
 * duplicated verbatim in their own `selectSuggestion` methods. Assigns a
 * new block ID to `item` (via `addBlockIdToFile`) as a side effect when a
 * block-reference item doesn't already have one, exactly as the original
 * duplicated code did.
 *
 * @param includeNewLinkTextForPlainFile Only `FileSuggest` wants a plain
 *   (non-heading/block/alias) file suggestion to also pre-fill a starting
 *   alias text (for its separate "Link Text" field); `EditorFileSuggest`
 *   inserts directly into the document and intentionally leaves plain file
 *   links alias-less, so it passes `false` here. This preserves each
 *   caller's exact prior behavior.
 */
export async function computeSelectedLinkValue(
	item: SuggestionItem,
	app: App,
	includeNewLinkTextForPlainFile: boolean
): Promise<{ linkValue: string; newLinkText: string | null }> {
	let linkValue: string;
	let newLinkText: string | null = null;

	if (item.type === "heading") {
		const currentFile = app.workspace.getActiveFile();
		if (item.file && (!currentFile || item.file.path !== currentFile.path)) {
			linkValue = `${item.file.basename}#${item.heading}`;
		} else {
			linkValue = `#${item.heading}`;
		}
	} else if (item.type === "block") {
		if (!item.blockId && item.file && item.position) {
			const newBlockId = generateBlockId();
			await addBlockIdToFile(item.file, app, item.position, newBlockId);
			item.blockId = newBlockId;
		}

		const currentFile = app.workspace.getActiveFile();
		if (item.file && (!currentFile || item.file.path !== currentFile.path)) {
			linkValue = `${item.file.basename}#^${item.blockId}`;
		} else {
			linkValue = `#^${item.blockId}`;
		}
	} else if (item.type === "alias") {
		linkValue = item.file
			? (item.file.extension === "md" ? (item.file.basename || "") : (item.file.name || ""))
			: (item.alias || "");
		newLinkText = item.alias || "";
	} else {
		if (item.extension === "md") {
			linkValue = item.basename || "";
			if (includeNewLinkTextForPlainFile) newLinkText = item.basename || "";
		} else {
			linkValue = item.name || "";
			if (includeNewLinkTextForPlainFile) newLinkText = item.name || "";
		}
	}

	return { linkValue, newLinkText };
}

export function getCompletionText(item: SuggestionItem, query: string): string {
	if (item.type === "heading") {
		if (query.includes("#") && !query.startsWith("#") && !query.startsWith("##")) {
			const filePart = query.split("#")[0];
			return `${filePart}#${item.heading}`;
		}
		return `#${item.heading}`;
	}
	if (item.type === "block") {
		if (query.includes("#^") && !query.startsWith("#^")) {
			const filePart = query.split("#^")[0];
			return `${filePart}#^${item.blockId}`;
		}
		if (query.includes("^") && !query.startsWith("^") && !query.includes("#^")) {
			const filePart = query.split("^")[0];
			return `${filePart}#^${item.blockId}`;
		}
		return `#^${item.blockId}`;
	}
	if (item.type === "alias") {
		if (query.includes("|")) {
			const filePart = query.split("|")[0];
			return `${filePart}|${item.alias || ""}`;
		}
		if (item.file && item.file.extension === "md") {
			return item.file.basename;
		}
		return item.file ? item.file.name : (item.alias ?? "");
	}
	if (item.extension === "md") {
		return item.basename || "";
	}
	return item.name || "";
}

/**
 * Resolve what a Tab-completion keypress should do with the currently
 * highlighted suggestion against the current text: the completion text to
 * write, and whether the text already exactly matches it (in which case the
 * caller should just flash the popup instead of editing anything).
 *
 * This centralizes the "resolve selected item -> getCompletionText -> compare
 * case-insensitively, trimmed" sequence that both `FileSuggest` (completing
 * the Edit Link modal's destination `<input>`) and `EditorFileSuggest`
 * (completing the in-editor `[[` query) need identically; only what each
 * caller does with the result (write to an `<input>` vs. `Editor.replaceRange`)
 * differs, and stays in each class.
 */
export function resolveCompletion(
	item: SuggestionItem,
	currentText: string
): { completionText: string; alreadyComplete: boolean } {
	const completionText = getCompletionText(item, currentText);
	const alreadyComplete = currentText.trim().toLowerCase() === completionText.trim().toLowerCase();
	return { completionText, alreadyComplete };
}

/**
 * Find the currently visible Obsidian suggestion popup container, if any.
 *
 * Obsidian keeps one `.suggestion-container` per registered suggest in the
 * DOM at all times, hiding inactive ones via the `is-hidden` class or an
 * inline `display: none`. This is the single, shared place that knows both
 * of those hidden-state markers — every call site that needs to find or
 * check for the active suggestion popup should go through this function
 * rather than re-scanning `document.querySelectorAll(".suggestion-container")`
 * with its own copy of the visibility check, so a future Obsidian change to
 * how popups are hidden only needs to be updated here.
 */
export function findVisibleSuggestionContainer(): HTMLElement | null {
	if (typeof document === "undefined") return null;
	const containers = document.querySelectorAll(".suggestion-container");
	for (let i = 0; i < containers.length; i++) {
		const container = containers[i] as HTMLElement;
		if (!container.classList.contains("is-hidden") && container.style.display !== "none") {
			return container;
		}
	}
	return null;
}

/**
 * Resolve the item the user currently has highlighted in an `AbstractInputSuggest`
 * or `EditorSuggest` popup.
 *
 * Obsidian does not expose a stable public API for "the currently selected
 * suggestion" on either base class, so this reads several undocumented
 * internal property names (`values`/`suggestions`/`suggestions.values` for
 * the item list, `selectedId`/`suggestions.selectedId` for the highlighted
 * index) with a DOM-scraping fallback (`.suggestion-item.is-selected`) if
 * none of those are present. Centralizing this here means only one place
 * needs to be updated if a future Obsidian version renames these internals,
 * instead of two independent copies drifting out of sync.
 *
 * @param instance The suggest instance (`this` from the caller) — typed as
 *   `unknown` since the properties being read are undocumented internals of
 *   whichever Obsidian suggest base class is calling this.
 * @param lastSuggestions The caller's own tracked copy of the last rendered
 *   suggestion list, used first before falling back to Obsidian's internals.
 */
export function getSelectedSuggestionItem<T>(
	instance: unknown,
	lastSuggestions: T[]
): T | undefined {
	const internal = instance as {
		values?: unknown;
		suggestions?: { values?: unknown; selectedId?: number };
		selectedId?: number;
	};

	let items: T[] = lastSuggestions;
	if (!items || items.length === 0) {
		let candidate: unknown = internal.values ?? internal.suggestions;
		if (!Array.isArray(candidate)) {
			candidate = internal.suggestions?.values;
		}
		if (Array.isArray(candidate)) {
			items = candidate as T[];
		}
	}

	if (!items || items.length === 0) return undefined;

	let selectedId: number | undefined = internal.selectedId;
	if (selectedId === undefined) {
		selectedId = internal.suggestions?.selectedId;
	}

	if (selectedId === undefined) {
		const container = findVisibleSuggestionContainer();
		if (container) {
			const selectedEl = container.querySelector(".suggestion-item.is-selected");
			if (selectedEl) {
				const allItems = Array.from(container.querySelectorAll(".suggestion-item"));
				const idx = allItems.indexOf(selectedEl);
				if (idx !== -1) {
					selectedId = idx;
				}
			}
		}
	}

	if (selectedId === undefined && items.length > 0) {
		selectedId = 0;
	}

	if (selectedId !== undefined && items[selectedId]) {
		return items[selectedId];
	}

	return undefined;
}

export function flashSuggestContainer(customContainer?: HTMLElement) {
	const container = customContainer ?? findVisibleSuggestionContainer() ?? undefined;
	if (container) {
		container.classList.remove("is-flashing");
		void (container as any).offsetWidth; // trigger reflow to restart animation
		container.classList.add("is-flashing");
		window.setTimeout(() => {
			if (container) {
				container.classList.remove("is-flashing");
			}
		}, 150);
	}
}
