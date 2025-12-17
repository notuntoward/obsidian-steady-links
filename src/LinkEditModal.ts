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
	originalDestination: string; // Store original destination to track URL fixes

	textInput!: TextComponent;
	destInput!: TextComponent;
	fileSuggest!: FileSuggest;
	typeSetting!: Setting;
	toggleComponent!: ToggleComponent;
	applyBtn!: ButtonComponent;
	warningsContainer!: HTMLElement;

	constructor(
		app: App,
		link: LinkInfo,
		onSubmit: (result: LinkInfo) => void,
		shouldSelectText?: boolean,
		conversionNotice?: string | null
	) {
		super(app);
		this.link = link;
		this.onSubmit = onSubmit;
		this.shouldSelectText = shouldSelectText || false;
		this.conversionNotice = conversionNotice || null;
		this.isWiki = false;
		this.wasUrl = false;
		
		// If there's a conversion notice about URL conversion, try to extract the original URL
		// This helps us avoid showing the "format changed to Markdown" warning
		if (conversionNotice && conversionNotice.includes("URL converted:")) {
			const match = conversionNotice.match(/URL converted: (.+?) →/);
			if (match && match[1]) {
				this.originalDestination = match[1].trim();
			} else {
				this.originalDestination = link.destination;
			}
		} else {
			this.originalDestination = link.destination;
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
		});

		// Destination
		const destSetting = new Setting(contentEl).setName("Destination");
		destSetting.addText((text) => {
			this.destInput = text;
			// Check if the initial destination needs URL fixing
			let initialDest = this.link.destination;
			if (initialDest && this.isAlmostUrl(initialDest)) {
				const { fixed } = this.fixUrl(initialDest);
				if (fixed !== initialDest) {
					initialDest = fixed;
					this.link.destination = fixed;
				}
			}
			text.setValue(initialDest);
			text.inputEl.style.width = "100%";
			this.fileSuggest = new FileSuggest(this.app, text.inputEl, this);
			text.inputEl.addEventListener("input", () => {
				this.handleDestInput();
			});
		});

		// Warnings container
		this.warningsContainer = contentEl.createDiv({ cls: "link-warnings-container" });

		// Conversion notice
		if (this.conversionNotice) {
			this.warningsContainer.createEl("div", {
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

		// Apply button
		new Setting(contentEl).addButton((btn) => {
			this.applyBtn = btn;
			btn.setButtonText("Apply")
				.setCta()
				.onClick(() => this.submit());
		});

		// Key handling
		this.modalEl.addEventListener("keydown", (e) => {
			// TAB: manual cycle + optional suggester accept
			if (e.key === "Tab") {
				e.preventDefault();
				const focusable = this.getFocusableElements();
				const active = document.activeElement as HTMLElement;
				let index = focusable.indexOf(active);
				if (index === -1) index = 0;
				const forward = !e.shiftKey;

				// If on dest and suggester open, first Tab = accept suggestion
				if (active === this.destInput.inputEl) {
					const isOpen = this.fileSuggest.isSuggestOpen;
					if (isOpen && this.destInput.getValue().trim().length > 0) {
						this.fileSuggest.selectCurrentSuggestion();
					}
				}

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

		this.populateFromClipboard();
		this.updateUIState();
		this.setInitialFocus();
	}

	getFocusableElements(): HTMLElement[] {
		return [
			this.textInput.inputEl,
			this.destInput.inputEl,
			this.toggleComponent.toggleEl,
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
					
					// Update UI state after setting destination to handle URL fixing
					this.updateUIState();
				}
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

	/**
	 * Attempts to fix common URL issues
	 * Returns the fixed URL and whether a fix was applied
	 */
	fixUrl(url: string): { fixed: string; wasFixed: boolean } {
		if (!url) return { fixed: url, wasFixed: false };
		
		const trimmed = url.trim();
		let fixed = trimmed;
		let wasFixed = false;

		// Fix common protocol issues
		if (/^htp:\/\//i.test(fixed)) {
			fixed = fixed.replace(/^htp:\/\//i, "http://");
			wasFixed = true;
		} else if (/^htps:\/\//i.test(fixed)) {
			fixed = fixed.replace(/^htps:\/\//i, "https://");
			wasFixed = true;
		} else if (/^http:\/[^\/]/i.test(fixed)) {
			fixed = fixed.replace(/^http:\/([^\/])/i, "http:///$1");
			wasFixed = true;
		} else if (/^https\/\/\S/i.test(fixed)) {
			fixed = fixed.replace(/^https\/\//i, "https://");
			wasFixed = true;
		}

		// Fix www. URLs that are missing protocol
		if (/^www\.[a-zA-Z0-9-]+$/i.test(fixed)) {
			fixed = "https://" + fixed;
			wasFixed = true;
		}

		return { fixed, wasFixed };
	}

	handleDestInput(): void {
		const val = this.destInput.getValue();
		const isNowUrl = this.isUrl(val);
		if (isNowUrl) {
			this.isWiki = false;
			this.toggleComponent.setValue(false);
		}
		this.wasUrl = isNowUrl;
		this.updateUIState();
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

		let dest = this.destInput.getValue();
		const warnings: {
			text: string;
			cls: string;
			severity: "fix" | "caution" | "error";
		}[] = [];
		let urlWasFixed = false;
		const enteredDest = dest;

		// Check if URL needs fixing and fix it if possible
		if (dest && this.isAlmostUrl(dest)) {
			const { fixed, wasFixed } = this.fixUrl(dest);
			if (wasFixed) {
				dest = fixed;
				this.destInput.setValue(dest);
				urlWasFixed = true;
				if ((enteredDest || "").trim() !== dest.trim()) {
					warnings.push({
						text: `🛠️ Auto-corrected URL: ${(enteredDest || "").trim()} → ${dest.trim()}`,
						cls: "link-warning-fixnotice",
						severity: "fix",
					});
				}
			}
		}

		// Detect URLs that were auto-corrected before the modal opened
		if (!urlWasFixed && dest) {
			const original = (this.originalDestination || "").trim();
			if (original && original !== dest && this.isAlmostUrl(original)) {
				const { fixed, wasFixed } = this.fixUrl(original);
				if (wasFixed && fixed === dest) {
					warnings.push({
						text: `🛠️ Auto-corrected URL: ${original} → ${dest}`,
						cls: "link-warning-fixnotice",
						severity: "fix",
					});
				}
			}
		}

		const destLength = dest ? dest.length : 0;

		// Check if we have a URL destination and the format was just changed to WikiLink
		if (this.isWiki && this.isUrl(dest)) {
			warnings.push({
				text: "⚠️ Warning: Valid URL detected but Wikilink format selected. Wikilinks cannot link to external URLs.",
				cls: "link-warning-error",
				severity: "error",
			});
		}
		
		// Check if we have a URL destination and the format was just changed to Markdown
		// Only show this warning if the URL wasn't just fixed (to avoid duplicate messages)
		// Also don't show if the original destination was a bare URL that was fixed
		if (!this.isWiki && this.isUrl(dest) && this.wasUrl && !urlWasFixed &&
			!(this.originalDestination && this.isAlmostUrl(this.originalDestination))) {
			warnings.push({
				text: "ℹ️ Note: Link format changed to Markdown to support URL destination",
				cls: "link-warning-caution",
				severity: "caution",
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
						severity: "caution",
					});
				} else {
					warnings.push({
						text: '⚠️ Invalid Wikilink destination. Contains forbidden characters (| ^ : %% [[ ]] * " ? \\\\ / in filename).',
						cls: "link-warning-error",
						severity: "error",
					});
				}
			} else if (!this.isWiki && !isValidMarkdownLink(dest)) {
				const converted = markdownToWiki(dest);
				if (converted !== null) {
					warnings.push({
						text: "⚠️ Invalid Markdown link destination. Can toggle to Wikilink below.",
						cls: "link-warning-caution",
						severity: "caution",
					});
				} else {
					warnings.push({
						text: "⚠️ Invalid Markdown destination: Encode spaces and `^`; wrap them in `<...>`; or toggle to WikiLink",
						cls: "link-warning-error",
						severity: "error",
					});
				}
			}
		}

		// Check for unfixable URL issues
		if (dest && this.isAlmostUrl(dest) && !this.isUrl(dest) && !urlWasFixed) {
			warnings.push({
				text: "⛔ Error: This URL still looks malformed and couldn't be auto-corrected. Please adjust the protocol or domain manually.",
				cls: "link-warning-error",
				severity: "error",
			});
		}

		if (destLength > 500) {
			warnings.push({
				text: `⚠️ Warning: Destination is very long (${destLength} chars). Consider shortening for reliability.`,
				cls: "link-warning-caution",
				severity: "caution",
			});
		}

		if (warnings.length > 0) {
			warnings.forEach((w) => {
				const warningEl = this.warningsContainer.createEl("div", {
					cls: `link-warning ${w.cls}`,
					text: w.text,
				});
				warningEl.setAttr("role", w.severity === "error" ? "alert" : "status");
			});
			const requiresHighlight = warnings.some((w) => w.severity !== "fix");
			if (requiresHighlight) {
				this.destInput.inputEl.classList.add("link-warning-highlight");
			}
		}
	}

	submit(): void {
		const linkText = this.textInput.getValue().trim();
		const linkDest = this.destInput.getValue().trim();

		if (!linkText || !linkDest) {
			const existingValidation =
				this.warningsContainer.querySelectorAll(".link-validation-error");
			existingValidation.forEach((w) => w.remove());

			const errorDiv = this.warningsContainer.createEl("div", {
				cls: "link-warning link-validation-error link-warning-error",
			});
			errorDiv.createEl("div", {
				text: "⚠️ Error: Both Link Text and Destination are required.",
			});
			errorDiv.createEl("div", {
				text: "Press Escape to cancel and close without making changes.",
				cls: "link-validation-hint",
			});

			if (!linkText) {
				this.textInput.inputEl.focus();
				this.textInput.inputEl.classList.add("link-warning-highlight");
			} else if (!linkDest) {
				this.destInput.inputEl.focus();
				this.destInput.inputEl.classList.add("link-warning-highlight");
			}

			return;
		}

		this.onSubmit({
			text: linkText,
			destination: linkDest,
			isWiki: this.isWiki,
		});
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
