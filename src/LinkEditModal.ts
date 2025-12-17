import { App, Modal, Setting, TextComponent, ButtonComponent, ToggleComponent } from "obsidian";
import { LinkInfo } from "./types";
import { FileSuggest } from "./FileSuggest";
import { isValidWikiLink, isValidMarkdownLink, wikiToMarkdown, markdownToWiki, parseClipboardLink } from "./utils";

export class LinkEditModal extends Modal {
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
		this.clipboardUsedText = false;
		this.clipboardUsedDest = false;
		if (conversionNotice) {
			if (conversionNotice.includes("text & destination")) {
				this.clipboardUsedText = true;
				this.clipboardUsedDest = true;
			} else if (conversionNotice.includes("text")) {
				this.clipboardUsedText = true;
			} else if (conversionNotice.includes("destination")) {
				this.clipboardUsedDest = true;
			}
		}
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h4", { text: "Edit Link" });

		if (this.isUrl(this.link.destination)) {
			this.isWiki = false;
		} else {
			this.isWiki = this.link.isWiki;
		}

		this.wasUrl = this.isUrl(this.link.destination);

		// Link Text
		new Setting(contentEl).setName("Link Text").addText((text) => {
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
					if (e.key === " " || e.key === "Spacebar") {
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
			.addToggle((toggle) => {
				this.embedToggle = toggle;
				toggle.setValue(this.link.isEmbed || false);
				toggle.toggleEl.setAttribute("tabindex", "0");
				toggle.toggleEl.addEventListener("keydown", (e) => {
					if (e.key === " " || e.key === "Spacebar") {
						e.preventDefault();
						e.stopPropagation();
						const currentValue = toggle.getValue();
						toggle.setValue(!currentValue);
					}
				});
			});
		embedSetting.settingEl.addClass("link-embed-checkbox");
		// Apply button
		new Setting(contentEl).addButton((btn) => {
			this.applyBtn = btn;
			btn.setButtonText("Apply")
				.setCta()
				.onClick(() => this.submit());
		});

		// Key handling
		this.modalEl.addEventListener("keydown", (e) => {
			// TAB: accept suggestion if open, otherwise cycle focus
			if (e.key === "Tab") {
				// If on dest and suggester open, Tab = accept suggestion (don't cycle focus)
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

			// Ctrl+N / Ctrl+P to navigate suggestions
			if (
				e.ctrlKey &&
				(e.key === "n" || e.key === "p") &&
				document.activeElement === this.destInput.inputEl
			) {
				if (this.fileSuggest.isSuggestOpen) {
					e.preventDefault();
					e.stopPropagation();
					const arrowKey = e.key === "n" ? "ArrowDown" : "ArrowUp";
					const container = document.querySelector(".suggestion-container");
					if (container) {
						container.dispatchEvent(
							new KeyboardEvent("keydown", {
								key: arrowKey,
								bubbles: true,
								cancelable: true,
							})
						);
					}
					return;
				}
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

	setInitialFocus(): void {
		const linkText = this.link.text;
		const linkDest = this.link.destination;
		const destLength = linkDest ? linkDest.length : 0;

		if (!linkText || linkText.length === 0) {
			this.textInput.inputEl.focus();
		} else if (!linkDest || linkDest.length === 0) {
			this.destInput.inputEl.focus();
		} else if (destLength > 500 || this.isAlmostUrl(linkDest)) {
			this.destInput.inputEl.focus();
			this.destInput.inputEl.select();
		} else if (this.shouldSelectText) {
			this.textInput.inputEl.focus();
			this.textInput.inputEl.select();
		} else {
			this.textInput.inputEl.focus();
			if (linkText && linkText.length > 0) {
				this.textInput.inputEl.select();
			}
		}
	}

	async populateFromClipboard(): Promise<void> {
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
					
					// Update the link type based on the parsed link
					this.isWiki = parsedLink.isWiki;
					this.toggleComponent.setValue(parsedLink.isWiki);
				}
				
				// IMPORTANT: Never modify the embed state from clipboard
				// - For existing links: preserve the original embed state
				// - For new links: start with embed state as false (unembedded)
				// The embed toggle is already set correctly in the constructor
				
				this.updateUIState();
			}
		} catch (error) {
			// Silently fail if clipboard access is denied or unavailable
			console.debug("Could not access clipboard:", error);
		}
	}

	isUrl(str: string): boolean {
		if (!str) return false;
		const trimmed = str.trim();
		return /^https?:\/\/\S+$|^www\.\S+$/i.test(trimmed);
	}

	isAlmostUrl(str: string): boolean {
		if (!str) return false;
		const trimmed = str.trim();
		return /^htp:\/\/|^htps:\/\/|^http:\/[^\/]|^https\/\/|^www\.[a-zA-Z0-9-]+$/i.test(
			trimmed
		);
	}

	handleDestInput(): void {
		const val = this.destInput.getValue();
		const isNowUrl = this.isUrl(val);
		if (isNowUrl) {
			this.isWiki = false;
			this.toggleComponent.setValue(false);
		}
		this.wasUrl = isNowUrl;
		this.clearValidationErrors();
		this.updateUIState();
	}

	clearValidationErrors(): void {
		const existingValidation = this.warningsContainer.querySelectorAll(".link-validation-error");
		existingValidation.forEach((w) => w.remove());
		this.textInput.inputEl.classList.remove("link-warning-highlight");
		this.destInput.inputEl.classList.remove("link-warning-highlight");
	}

	updateConversionNotice(): void {
		if (!this.conversionNoticeEl) return;
		
		const currentText = this.textInput.getValue();
		const currentDest = this.destInput.getValue();
		
		// Check if the current values still match what was from clipboard
		const textStillFromClipboard = this.clipboardUsedText && currentText === this.link.text;
		const destStillFromClipboard = this.clipboardUsedDest && currentDest === this.link.destination;
		
		// If neither is from clipboard anymore, remove the notice
		if (!textStillFromClipboard && !destStillFromClipboard) {
			this.conversionNoticeEl.remove();
			this.conversionNoticeEl = null;
			return;
		}
		
		// Update the notice text based on what's still from clipboard
		let noticeText = "Used ";
		if (textStillFromClipboard && destStillFromClipboard) {
			noticeText += "text & destination from link in clipboard";
		} else if (textStillFromClipboard) {
			noticeText += "text from link in clipboard";
		} else if (destStillFromClipboard) {
			noticeText += "destination from link in clipboard";
		}
		
		this.conversionNoticeEl.textContent = noticeText;
	}

	/**
	 * Updates the UI state based on the current link destination and type
	 *
	 * Validation process:
	 * 1. Clear previous warnings and highlights
	 * 2. Check for URL/WikiLink format mismatches
	 * 3. Validate destination based on current link type:
	 *    - For WikiLinks: Uses isValidWikiLink() to check for forbidden characters
	 *    - For Markdown: Uses isValidMarkdownLink() to check for encoding issues
	 * 4. If invalid, tries to convert between formats and suggests toggling
	 * 5. Shows appropriate warnings and highlights the destination field
	 */
	updateUIState(): void {
		this.typeSetting.setDesc(this.isWiki ? "Wikilink" : "Markdown Link");

		const existingWarnings = this.warningsContainer.querySelectorAll(".link-warning");
		existingWarnings.forEach((w) => w.remove());
		this.destInput.inputEl.classList.remove("link-warning-highlight");
		this.textInput.inputEl.classList.remove("link-warning-highlight");

		const dest = this.destInput.getValue();
		const linkText = this.textInput.getValue();
		const destLength = dest ? dest.length : 0;
		const warnings: { text: string; cls: string }[] = [];

		// Note: We no longer warn about empty link text in markdown links
		// as they are now allowed (like in Obsidian)

		if (this.isWiki && this.isUrl(dest)) {
			warnings.push({
				text: "⚠️ Warning: Wikilinks cannot link to external URLs.",
				cls: "link-warning-error",
			});
		}

		// Check destination validity for current link type
		if (dest && !this.isUrl(dest)) {
			if (this.isWiki && !isValidWikiLink(dest)) {
				const converted = wikiToMarkdown(dest);
				if (converted !== dest) {
					warnings.push({
						text: "⚠️ Invalid WikiLink destination. Can toggle to Markdown below.",
						cls: "link-warning-caution",
					});
				} else {
					warnings.push({
						text: '⚠️ Wikilink destination contains forbidden characters (| ^ : %% [[ ]] * " ? \\\\ / in filename).',
						cls: "link-warning-error",
					});
				}
			} else if (!this.isWiki && !isValidMarkdownLink(dest)) {
				const converted = markdownToWiki(dest);
				if (converted !== null) {
					warnings.push({
						text: "⚠️ Invalid Markdown link destination. Can toggle to Wikilink below.",
						cls: "link-warning-caution",
					});
				} else {
					warnings.push({
						text: "⚠️ Invalid Markdown destination: Encode spaces and `^`; wrap them in `<...>`; or toggle to WikiLink",
						cls: "link-warning-error",
					});
				}
			}
		}

		if (!this.isUrl(dest) && this.isAlmostUrl(dest)) {
			warnings.push({
				text: "⚠️ Warning: Destination looks like a URL but may have typos (check protocol).",
				cls: "link-warning-caution",
			});
		}

		if (destLength > 500) {
			warnings.push({
				text: `⚠️ Warning: Destination is very long (${destLength} chars). Consider shortening for reliability.`,
				cls: "link-warning-caution",
			});
		}

		if (warnings.length > 0) {
			warnings.forEach((w) => {
				this.warningsContainer.createEl("div", {
					cls: `link-warning ${w.cls}`,
					text: w.text,
				});
			});
			this.destInput.inputEl.classList.add("link-warning-highlight");
		}
	}

	submit(): void {
		const linkText = this.textInput.getValue().trim();
		const linkDest = this.destInput.getValue().trim();

		// Clear previous validation errors
		this.clearValidationErrors();

		// Validation: destination is always required
		if (!linkDest) {
			const errorDiv = this.warningsContainer.createEl("div", {
				cls: "link-warning link-validation-error link-warning-error",
			});
			errorDiv.createEl("div", {
				text: "⚠️ Error: Destination is required.",
			});
			errorDiv.createEl("div", {
				text: "Press Escape to cancel and close without making changes.",
				cls: "link-validation-hint",
			});

			this.destInput.inputEl.focus();
			this.destInput.inputEl.classList.add("link-warning-highlight");
			return;
		}

		// For both markdown links and wikilinks with empty text, use destination as text
		// This allows markdown links with no text (like Obsidian does)
		const finalText = !linkText ? linkDest : linkText;

		this.onSubmit({
			text: finalText,
			destination: linkDest,
			isWiki: this.isWiki,
			isEmbed: this.embedToggle.getValue(),
		});
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
