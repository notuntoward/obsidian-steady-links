import { App, Modal, Setting, TextComponent, ButtonComponent, ToggleComponent } from "obsidian";
import { LinkInfo } from "./types";
import { FileSuggest } from "./FileSuggest";
import { 
	wikiToMarkdown, 
	markdownToWiki, 
	parseClipboardLink,
	validateLinkDestination,
} from "./utils";
import {
	parseClipboardFlags,
	determineInitialFocus,
	handleDestChange,
	computeConversionNotice,
	validateSubmission,
	determineInitialLinkType,
} from "./modalLogic";

export class EditLinkModal extends Modal {
	link: LinkInfo;
	onSubmit: (result: LinkInfo) => void;
	shouldSelectText: boolean;
	conversionNotice: string | null;
	isWiki: boolean;
	wasUrl: boolean;
	isNewLink: boolean;
	clipboardUsedText: boolean;
	clipboardUsedDest: boolean;
	conversionNoticeEl!: HTMLElement | null;

	textInput!: TextComponent;
	destInput!: TextComponent;
	fileSuggest!: FileSuggest;
	typeSetting!: Setting;
	toggleComponent!: ToggleComponent;
	embedToggle!: ToggleComponent;
	applyBtn!: ButtonComponent;
	warningsContainer!: HTMLElement;

	constructor(
		app: App,
		link: LinkInfo,
		onSubmit: (result: LinkInfo) => void,
		shouldSelectText?: boolean,
		conversionNotice?: string | null,
		isNewLink?: boolean
	) {
		super(app);
		this.link = link;
		this.onSubmit = onSubmit;
		this.shouldSelectText = shouldSelectText || false;
		this.conversionNotice = conversionNotice || null;
		this.isWiki = false;
		this.wasUrl = false;
		this.isNewLink = isNewLink || false;
		this.conversionNoticeEl = null;

		// Parse the conversion notice to determine what was used from clipboard
		const flags = parseClipboardFlags(conversionNotice);
		this.clipboardUsedText = flags.clipboardUsedText;
		this.clipboardUsedDest = flags.clipboardUsedDest;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h4", { text: "Edit Link" });

		// Determine initial link type
		const initialState = determineInitialLinkType(this.link.destination, this.link.isWiki);
		this.isWiki = initialState.isWiki;
		this.wasUrl = initialState.wasUrl;

		// Link Text
		new Setting(contentEl)
			.setName("Link Text")
			.addText((text) => {
				this.textInput = text;
				text.setValue(this.link.text);
				text.inputEl.style.width = "100%";
				text.inputEl.addEventListener("input", () => {
					this.clearValidationErrors();
					this.updateUIState();
					this.updateConversionNotice();
				});
			});

		// Destination
		const destSetting = new Setting(contentEl).setName("Destination");

		destSetting.addText((text) => {
			this.destInput = text;
			text.setValue(this.link.destination);
			text.inputEl.style.width = "100%";

			this.fileSuggest = new FileSuggest(this.app, text.inputEl, this);

			text.inputEl.addEventListener("input", () => {
				this.handleDestInput();
				this.updateConversionNotice();
			});
		});

		// Warnings container
		this.warningsContainer = contentEl.createDiv({ cls: "link-warnings-container" });

		// Conversion notice
		if (this.conversionNotice) {
			this.conversionNoticeEl = this.warningsContainer.createEl("div", {
				cls: "link-conversion-notice",
				text: this.conversionNotice,
			});
		}

		// Link Type toggle
		this.typeSetting = new Setting(contentEl)
			.setName("Link Type")
			.setDesc(this.isWiki ? "Wikilink" : "Markdown Link")
			.addToggle((toggle) => {
				this.toggleComponent = toggle;
				toggle.setValue(this.isWiki).onChange((value) => {
					const dest = this.destInput.getValue();

					if (value && !this.isWiki) {
						const converted = markdownToWiki(dest);
						if (converted !== null && converted !== dest) {
							this.destInput.setValue(converted);
						}
					} else if (!value && this.isWiki) {
						const converted = wikiToMarkdown(dest);
						if (converted !== dest) {
							this.destInput.setValue(converted);
						}
					}
					this.isWiki = value;
					this.updateUIState();
				});

				toggle.toggleEl.setAttribute("tabindex", "0");
				toggle.toggleEl.addEventListener("keydown", (e) => {
					if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
						e.preventDefault();
						const newValue = !toggle.getValue();

						const dest = this.destInput.getValue();
						if (newValue && !this.isWiki) {
							const converted = markdownToWiki(dest);
							if (converted !== null && converted !== dest) {
								this.destInput.setValue(converted);
							}
						} else if (!newValue && this.isWiki) {
							const converted = wikiToMarkdown(dest);
							if (converted !== dest) {
								this.destInput.setValue(converted);
							}
						}

						toggle.setValue(newValue);
						this.isWiki = newValue;
						this.updateUIState();
					}
				});
			});

