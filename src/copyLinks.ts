import { TFile } from "obsidian";
import type {
	CachedMetadata,
	EmbedCache,
	EditorPosition,
	ListItemCache,
	Pos,
	SectionCache,
	TAbstractFile,
} from "obsidian";

export interface MarkdownLinkGenerator {
	generateMarkdownLink(file: TFile, sourcePath: string, subpath?: string, alias?: string): string;
}

/**
 * Delegate link syntax and path encoding to Obsidian so links follow the
 * vault's "Use [[Wikilinks]]" preference.
 */
export function generateFileLink(
	file: TFile,
	generator: MarkdownLinkGenerator,
	sourcePath = file.path,
	subpath?: string,
	alias?: string
): string {
	const displayAlias =
		alias ?? (file.extension.toLowerCase() === "pdf" ? file.basename : undefined);
	return generator.generateMarkdownLink(file, sourcePath, subpath, displayAlias);
}

/**
 * Location links follow Copy link to element: always target the note by its
 * vault-relative path, even when the target is the active note. Keep Obsidian
 * in charge of selecting the vault's configured link syntax and Markdown
 * encoding, but preserve the full path and alias spacing used by that command
 * for wikilinks.
 */
export function generateLocationLink(
	file: TFile,
	generator: MarkdownLinkGenerator,
	subpath: string,
	alias?: string
): string {
	const generated = generator.generateMarkdownLink(file, "", subpath, alias);
	if (!generated.startsWith("[[")) return generated;

	const aliasPart = alias === undefined ? "" : ` |${alias}`;
	return `[[${file.path}${subpath}${aliasPart}]]`;
}

export function selectedFileFromMenu(files: readonly TAbstractFile[]): TFile | null {
	return files.length === 1 && files[0] instanceof TFile ? files[0] : null;
}

export function shouldAddFileLinkMenuItem(source: string, includeTabHeader: boolean): boolean {
	return source !== "tab-header" || includeTabHeader;
}

export function isSupportedFileTarget(file: TFile): boolean {
	const extension = file.extension.toLowerCase();
	return extension !== "canvas" && extension !== "ink";
}

export interface SelectionRange {
	from: EditorPosition;
	to: EditorPosition;
	text: string;
}

export type LocationKind = "heading" | "block" | "table";

interface InsertionPoint {
	position: EditorPosition;
	style: "inline" | "separate-line";
}

export interface ResolvedLocation {
	kind: LocationKind;
	heading?: string;
	blockId?: string;
	alias?: string;
	insertion?: InsertionPoint;
}

export interface LocationResolution {
	target: ResolvedLocation | null;
	reason: string | null;
}

interface OffsetRange {
	from: number;
	to: number;
}

interface Candidate {
	range: OffsetRange;
	cursorRange?: OffsetRange;
	locationKind?: LocationKind;
	target?: ResolvedLocation;
	reason?: string;
}

interface SourceText {
	content: string;
	lines: string[];
	lineOffsets: number[];
}

const NO_TARGET = "Place the cursor in one heading, block, list item, or table.";
const AMBIGUOUS = "The selection or cursor matches multiple targets; no link was copied.";
const MULTI_TARGET_SELECTION =
	"Select text wholly within one heading, block, or table to copy a location link.";
const EMBED_SELECTION_UNRESOLVABLE =
	"The embed could not be mapped to exactly one host-note block.";
const IMAGE_EXTENSIONS = new Set(["bmp", "gif", "jpeg", "jpg", "png", "svg", "webp"]);

function indexSource(content: string): SourceText {
	const lines = content.split("\n");
	const lineOffsets = [0];
	for (let line = 1; line < lines.length; line++) {
		lineOffsets.push(lineOffsets[line - 1] + lines[line - 1].length + 1);
	}
	return { content, lines, lineOffsets };
}

function editorOffset(source: SourceText, position: EditorPosition): number | null {
	if (
		!Number.isInteger(position.line) ||
		!Number.isInteger(position.ch) ||
		position.line < 0 ||
		position.line >= source.lines.length ||
		position.ch < 0 ||
		position.ch > source.lines[position.line].length
	) {
		return null;
	}
	return source.lineOffsets[position.line] + position.ch;
}

