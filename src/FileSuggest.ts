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
	getCompletionText,
	flashSuggestContainer,
	generateBlockId,
	addBlockIdToFile
} from "./suggestionLogic";

export class FileSuggest extends AbstractInputSuggest<SuggestionItem> {
	modal: EditLinkModal;
	inputEl: HTMLInputElement;
	private focusValue: string = "";

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
			this.scope.register([], "Tab", () => {
				let selectedId = (this as any).selectedId;
				
				// Resolve selected ID dynamically by querying the suggest DOM list
				if (selectedId === undefined) {
					const suggestInnerEl = (this as any).suggestInnerEl;
					if (suggestInnerEl) {
						const selectedEl = suggestInnerEl.querySelector(".suggestion-item.is-selected");
						if (selectedEl) {
							const items = Array.from(suggestInnerEl.querySelectorAll(".suggestion-item"));
							const index = items.indexOf(selectedEl);
							if (index !== -1) {
								selectedId = index;
							}
						}
					}
				}

				let values = (this as any).values || (this as any).suggestions;
				if (selectedId === undefined) {
					selectedId = (this as any).suggestions?.selectedId;
				}
				if (!Array.isArray(values)) {
					values = (this as any).suggestions?.values;
				}

				if (selectedId === undefined || !values || !values[selectedId]) {
					return true;
				}

				const item = values[selectedId];
				const completionText = getCompletionText(item, this.inputEl.value);

				if (this.inputEl.value.trim() === completionText.trim()) {
					// Flash completion window to show it is already fully completed
					const containers = document.querySelectorAll(".suggestion-container");
					for (let i = 0; i < containers.length; i++) {
						const container = containers[i];
						if (!container.classList.contains("is-hidden") && (container as HTMLElement).style.display !== "none") {
							flashSuggestContainer(container as HTMLElement);
							break;
						}
					}
					return false; // consume event
				} else {
					this.inputEl.value = completionText;
					this.modal.handleDestInput();
					// Refresh suggestion window to match the new value
					this.inputEl.dispatchEvent(new Event("input"));
					return false; // consume event
				}
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

		return this.getSuggestionsInternal(query);
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
		let linkValue: string;
		let newLinkText: string | null = null;

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
				const newBlockId = generateBlockId();
				if (item.file && item.position) {
					await addBlockIdToFile(item.file, this.app, item.position, newBlockId);
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
			if (item.file && item.file.extension === "md") {
				linkValue = item.file.basename || "";
			} else if (item.file) {
				linkValue = item.file.name || "";
			} else {
				linkValue = item.alias || "";
			}
			newLinkText = item.alias || "";
		} else {
			if (item.extension === "md") {
				linkValue = item.basename || "";
				newLinkText = item.basename || "";
			} else {
				linkValue = item.name || "";
				newLinkText = item.name || "";
			}
		}

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
		const containers = document.querySelectorAll(".suggestion-container");
		for (let i = 0; i < containers.length; i++) {
			const container = containers[i];
			if (!container.classList.contains("is-hidden") && (container as HTMLElement).style.display !== "none") {
				return true;
			}
		}
		return false;
	}

	selectCurrentSuggestion(): void {
		const selected = document.querySelector(".suggestion-item.is-selected") as HTMLElement;
		if (selected) {
			selected.click();
		}
	}
}
