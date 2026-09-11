import { App, TFile, AbstractInputSuggest } from "obsidian";
import { SuggestionItem } from "./types";
import { isUrl } from "./utils";
import type { EditLinkModal } from "./EditLinkModal";
import { parseSuggestionQuery } from "./suggestionQuery";
import {
	getFiles,
	getHeadingsInCurrentFile,
	getAllHeadings,
	getHeadingsInFile,
	getAllBlocksInFile,
	findFile,
	renderSuggestionItem,
	resolveCompletion,
	flashSuggestContainer,
	findVisibleSuggestionContainer,
	getSelectedSuggestionItem,
	computeSelectedLinkValue
} from "./suggestionLogic";

import { getFileAliasesForFile } from "./suggestionLogic";

export class FileSuggest extends AbstractInputSuggest<SuggestionItem> {
	modal: EditLinkModal;
	inputEl: HTMLInputElement;
	private focusValue: string = "";
	private lastSuggestions: SuggestionItem[] = [];

	constructor(app: App, textInputEl: HTMLInputElement, modal: EditLinkModal) {
		super(app, textInputEl);
		this.modal = modal;
		this.inputEl = textInputEl;

		// Initialize focusValue to prevent suggestions on first focus
		this.focusValue = this.inputEl.value;

		// Track the input value when focus happens
		this.inputEl.addEventListener("focus", (e) => {
			this.focusValue = this.inputEl.value;
		});

		if (this.scope) {
			// Register TAB key to complete the prefix/basename and not close suggest
			this.scope.register(null, "Tab", (evt?: KeyboardEvent) => {
				if (evt?.isComposing) return true;

				const item = getSelectedSuggestionItem(this, this.lastSuggestions);
				if (!item) return true;

				if (evt) {
					evt.preventDefault();
					evt.stopPropagation();
				}

				const { completionText, alreadyComplete } = resolveCompletion(item, this.inputEl.value);

				if (alreadyComplete) {
					// Flash completion window to show it is already fully completed
					const container = findVisibleSuggestionContainer();
					if (container) flashSuggestContainer(container);
					return false; // consume event
				}

				this.inputEl.value = completionText;
				this.modal.handleDestInput();
				// Refresh suggestion window to match the new value
				this.inputEl.dispatchEvent(new Event("input"));
				return false; // consume event
			});

		}
	}

	async getSuggestions(query: string): Promise<SuggestionItem[]> {
		// Only show suggestions if the destination input is actually focused
		const isAttached = this.inputEl.ownerDocument?.body?.contains(this.inputEl);
		if (isAttached && this.inputEl.ownerDocument.activeElement !== this.inputEl) {
			return [];
		}

		// Don't show suggestions automatically on focus when tabbing
		// Only show if the user has actually modified the input
		if (query === this.focusValue && query.trim().length > 0) {
			return [];
		}

		const items = await this.getSuggestionsInternal(query);
		this.lastSuggestions = items;
		return items;
	}

	async getSuggestionsInternal(query: string): Promise<SuggestionItem[]> {
		if (isUrl(query)) return [];

		const trimmedQuery = query.trim();

		// Non-wiki: just files.
		if (!this.modal.isWiki) {
			return this.getFiles(trimmedQuery);
		}

		const parsed = parseSuggestionQuery(query);

		switch (parsed.type) {
			case "global-heading": {
				const headingQuery = (parsed.searchTerm ?? "").toLowerCase();
				const allHeadings = await this.getAllHeadings();
				if (!headingQuery) return allHeadings;
				return allHeadings.filter(
					(h) => h.heading && h.heading.toLowerCase().includes(headingQuery)
				);
			}
			case "current-block":
			case "block": {
				const blockQuery = (parsed.searchTerm ?? "").toLowerCase();
				const activeFile = this.app.workspace.getActiveFile();
				if (!activeFile) return [];
				return await this.getAllBlocksInFile(activeFile, blockQuery);
			}
			case "current-heading": {
				const headingQuery = (parsed.searchTerm ?? "").toLowerCase();
				const allHeadings = await this.getHeadingsInCurrentFile();
				if (!headingQuery) return allHeadings;
				return allHeadings.filter(
					(h) => h.heading && h.heading.toLowerCase().includes(headingQuery)
				);
			}
			case "file-block":
			case "file-block-no-hash": {
				const file = this.findFile(parsed.fileName ?? "");
				if (!file) return [];
				const blockQuery = (parsed.searchTerm ?? "").toLowerCase();
				return await this.getAllBlocksInFile(file, blockQuery);
			}
			case "file-heading": {
				return await this.getHeadingsInFile(parsed.fileName ?? "", parsed.searchTerm ?? "");
			}
			case "file-alias": {
				return this.getFileAliasesForFile(parsed.fileName ?? "", parsed.searchTerm ?? "");
			}
			case "file":
			default:
				return this.getFiles(parsed.searchTerm ?? "");
		}
	}

	getFiles(query: string): SuggestionItem[] {
		return getFiles(query, this.app);
	}

	getHeadingsInCurrentFile(): SuggestionItem[] {
		return getHeadingsInCurrentFile(this.app);
	}

	getAllHeadings(): SuggestionItem[] {
		return getAllHeadings(this.app);
	}

	getHeadingsInFile(fileName: string, headingQuery = ""): SuggestionItem[] {
		return getHeadingsInFile(fileName, this.app, headingQuery);
	}

	getFileAliasesForFile(targetFileName: string, searchTerm: string): SuggestionItem[] {
		return getFileAliasesForFile(targetFileName, searchTerm, this.app);
	}

	getAllBlocksInFile(file: TFile, blockQuery = ""): Promise<SuggestionItem[]> {
		return getAllBlocksInFile(file, this.app, blockQuery);
	}

	findFile(fileName: string): TFile | undefined {
		return findFile(fileName, this.app);
	}

	renderSuggestion(item: SuggestionItem, el: HTMLElement): void {
		const query = this.inputEl.value;
		renderSuggestionItem(item, el, query, this.app);
	}

	async selectSuggestion(item: SuggestionItem, evt?: MouseEvent | KeyboardEvent): Promise<void> {
		const { linkValue, newLinkText } = await computeSelectedLinkValue(item, this.app, true);

		this.inputEl.value = linkValue;
		this.modal.handleDestInput();
		this.close();

		let focusMoved = false;

		if (newLinkText !== null && this.modal.isTextProvisional()) {
			const textEl = this.modal.textInput.inputEl;
			textEl.value = newLinkText;
			this.modal.link.text = newLinkText;
			this.modal.textModifiedByUser = true;
			if (item.type === "alias" && item.alias) {
				this.modal.showAliasNotice(item.alias);
			} else {
				this.modal.clearAliasNotice();
			}

			// Focus and select the Link Text field if selecting an alias
			textEl.focus();
			textEl.select();
			focusMoved = true;
		}

		if (!focusMoved && typeof this.modal.getFocusableElements === "function") {
			const focusable = this.modal.getFocusableElements();
			const destIdx = focusable.indexOf(this.inputEl);
			if (destIdx !== -1 && focusable.length > 1) {
				const nextEl = focusable[(destIdx + 1) % focusable.length];
				if (nextEl) {
					nextEl.focus();
					if (nextEl.tagName === "INPUT") {
						(nextEl as HTMLInputElement).select();
					}
				}
			}
		}
	}

	get isSuggestOpen(): boolean {
		return findVisibleSuggestionContainer() !== null;
	}

	selectCurrentSuggestion(): void {
		const selected = document.querySelector(".suggestion-item.is-selected") as HTMLElement;
		if (selected) {
			selected.click();
		}
	}
}