function editorPosition(source: SourceText, offset: number): EditorPosition | null {
	if (!Number.isInteger(offset) || offset < 0 || offset > source.content.length) return null;
	let low = 0;
	let high = source.lineOffsets.length - 1;
	while (low <= high) {
		const middle = Math.floor((low + high) / 2);
		if (source.lineOffsets[middle] <= offset) low = middle + 1;
		else high = middle - 1;
	}
	const line = Math.max(0, high);
	const ch = offset - source.lineOffsets[line];
	if (ch > source.lines[line].length) return null;
	return { line, ch };
}

function metadataRange(position: Pos, source: SourceText): OffsetRange | null {
	const from = editorOffset(source, {
		line: position.start.line,
		ch: position.start.col,
	});
	const to = editorOffset(source, {
		line: position.end.line,
		ch: position.end.col,
	});
	if (from === null || to === null || from > to) return null;
	if (position.start.offset !== from || position.end.offset !== to) return null;
	return { from, to };
}

function editorLineRange(source: SourceText, startLine: number, endLine: number): OffsetRange | null {
	const from = source.lineOffsets[startLine];
	const endLineStart = source.lineOffsets[endLine];
	const endLineText = source.lines[endLine];
	if (from === undefined || endLineStart === undefined || endLineText === undefined) return null;
	return { from, to: endLineStart + endLineText.length };
}

function containsCursor(range: OffsetRange, cursor: number): boolean {
	return cursor >= range.from && cursor <= range.to;
}

function containsSelection(range: OffsetRange, selection: OffsetRange): boolean {
	return selection.from >= range.from && selection.to <= range.to;
}

function overlaps(a: OffsetRange, b: OffsetRange): boolean {
	return a.from < b.to && b.from < a.to;
}

function sameRange(a: OffsetRange, b: OffsetRange): boolean {
	return a.from === b.from && a.to === b.to;
}

function cursorInsideRange(range: OffsetRange, cursor: number): boolean {
	return cursor >= range.from && cursor < range.to;
}

function embedPath(link: string): string {
	let path = link.split("#", 1)[0];
	try {
		path = new URL(path).pathname;
	} catch {
		path = path.split("?", 1)[0];
	}
	return path;
}

function decodedEmbedFilename(link: string): string | null {
	const filename = embedPath(link).split(/[\\/]/).pop() ?? "";
	if (!filename) return null;
	try {
		return decodeURIComponent(filename);
	} catch {
		// Keep the parser's literal filename when it is not valid URI encoding.
		return filename;
	}
}

function embedFilename(link: string): string | null {
	const filename = decodedEmbedFilename(link);
	if (!filename) return null;
	const extension = filename.lastIndexOf(".");
	return extension > 0 ? filename.slice(0, extension) : filename;
}

function isImageEmbed(embed: EmbedCache): boolean {
	const filename = decodedEmbedFilename(embed.link);
	if (!filename) return false;
	const extension = filename.slice(filename.lastIndexOf(".") + 1).toLowerCase();
	return filename.lastIndexOf(".") > 0 && IMAGE_EXTENSIONS.has(extension);
}

function aliasForEmbeddedImage(embed: EmbedCache): string | null {
	const displayText = embed.displayText?.trim();
	return displayText || embedFilename(embed.link);
}

function lineAt(source: SourceText, lineNumber: number): string | null {
	return source.lines[lineNumber] ?? null;
}

interface FencedCodeBlock {
	body: OffsetRange;
	allowsFenceCursor: boolean;
	closingFenceEnd: EditorPosition;
}

function fencedCodeBlock(source: SourceText, section: SectionCache): FencedCodeBlock | null {
	const startLine = lineAt(source, section.position.start.line);
	const endLine = lineAt(source, section.position.end.line);
	if (
		startLine === null ||
		endLine === null ||
		section.position.start.line >= section.position.end.line
	) {
		return null;
	}

	const opening = startLine.match(/^( {0,3})(`{3,}|~{3,})(.*)$/);
	const closing = endLine.match(/^( {0,3})(`{3,}|~{3,})[ \t]*$/);
	if (
		!opening ||
		!closing ||
		opening[2][0] !== closing[2][0] ||
		closing[2].length < opening[2].length ||
		(opening[2][0] === "`" && opening[3].includes("`")) ||
		section.position.start.col > opening[1].length ||
		section.position.end.col < closing[1].length + closing[2].length
	) {
		return null;
	}

	const bodyFrom = source.lineOffsets[section.position.start.line + 1];
	const closingLineStart = source.lineOffsets[section.position.end.line];
	const bodyTo = closingLineStart - 1;
	if (bodyFrom === undefined || bodyFrom > bodyTo) return null;
	const language = opening[3].trim().split(/\s+/, 1)[0]?.toLowerCase();

	return {
		body: { from: bodyFrom, to: bodyTo },
		allowsFenceCursor: language !== "mermaid",
		closingFenceEnd: {
			line: section.position.end.line,
			ch: endLine.length,
		},
	};
}