		// Embed checkbox
		const embedSetting = new Setting(contentEl)
			.setName("Embed content")
			.setDesc(this.link.isEmbed ? "Link contents shown in note" : "Link shown in note")
			.addToggle((toggle) => {
				this.embedToggle = toggle;
				toggle.setValue(this.link.isEmbed || false);
				
				toggle.onChange((value) => {
					embedSetting.setDesc(value ? "Link contents shown in note" : "Link shown in note");
				});

				toggle.toggleEl.setAttribute("tabindex", "0");
				toggle.toggleEl.addEventListener("keydown", (e) => {
					if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
						e.preventDefault();
						e.stopPropagation();
						const currentValue = toggle.getValue();
						toggle.setValue(!currentValue);
						embedSetting.setDesc(!currentValue ? "Link contents shown in note" : "Link shown in note");
					}
				});
			});
		embedSetting.settingEl.addClass("link-embed-checkbox");

		// Apply button
		new Setting(contentEl).addButton((btn) => {
			this.applyBtn = btn;
			btn
				.setButtonText("Apply")
				.setCta()
				.onClick(() => {
					this.submit();
				});
		});

		// Key handling
		this.modalEl.addEventListener("keydown", (e) => {
			// TAB: accept suggestion if open, otherwise cycle focus
			if (e.key === "Tab") {
				// If on dest and suggester open, Tab accept suggestion (don't cycle focus)
				if (document.activeElement === this.destInput.inputEl) {
					const isOpen = this.fileSuggest.isSuggestOpen;
					if (isOpen && this.destInput.getValue().trim().length > 0) {
						e.preventDefault();
						this.fileSuggest.selectCurrentSuggestion();
						return; // Stay on dest input after accepting suggestion
					}
				}

				// Normal tab cycling when no suggestion is open
				e.preventDefault();
				const focusable = this.getFocusableElements();
				const active = document.activeElement as HTMLElement;
				let index = focusable.indexOf(active);
				if (index === -1) index = 0;

				const forward = !e.shiftKey;
				const step = forward ? 1 : -1;
				const nextIndex = (index + step + focusable.length) % focusable.length;
				const nextElement = focusable[nextIndex];
				nextElement.focus();

				// Select text when focusing on text inputs
				if (nextElement === this.textInput.inputEl || nextElement === this.destInput.inputEl) {
					(nextElement as HTMLInputElement).select();
				}

				return;
			}

			// Enter
			if (e.key === "Enter") {
				const isOpen = this.fileSuggest.isSuggestOpen;
				if (isOpen) return; // let suggester handle Enter

				e.preventDefault();
				this.submit();
				return;
			}

			// Escape
			if (e.key === "Escape") {
				const isOpen = this.fileSuggest.isSuggestOpen;
				if (isOpen) {
					this.fileSuggest.close();
					return;
				}
				this.close();
			}
		});

		this.updateUIState();
		this.populateFromClipboard();
		this.setInitialFocus();
	}

	getFocusableElements(): HTMLElement[] {
		return [
			this.textInput.inputEl,
			this.destInput.inputEl,
			this.toggleComponent.toggleEl,
			this.embedToggle.toggleEl,
			this.applyBtn.buttonEl,
		].filter((el) => el && el.offsetParent !== null);
	}

	setInitialFocus() {
		const action = determineInitialFocus(
			this.link.text,
			this.link.destination,
			this.shouldSelectText,
		);

		switch (action) {
			case "text-focus":
				this.textInput.inputEl.focus();
				break;
			case "text-select":
				this.textInput.inputEl.focus();
				this.textInput.inputEl.select();
				break;
			case "dest-focus":
				this.destInput.inputEl.focus();
				break;
			case "dest-select":
				this.destInput.inputEl.focus();
				this.destInput.inputEl.select();
				break;
		}
	}

	async populateFromClipboard() {
		try {
			const clipboardText = await navigator.clipboard.readText();
			const parsedLink = parseClipboardLink(clipboardText);

			if (parsedLink) {
				// Only populate fields that are empty
				if (!this.link.text.trim()) {
					this.textInput.setValue(parsedLink.text);
					this.link.text = parsedLink.text;
				}

				if (!this.link.destination.trim()) {
					this.destInput.setValue(parsedLink.destination);
					this.link.destination = parsedLink.destination;
				}

				// Update the link type based on the parsed link
				this.isWiki = parsedLink.isWiki;
				this.toggleComponent.setValue(parsedLink.isWiki);

				// IMPORTANT: Never modify the embed state from clipboard
				// - For existing links: preserve the original embed state
				// - For new links: start with embed state as false (unembedded)
				// The embed toggle is already set correctly in the constructor

				this.updateUIState();
			}
		} catch (error) {
			// Silently fail if clipboard access is denied or unavailable
			console.debug("Could not access clipboard", error);
		}
	}

	handleDestInput = () => {
		const val = this.destInput.getValue();
		const result = handleDestChange(val, this.isWiki);

		if (result.isWiki !== this.isWiki) {
			this.toggleComponent.setValue(result.isWiki);
		}
		this.isWiki = result.isWiki;
		this.wasUrl = result.wasUrl;

		this.clearValidationErrors();
		this.updateUIState();
	};

	clearValidationErrors() {
		const existingValidation = this.warningsContainer.querySelectorAll(".link-validation-error");
		existingValidation.forEach((w) => w.remove());
		this.textInput.inputEl.classList.remove("link-warning-highlight");
		this.destInput.inputEl.classList.remove("link-warning-highlight");
	}

	updateConversionNotice() {
		if (!this.conversionNoticeEl) return;

		const noticeText = computeConversionNotice(
			this.textInput.getValue(),
			this.destInput.getValue(),
			this.link.text,
			this.link.destination,
			this.clipboardUsedText,
			this.clipboardUsedDest,
		);

		if (noticeText === null) {
			this.conversionNoticeEl.remove();
			this.conversionNoticeEl = null;
		} else {
			this.conversionNoticeEl.textContent = noticeText;
		}
	}

	/**
	 * Updates the UI state based on the current link destination and type
	 * Uses the refactored validateLinkDestination function for cleaner code
	 */
	updateUIState() {
		this.typeSetting.setDesc(this.isWiki ? "Wikilink" : "Markdown Link");

		// Clear previous warnings
		const existingWarnings = this.warningsContainer.querySelectorAll(".link-warning");
		existingWarnings.forEach((w) => w.remove());
		this.destInput.inputEl.classList.remove("link-warning-highlight");
		this.textInput.inputEl.classList.remove("link-warning-highlight");

		const dest = this.destInput.getValue();
		const linkText = this.textInput.getValue();

		// Use the refactored validation function
		const validationResult = validateLinkDestination(dest, linkText, this.isWiki);

		// Display warnings
		if (validationResult.warnings.length > 0) {
			validationResult.warnings.forEach((warning) => {
				const cls = warning.severity === 'error' ? 'link-warning-error' : 'link-warning-caution';
				this.warningsContainer.createEl("div", {
					cls: `link-warning ${cls}`,
					text: warning.text,
				});
			});
		}

		// Highlight fields as needed
		if (validationResult.shouldHighlightDest) {
			this.destInput.inputEl.classList.add("link-warning-highlight");
		}
		if (validationResult.shouldHighlightText) {
			this.textInput.inputEl.classList.add("link-warning-highlight");
		}
	}

	submit = () => {
		// Clear previous validation errors
		this.clearValidationErrors();

		const validation = validateSubmission(
			this.textInput.getValue(),
			this.destInput.getValue(),
		);

		if (!validation.valid) {
			const errorDiv = this.warningsContainer.createEl("div", {
				cls: "link-warning link-validation-error link-warning-error",
			});
			errorDiv.createEl("div", { text: validation.error! });
			errorDiv.createEl("div", {
				text: "Press Escape to cancel and close without making changes.",
				cls: "link-validation-hint",
			});
			this.destInput.inputEl.focus();
			this.destInput.inputEl.classList.add("link-warning-highlight");
			return;
		}

		this.onSubmit({
			text: validation.finalText,
			destination: validation.finalDest,
			isWiki: this.isWiki,
			isEmbed: this.embedToggle.getValue(),
		});

		this.close();
	};

	onClose() {
		this.contentEl.empty();
	}
}