function hasUnindexedTrailingBlockId(source: SourceText, range: OffsetRange): boolean {
	const endLine = editorPosition(source, range.to)?.line;
	if (endLine === undefined) return false;
	const marker = /(?:^|\s)\^[A-Za-z0-9-]+\s*$/;
	if (marker.test(source.lines[endLine])) return true;
	// Table block IDs may be represented on the immediately following line.
	return /^\s*\^[A-Za-z0-9-]+\s*$/.test(source.lines[endLine + 1] ?? "");
}

function insertionForSection(source: SourceText, section: SectionCache): InsertionPoint | null {
	const endLine = section.position.end.line;
	const line = lineAt(source, endLine);
	if (line === null) return null;

	const afterSectionText = line.slice(section.position.end.col);
	if (afterSectionText.trim() !== "") return null;

	if (section.type === "table") {
		return {
			position: { line: endLine, ch: line.length },
			style: "separate-line",
		};
	}

	if (section.type === "code") {
		const codeBlock = fencedCodeBlock(source, section);
		if (!codeBlock) return null;
		return { position: codeBlock.closingFenceEnd, style: "separate-line" };
	}

	const ch = line.trimEnd().length;
	if (ch === 0) return null;
	return { position: { line: endLine, ch }, style: "inline" };
}

function insertionForListItem(source: SourceText, item: ListItemCache): InsertionPoint | null {
	const line = lineAt(source, item.position.end.line);
	if (line === null || line.slice(item.position.end.col).trim() !== "") return null;
	const ch = line.trimEnd().length;
	if (ch === 0) return null;
	return { position: { line: item.position.end.line, ch }, style: "inline" };
}

function targetForSection(
	source: SourceText,
	section: SectionCache,
	range: OffsetRange,
	selectedAlias?: string,
	sectionRange: OffsetRange = range
): Candidate {
	const blockId = section.id;
	if (blockId) {
		return {
			range,
			locationKind: section.type === "table" ? "table" : "block",
			target: {
				kind: section.type === "table" ? "table" : "block",
				blockId,
				alias: selectedAlias,
			},
		};
	}
	if (hasUnindexedTrailingBlockId(source, sectionRange)) {
		return {
			range,
			locationKind: section.type === "table" ? "table" : "block",
			reason: "A block ID is present, but Obsidian's metadata has not resolved it yet.",
		};
	}
	const insertion = insertionForSection(source, section);
	if (!insertion) {
		return {
			range,
			locationKind: section.type === "table" ? "table" : "block",
			reason: "This block's link ID cannot be inserted at a verified source boundary.",
		};
	}
	return {
		range,
		locationKind: section.type === "table" ? "table" : "block",
		target: {
			kind: section.type === "table" ? "table" : "block",
			alias: selectedAlias,
			insertion,
		},
	};
}

function targetForListItem(
	source: SourceText,
	item: ListItemCache,
	range: OffsetRange,
	selectedAlias?: string
): Candidate {
	if (item.id) {
		return {
			range,
			locationKind: "block",
			target: { kind: "block", blockId: item.id, alias: selectedAlias },
		};
	}
	if (hasUnindexedTrailingBlockId(source, range)) {
		return {
			range,
			locationKind: "block",
			reason: "A list-item ID is present, but Obsidian's metadata has not resolved it yet.",
		};
	}
	const insertion = insertionForListItem(source, item);
	if (!insertion) {
		return {
			range,
			locationKind: "block",
			reason: "This list item spans multiple source lines, so its ID insertion scope is ambiguous.",
		};
	}
	return {
		range,
		locationKind: "block",
		target: { kind: "block", alias: selectedAlias, insertion },
	};
}

/**
 * Resolve a cursor, one text selection, or an exact embed-object selection
 * only from Obsidian's parser metadata. The caller should treat a null target
 * as unavailable in menus and command checks, and show the returned reason if
 * the user explicitly invokes it.
 */
export function resolveLocation(input: {
	content: string;
	cache: CachedMetadata | null;
	cursor: EditorPosition;
	selection?: SelectionRange;
}): LocationResolution {
	const { content, cache, selection } = input;
	if (!cache) {
		return { target: null, reason: "Obsidian has not indexed this note yet." };
	}

	const source = indexSource(content);
	const cursor = editorOffset(source, input.cursor);
	if (cursor === null) {
		return {
			target: null,
			reason: "The editor position could not be matched to the note source.",
		};
	}

	const embedEntries = (cache.embeds ?? []).map((embed) => ({
		embed,
		range: metadataRange(embed.position, source),
	}));
	let selectedRange: OffsetRange | undefined;
	if (selection) {
		const from = editorOffset(source, selection.from);
		const to = editorOffset(source, selection.to);
		if (from === null || to === null || from >= to) {
			return {
				target: null,
				reason: "The text selection could not be matched to the note source.",
			};
		}
		selectedRange = { from, to };
	}

	const positionedEmbeds = embedEntries.filter(
		(entry): entry is { embed: EmbedCache; range: OffsetRange } => entry.range !== null
	);
	let embeddedTarget: EmbedCache | undefined;
	if (selectedRange) {
		const touching = positionedEmbeds.filter((entry) => overlaps(entry.range, selectedRange!));
		const exact = touching.filter((entry) => sameRange(entry.range, selectedRange!));
		// An object selection must map to one complete parser-known embed token;
		// partial or mixed selections are not safe object targets.
		if (touching.length > 0 && (touching.length !== 1 || exact.length !== 1)) {
			return {
				target: null,
				reason: "A mixed text/embed selection cannot be mapped to one location.",
			};
		}
		embeddedTarget = exact[0]?.embed;
		if (!embeddedTarget && content.slice(selectedRange.from, selectedRange.to) !== selection?.text) {
			return {
				target: null,
				reason: "The editor selection is out of date with the note metadata.",
			};
		}
	} else {
		const containing = positionedEmbeds.filter((entry) =>
			cursorInsideRange(entry.range, cursor)
		);
		if (containing.length > 1) {
			return { target: null, reason: EMBED_SELECTION_UNRESOLVABLE };
		}
		embeddedTarget = containing[0]?.embed;
	}

	if (selectedRange && embedEntries.some((entry) => entry.range === null)) {
		return {
			target: null,
			reason: "An embed's source position is stale, so the selection cannot be resolved reliably.",
		};
	}

	let selectedAlias = selection?.text;
	if (embeddedTarget) {
		selectedAlias = undefined;
		if (selectedRange && isImageEmbed(embeddedTarget)) {
			selectedAlias = aliasForEmbeddedImage(embeddedTarget) ?? undefined;
			if (!selectedAlias) {
				return { target: null, reason: "The selected image has no resolvable display name." };
			}
		}
	}

	const candidates: Candidate[] = [];

	for (const heading of cache.headings ?? []) {
		const range = metadataRange(heading.position, source);
		if (!range) continue;
		const matching = (cache.headings ?? []).filter(
			(other) =>
				other.heading.trim().toLocaleLowerCase() ===
				heading.heading.trim().toLocaleLowerCase()
		);
		const duplicate = matching.length > 1;
		candidates.push(
			duplicate
				? {
						range,
						reason: "This heading is duplicated, so its Obsidian anchor cannot be distinguished safely.",
					}
				: {
						range,
						target: {
							kind: "heading",
							heading: heading.heading,
							// Keep the anchor live across renames unless the user selected display text.
							alias: selectedAlias,
						},
					}
		);
	}

	for (const section of cache.sections ?? []) {
		if (!["paragraph", "blockquote", "callout", "table", "code"].includes(section.type)) {
			continue;
		}
		const range = metadataRange(section.position, source);
		if (!range) continue;
		const codeBlock = section.type === "code" ? fencedCodeBlock(source, section) : null;
		if (section.type === "code" && !codeBlock) {
			candidates.push({
				range,
				locationKind: "block",
				reason: "The code block's fenced boundaries could not be verified safely.",
			});
			continue;
		}
		const candidate = targetForSection(
			source,
			section,
			codeBlock?.body ?? range,
			selectedAlias,
			range
		);
		if (section.type === "code" && codeBlock?.allowsFenceCursor) {
			// Match Copy link to element for ordinary code sections: metadata
			// includes both fences, but text selections remain body-only.
			candidate.cursorRange =
				editorLineRange(source, section.position.start.line, section.position.end.line) ??
				range;
		}
		candidates.push(candidate);
	}

	for (const item of cache.listItems ?? []) {
		const range = metadataRange(item.position, source);
		if (!range) continue;
		candidates.push(targetForListItem(source, item, range, selectedAlias));
	}

	const matches = candidates.filter((candidate) =>
		selectedRange
			? containsSelection(candidate.range, selectedRange)
			: containsCursor(candidate.cursorRange ?? candidate.range, cursor)
	).filter((candidate) =>
		embeddedTarget
			? candidate.locationKind === "block" || candidate.locationKind === "table"
			: true
	);
	if (matches.length > 1) {
		// Nested list items overlap their parents in parser positions. The
		// smallest containing item is the most specific parser target.
		const sorted = matches
			.filter((candidate) => candidate.target?.kind === "block")
			.sort((a, b) => a.range.to - a.range.from - (b.range.to - b.range.from));
		if (sorted.length && matches.every((candidate) => candidate.target?.kind === "block")) {
			const smallest = sorted[0];
			if (
				sorted[1] &&
				sorted[1].range.to - sorted[1].range.from ===
					smallest.range.to - smallest.range.from
			) {
				return { target: null, reason: AMBIGUOUS };
			}
			return smallest.target
				? { target: smallest.target, reason: null }
				: { target: null, reason: smallest.reason ?? AMBIGUOUS };
		}
		return { target: null, reason: AMBIGUOUS };
	}
	if (matches.length === 0) {
		return {
			target: null,
			reason: embeddedTarget
				? EMBED_SELECTION_UNRESOLVABLE
				: selectedRange
					? MULTI_TARGET_SELECTION
					: NO_TARGET,
		};
	}

	const match = matches[0];
	if (match.reason) return { target: null, reason: match.reason };
	if (!match.target) return { target: null, reason: NO_TARGET };
	if (selection?.text.includes("\n")) {
		return { target: null, reason: "A multi-line alias cannot be generated safely." };
	}
	return { target: match.target, reason: null };
}

export interface LocationLinkPlan {
	subpath: string;
	insertion?: { position: EditorPosition; text: string };
}

export function planLocationLink(
	target: ResolvedLocation,
	knownIds: ReadonlySet<string>,
	createId: () => string
): LocationLinkPlan | null {
	if (target.kind === "heading") {
		if (!target.heading) return null;
		return { subpath: `#${target.heading}` };
	}
	if (target.blockId) return { subpath: `#^${target.blockId}` };
	if (!target.insertion) return null;

	for (let attempt = 0; attempt < 32; attempt++) {
		const id = createId();
		if (!/^[A-Za-z0-9-]+$/.test(id) || knownIds.has(id)) continue;
		return {
			subpath: `#^${id}`,
			insertion: {
				position: target.insertion.position,
				// Tables and fenced code need a marker line of their own; keep it
				// adjacent to the block instead of adding an empty spacer line.
				text: target.insertion.style === "separate-line" ? `\n^${id}` : ` ^${id}`,
			},
		};
	}
	return null;
}

export function defaultBlockLinkText(noteName: string, blockId: string): string {
	const compactName = noteName.trim().replace(/\s+/g, "-");
	return `${compactName}-block-${blockId}`;
}

export function knownBlockIds(cache: CachedMetadata): Set<string> {
	const ids = new Set<string>(Object.keys(cache.blocks ?? {}));
	for (const section of cache.sections ?? []) {
		if (section.id) ids.add(section.id);
	}
	for (const item of cache.listItems ?? []) {
		if (item.id) ids.add(item.id);
	}
	return ids;
}
