'use strict';

var obsidian = require('obsidian');

// --- File Suggester Class with Heading/Block Support ---
class FileSuggest extends obsidian.AbstractInputSuggest {
    constructor(app, textInputEl, modal) {
        super(app, textInputEl);
        this.modal = modal;
        this.app = app;
    }

    async getSuggestions(query) {
	// If it looks like a URL, don't show file suggestions
	if (this.modal.isUrl(query)) {
	    return [];
	}

	const trimmedQuery = query.trim();
	
	// If not in wikilink mode, always behave like plain [[filename]] search:
	// just suggest notes/files by name/path.
	if (!this.modal.isWiki) {
	    return this.getFiles(trimmedQuery);
	}

	// --- WIKILINK MODE BEHAVIOR (mirror Obsidian [[ ... ]] ) ---

	// Pattern 1: "#" at start → headings in current note
	if (trimmedQuery.startsWith('#') && !trimmedQuery.startsWith('##')) {
	    const headingQuery = trimmedQuery.slice(1).toLowerCase(); // Remove leading #
	    const allHeadings = this.getHeadingsInCurrentFile();
	    if (!headingQuery) {
		return allHeadings; // Show all if just "#"
	    }
	    // Filter headings by the query after #
	    return allHeadings.filter(h => 
		h.heading.toLowerCase().includes(headingQuery)
	    );
	}

	// Pattern 2: "##" at start → headings in entire vault
	if (trimmedQuery.startsWith('##')) {
	    const headingQuery = trimmedQuery.slice(2).toLowerCase(); // Remove leading ##
	    const allHeadings = this.getAllHeadings();
	    if (!headingQuery) {
		return allHeadings; // Show all if just "##"
	    }
	    // Filter headings by the query after ##
	    return allHeadings.filter(h => 
		h.heading.toLowerCase().includes(headingQuery)
	    );
	}

	// Pattern 3: "^" at start → blocks in current file
	if (trimmedQuery.startsWith('^')) {
	    const blockQuery = trimmedQuery.slice(1).toLowerCase(); // Remove leading ^
	    const activeFile = this.app.workspace.getActiveFile();
	    if (!activeFile) return [];
	    
	    return await this.getAllBlocksInFile(activeFile, blockQuery);
	}

	// Pattern 4: filename#^blockid → blocks in specific file
	if (trimmedQuery.includes('#^')) {
	    const parts = trimmedQuery.split('#^');
	    const fileName = parts[0];
	    const blockQuery = parts[1] || '';
	    const file = this.findFile(fileName);
	    if (!file) return [];
	    return await this.getAllBlocksInFile(file, blockQuery);
	}

	// Pattern 5: filename#heading → headings in specific file
	if (trimmedQuery.includes('#') && !trimmedQuery.startsWith('#')) {
	    const parts = trimmedQuery.split('#');
	    const fileName = parts[0];
	    const headingQuery = parts[1] || '';
	    return this.getHeadingsInFile(fileName, headingQuery);
	}

	// Pattern 6: filename^ → blocks in specific file (without #)
	if (trimmedQuery.includes('^') && !trimmedQuery.startsWith('^')) {
	    const parts = trimmedQuery.split('^');
	    const fileName = parts[0];
	    const blockQuery = parts[1] || '';
	    const file = this.findFile(fileName);
	    if (!file) return [];
	    return await this.getAllBlocksInFile(file, blockQuery);
	}



	// Pattern 7: default [[...]] file search
	return this.getFiles(trimmedQuery);
    }

    
    getFiles(query) {
        const files = this.app.vault.getFiles();
        const lowerQuery = query.toLowerCase();

        const matches = files.filter(file => 
            file.path.toLowerCase().contains(lowerQuery) || 
            file.basename.toLowerCase().contains(lowerQuery)
        );

        // Sort by recency
        matches.sort((a, b) => b.stat.mtime - a.stat.mtime);
        return matches.slice(0, 20);
    }

    getHeadingsInCurrentFile() {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) return [];

        const cache = this.app.metadataCache.getFileCache(activeFile);
        if (!cache || !cache.headings) return [];

        return cache.headings.map(h => ({
            type: 'heading',
            heading: h.heading,
            level: h.level,
            file: activeFile
        }));
    }

    getAllHeadings() {
        const files = this.app.vault.getMarkdownFiles();
        const allHeadings = [];

        for (const file of files) {
            const cache = this.app.metadataCache.getFileCache(file);
            if (cache && cache.headings) {
                cache.headings.forEach(h => {
                    allHeadings.push({
                        type: 'heading',
                        heading: h.heading,
                        level: h.level,
                        file: file
                    });
                });
            }
        }

        return allHeadings.slice(0, 50); // Limit to 50 results
    }

    getHeadingsInFile(fileName, headingQuery = '') {
        const files = this.app.vault.getFiles();
        const lowerFileName = fileName.toLowerCase();

        // Find matching file
        const file = files.find(f => 
            f.basename.toLowerCase() === lowerFileName ||
            f.path.toLowerCase().includes(lowerFileName)
        );

        if (!file) return [];

        const cache = this.app.metadataCache.getFileCache(file);
        if (!cache || !cache.headings) return [];

        const lowerHeadingQuery = headingQuery.toLowerCase();
        return cache.headings
            .filter(h => !headingQuery || h.heading.toLowerCase().includes(lowerHeadingQuery))
            .map(h => ({
                type: 'heading',
                heading: h.heading,
                level: h.level,
                file: file
            }));
    }

    findFile(fileName) {
	const files = this.app.vault.getFiles();
	const lowerFileName = fileName.toLowerCase();
	return files.find(f =>
	    f.basename.toLowerCase() === lowerFileName ||
	    f.path.toLowerCase().includes(lowerFileName)
	);
    }

    async getAllBlocksInFile(file, blockQuery = '') {
	const cache = this.app.metadataCache.getFileCache(file);
	if (!cache) return [];
	
	const fileContent = await this.app.vault.cachedRead(file);
	const lines = fileContent.split('\n');
	const results = [];
	
	if (cache.sections) {
	    for (const section of cache.sections) {
		if (section.type === 'paragraph' || section.type === 'list' || section.type === 'blockquote' || section.type === 'code') {
		    const startLine = section.position.start.line;
		    const endLine = section.position.end.line;
		    
		    const blockText = lines.slice(startLine, endLine + 1).join('\n');
		    const blockIdMatch = blockText.match(/\^([a-zA-Z0-9-]+)\s*$/);
		    const blockId = blockIdMatch ? blockIdMatch[1] : null;
		    const displayText = blockId ? blockText.replace(/\s*\^[a-zA-Z0-9-]+\s*$/, '') : blockText;
		    
		    if (blockQuery) {
			const lowerBlockQuery = blockQuery.toLowerCase();
			const matchesId = blockId && blockId.toLowerCase().includes(lowerBlockQuery);
			const matchesText = displayText.toLowerCase().includes(lowerBlockQuery);
			if (!matchesId && !matchesText) continue;
		    }
		    
		    results.push({
			type: 'block',
			blockId: blockId,
			blockText: displayText.trim(),
			file: file,
			position: section.position
		    });
		}
	    }
	}
	return results;
    }

    generateBlockId() {
	return Math.random().toString(36).substr(2, 6);
    }

    async addBlockIdToFile(file, position, blockId) {
	const content = await this.app.vault.read(file);
	const lines = content.split('\n');
	const endLine = position.end.line;
	// Fix: Use trimEnd() to prevent double spaces before ^blockid
	lines[endLine] = lines[endLine].trimEnd() + ` ^${blockId}`;
	await this.app.vault.modify(file, lines.join('\n'));
    }

    
    renderSuggestion(item, el) {
	// Use 'mod-complex' for the standard Title/Note stack layout
	// Fix: Ensure every suggestion item has this class for styling
	el.addClass("mod-complex");
	const content = el.createDiv({ cls: "suggestion-content" });


	if (item.type === 'heading') {
	    // Title
	    content.createDiv({
		text: item.heading,
		cls: "suggestion-title"
	    });

	    // Aux (H1, H2 on right side)
	    const aux = el.createDiv({ cls: "suggestion-aux" });
	    aux.createSpan({
		text: `H${item.level}`,
		cls: "suggestion-flair"
	    });

	    // Note (Path) - Conditional logic
	    if (item.file) {
		const currentQuery = this.textInputEl.value.trim();
		const currentFile = this.app.workspace.getActiveFile();
		
		const isFilenameHeadingPattern = currentQuery.includes('#') && 
		      !currentQuery.startsWith('#') && 
		    !currentQuery.startsWith('##');
		
		// Show path if NOT a filename#heading pattern AND (NOT current file OR not the current file)
		// This handles the global search (##) case, and hides path for current-file heading search (#) and explicit filename#heading.
		const showPath = !isFilenameHeadingPattern && 
		      (!currentFile || item.file.path !== currentFile.path);
		
		if (showPath) {
		    content.createDiv({
			text: item.file.path,
			cls: "suggestion-note"
		    });
		}
	    }
	} else if (item.type === 'block') {
	    // Title (Block Text)
	    const blockText = item.blockText || '';
	    const displayText = blockText.length > 100 ? blockText.substring(0, 100) + '...' : blockText;
	    
	    content.createDiv({
		text: displayText,
		cls: "suggestion-title"
	    });
	    
	    // Note (Block ID) - Display BELOW text, only if it already exists.
	    if (item.blockId) {
		content.createDiv({
		    text: `^${item.blockId}`,
		    cls: "suggestion-note"
		});
	    }
	    
	    // Note (Path) - Conditional logic
	    // FIX: Hide path for all block suggestions, as the file is either implied (^) or explicitly typed (filename#^).
	    // The following block is intentionally removed/skipped to hide the path for blocks.
	    
	    /*
	    if (item.file) {
		const currentFile = this.app.workspace.getActiveFile();
		const showPath = !currentFile || item.file.path !== currentFile.path;
		if (showPath) {
		     content.createDiv({
			text: item.file.path,
			cls: "suggestion-note"
		    });
		}
	    }
	    */
	} else {
	    // Regular File - Stacked basename (large) and path (small)
	    // Title: Basename (no extension - is handled by using item.basename)
	    content.createDiv({ text: item.basename, cls: "suggestion-title" });
	    
	    // Note: Path (smaller, underneath)
	    content.createDiv({ text: item.path, cls: "suggestion-note" });
	}
    }

    async selectSuggestion(item) {
        let linkValue;

        if (item.type === 'heading') {
            // Format: #heading or filename#heading (NO leading #)
            const currentFile = this.app.workspace.getActiveFile();
            if (item.file && currentFile && item.file.path === currentFile.path) {
                // Current file - just #heading
                linkValue = `#${item.heading}`;
            } else if (item.file) {
                // Other file - filename#heading
                const fileName = item.file.basename;
                linkValue = `${fileName}#${item.heading}`;
            }
        } else if (item.type === 'block') {
            // Check if block has ID, if not, generate one
            if (!item.blockId) {
                const newBlockId = this.generateBlockId();
                await this.addBlockIdToFile(item.file, item.position, newBlockId);
                item.blockId = newBlockId;
            }

            // Format: #^blockid or filename#^blockid
            const currentFile = this.app.workspace.getActiveFile();
            if (item.file && currentFile && item.file.path === currentFile.path) {
                // Current file - just #^blockid
                linkValue = `#^${item.blockId}`;
            } else if (item.file) {
                // Other file - filename#^blockid
                const fileName = item.file.basename;
                linkValue = `${fileName}#^${item.blockId}`;
            }
        } else {
            // Regular file
            if (item.extension === 'md') {
                linkValue = item.basename;
            } else {
                linkValue = item.name;
            }
        }

        // Fix 4: Update the input value and close the suggestion list, and return focus
        this.textInputEl.value = linkValue;
        
        // Notify the modal logic directly
        this.modal.handleDestInput();
        
        // Close the suggester popup
        this.close();

        // Restore focus to the input box
        if (document.activeElement !== this.textInputEl) {
            this.textInputEl.focus();
        }
    }

    selectCurrentSuggestion() {
        if (this.suggestions && this.suggestions.length > 0) {
            const selectedIndex = this.selectedItem || 0;
            const selectedItem = this.suggestions[selectedIndex];
            if (selectedItem) {
                this.selectSuggestion(selectedItem);
            }
        }
    }
}

class LinkEditModal extends obsidian.Modal {
    constructor(app, link, onSubmit, shouldSelectText, conversionNotice) {
        super(app);
        this.link = link;
        this.onSubmit = onSubmit;
        this.shouldSelectText = shouldSelectText || false;
        this.conversionNotice = conversionNotice || null;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h4", { text: "Edit Link" });

        // Determine initial link type FIRST before creating UI
        // If destination is a URL, force markdown
        if (this.isUrl(this.link.destination)) {
            this.isWiki = false;
        } else {
            // Otherwise use the provided value
            this.isWiki = this.link.isWiki;
        }

        this.wasUrl = this.isUrl(this.link.destination);

        // --- Link Text Input ---
        new obsidian.Setting(contentEl)
            .setName("Link Text")
            .addText((text) => {
                this.textInput = text;
                text.setValue(this.link.text);
                text.inputEl.style.width = "100%";
            });

        // --- Destination Input ---
        const destSetting = new obsidian.Setting(contentEl)
            .setName("Destination");

        destSetting.addText((text) => {
            this.destInput = text;
            text.setValue(this.link.destination);
            text.inputEl.style.width = "100%";

            // Attach File Suggester
            this.fileSuggest = new FileSuggest(this.app, text.inputEl, this);

            // Event Listener for "Input"
            text.inputEl.addEventListener("input", () => {
                this.handleDestInput();
            });
        });

        // --- Warnings Container ---
        this.warningsContainer = contentEl.createDiv({ cls: "link-warnings-container" });

        // --- Conversion Notice (if URL was converted) ---
        if (this.conversionNotice) {
            this.warningsContainer.createEl("div", { 
                cls: "link-conversion-notice",
                text: this.conversionNotice
            });
        }

        // --- Link Type Toggle (keyboard accessible) ---
        this.typeSetting = new obsidian.Setting(contentEl)
            .setName("Link Type")
            .setDesc(this.isWiki ? "Wiki Link" : "Markdown Link")
            .addToggle((toggle) => {
                this.toggleComponent = toggle;
                toggle
                    .setValue(this.isWiki)
                    .onChange((value) => {
                        this.isWiki = value;
                        this.updateUIState();
                    });

                // Make toggle keyboard accessible
                toggle.toggleEl.setAttribute('tabindex', '0');
                toggle.toggleEl.addEventListener('keydown', (e) => {
                    if (e.key === ' ' || e.key === 'Spacebar') {
                        e.preventDefault();
                        const newValue = !toggle.getValue();
                        toggle.setValue(newValue);
                        this.isWiki = newValue;
                        this.updateUIState();
                    }
                });
            });

        // --- Buttons ---
        new obsidian.Setting(contentEl)
            .addButton((btn) => btn
                .setButtonText("Apply")
                .setCta()
                .onClick(() => this.submit())
            );

        // --- Key Handling ---
        this.modalEl.addEventListener("keydown", (e) => {
            // Tab key: if suggester is open, select current suggestion
            if (e.key === "Tab") {
                if (document.activeElement === this.destInput.inputEl && this.fileSuggest.isOpen) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.fileSuggest.selectCurrentSuggestion();
                    return;
                }
            }

            // CRITICAL FIX: Ctrl+N (Down) and Ctrl+P (Up) navigation
            // This is the core logic that enables quickswitcher-style navigation.
            if (e.ctrlKey && (e.key === 'n' || e.key === 'p') && document.activeElement === this.destInput.inputEl) {

                // Ensure the suggester is *open* and has values before attempting to navigate.
                if (this.fileSuggest.suggestions && this.fileSuggest.suggestions.values.length > 0) {
                    e.preventDefault();
                    e.stopPropagation();
                    
                    const arrowKey = e.key === 'n' ? 'ArrowDown' : 'ArrowUp';
                    const arrowEvent = new KeyboardEvent('keydown', {
                        key: arrowKey,
                        bubbles: true,
                        cancelable: true
                    });
                    this.fileSuggest.suggestions.containerEl.dispatchEvent(arrowEvent);
                    return;
                }
            } 
            // End of Key Handling for Ctrl+N/P

            // Enter key submits (with validation)
            if (e.key === "Enter") {
                if (e.target === this.toggleComponent.toggleEl) {
                    return;
                }
                // Stop Enter from submitting if the suggestion list is open (it should select the suggestion)
                if (this.fileSuggest.suggestions && this.fileSuggest.suggestions.values.length > 0 && this.fileSuggest.isOpen) {
                    return;
                }
                e.preventDefault();
                this.submit();
            } 
            // Escape cancels and closes
            else if (e.key === "Escape") {
                if (this.fileSuggest.isOpen) {
                    this.fileSuggest.close();
                    return;
                }
                this.close();
            }
        });

        // Initial state update
        this.updateUIState();

        // --- Smart Focus Logic ---
        this.setInitialFocus();
    }

    setInitialFocus() {
        const linkText = this.link.text;
        const linkDest = this.link.destination;
        const destLength = linkDest ? linkDest.length : 0;

        if (!linkText || linkText.length === 0) {
            this.textInput.inputEl.focus();
        }
        else if (!linkDest || linkDest.length === 0) {
            this.destInput.inputEl.focus();
        }
        else if (destLength > 500 || this.isAlmostUrl(linkDest)) {
            this.destInput.inputEl.focus();
            this.destInput.inputEl.select();
        }
        else if (this.shouldSelectText) {
            this.textInput.inputEl.focus();
            this.textInput.inputEl.select();
        }
        else {
            this.textInput.inputEl.focus();
            if (linkText && linkText.length > 0) {
                this.textInput.inputEl.select();
            }
        }
    }

    isUrl(str) {
        if (!str) return false;
        const trimmed = str.trim();
        return /^https?:\/\/\S+$|^www\.\S+$/i.test(trimmed);
    }

    isAlmostUrl(str) {
        if (!str) return false;
        const trimmed = str.trim();
        return /^htp:\/\/|^htps:\/\/|^http:\/[^\/]|^https\/\/|^www\.[a-zA-Z0-9-]+$/i.test(trimmed);
    }

    handleDestInput() {
        const val = this.destInput.getValue();
        const isNowUrl = this.isUrl(val);

        if (isNowUrl) {
            this.isWiki = false;
            this.toggleComponent.setValue(false);
        }

        this.wasUrl = isNowUrl;
        this.updateUIState();
    }

    updateUIState() {
        this.typeSetting.setDesc(this.isWiki ? "Wiki Link" : "Markdown Link");

        const existingWarnings = this.warningsContainer.querySelectorAll('.link-warning');
        existingWarnings.forEach(w => w.remove());

        this.destInput.inputEl.classList.remove("link-warning-highlight");
        this.textInput.inputEl.classList.remove("link-warning-highlight");

        const dest = this.destInput.getValue();
        const destLength = dest ? dest.length : 0;

        const warnings = [];

        if (this.isWiki && this.isUrl(dest)) {
            warnings.push({
                text: "⚠️ Warning: Valid URL detected but Wiki Link format selected. Wiki links cannot link to external URLs.",
                cls: "link-warning-error"
            });
        }

        if (!this.isUrl(dest) && this.isAlmostUrl(dest)) {
            warnings.push({
                text: "⚠️ Warning: Destination looks like a URL but may have typos (check protocol).",
                cls: "link-warning-caution"
            });
        }

        if (destLength > 500) {
            warnings.push({
                text: `⚠️ Warning: Destination is very long (${destLength} chars). Consider shortening for reliability.`,
                cls: "link-warning-caution"
            });
        }

        if (warnings.length > 0) {
            warnings.forEach(warning => {
                this.warningsContainer.createEl("div", {
                    cls: `link-warning ${warning.cls}`,
                    text: warning.text
                });
            });

            this.destInput.inputEl.classList.add("link-warning-highlight");
        }
    }

    submit() {
        const linkText = this.textInput.getValue().trim();
        const linkDest = this.destInput.getValue().trim();

        if (!linkText || !linkDest) {
            const existingValidation = this.warningsContainer.querySelectorAll('.link-validation-error');
            existingValidation.forEach(w => w.remove());

            const errorDiv = this.warningsContainer.createEl("div", {
                cls: "link-warning link-validation-error link-warning-error"
            });
            errorDiv.createEl("div", {
                text: "⚠️ Error: Both Link Text and Destination are required."
            });
            errorDiv.createEl("div", {
                text: "Press Escape to cancel and close without making changes.",
                cls: "link-validation-hint"
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

    onClose() {
        this.contentEl.empty();
    }
}

const DEFAULT_SETTINGS = {
    alwaysMoveToEnd: false,
};

class LinkEditorPlugin extends obsidian.Plugin {
    async onload() {
        await this.loadSettings();

        this.addCommand({
            id: "edit-link",
            name: "Edit link",
            editorCallback: async (editor, view) => {
                const cursor = editor.getCursor();
                const line = editor.getLine(cursor.line);

                const mdRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
                const wikiRegex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

                let match;
                let link = null;
                let start = 0;
                let end = 0;
                let enteredFromLeft = true;

                // 1. Check Markdown
                while ((match = mdRegex.exec(line)) !== null) {
                    start = match.index;
                    end = match.index + match[0].length;
                    if (cursor.ch >= start && cursor.ch <= end) {
                        link = { text: match[1], destination: match[2], isWiki: false };
                        enteredFromLeft = cursor.ch <= start + 1;
                        break;
                    }
                }

                // 2. Check Wiki
                if (!link) {
                    while ((match = wikiRegex.exec(line)) !== null) {
                        start = match.index;
                        end = match.index + match[0].length;
                        if (cursor.ch >= start && cursor.ch <= end) {
                            link = { destination: match[1], text: match[2] ?? match[1], isWiki: true };
                            enteredFromLeft = cursor.ch <= start + 2;
                            break;
                        }
                    }
                }

                // 3. New Link
                let shouldSelectText = false;
                let conversionNotice = null;

                if (!link) {
                    const selection = editor.getSelection();
                    let clipboardText = "";
                    try { 
                        clipboardText = await navigator.clipboard.readText();
                        clipboardText = clipboardText.trim();
                    } catch (e) {}

                    const isUrl = (str) => {
                        if (!str) return false;
                        const trimmed = str.trim();
                        return /^https?:\/\/\S+$|^www\.\S+$/i.test(trimmed);
                    };

                    const normalizeUrl = (str) => {
                        if (!str) return str;
                        const trimmed = str.trim();

                        if (/^https?:\/\//i.test(trimmed)) {
                            return trimmed;
                        }

                        if (/^www\./i.test(trimmed)) {
                            return 'https://' + trimmed;
                        }

                        return trimmed;
                    };

                    const isSelectionUrl = isUrl(selection);
                    const isClipboardUrl = isUrl(clipboardText);

                    let linkText = "";
                    let linkDest = "";
                    let shouldBeMarkdown = false;

                    if (isSelectionUrl) {
                        const original = selection.trim();
                        const normalized = normalizeUrl(original);

                        linkText = original;
                        linkDest = normalized;
                        shouldBeMarkdown = true;
                        shouldSelectText = true;

                        if (original !== normalized) {
                            conversionNotice = `✓ URL converted: ${original} → ${normalized}`;
                        }
                    } else if (selection) {
                        linkText = selection;

                        if (isClipboardUrl) {
                            const original = clipboardText;
                            const normalized = normalizeUrl(original);
                            linkDest = normalized;
                            shouldBeMarkdown = true;

                            if (original !== normalized) {
                                conversionNotice = `✓ URL converted: ${original} → ${normalized}`;
                            }
                        } else {
                            linkDest = clipboardText;
                            shouldBeMarkdown = false;
                        }
                    } else if (isClipboardUrl) {
                        const original = clipboardText;
                        const normalized = normalizeUrl(original);

                        linkText = normalized;
                        linkDest = normalized;
                        shouldSelectText = true;
                        shouldBeMarkdown = true;

                        if (original !== normalized) {
                            conversionNotice = `✓ URL converted: ${original} → ${normalized}`;
                        }
                    } else {
                        linkText = "";
                        linkDest = clipboardText;
                        shouldBeMarkdown = false;
                    }

                    link = {
                        text: linkText,
                        destination: linkDest,
                        isWiki: !shouldBeMarkdown
                    };

                    if (editor.somethingSelected()) {
                        const selStart = editor.getCursor("from");
                        const selEnd = editor.getCursor("to");
                        start = selStart.ch;
                        end = selEnd.ch;
                    } else {
                        start = cursor.ch;
                        end = cursor.ch;
                    }
                }

                new LinkEditModal(this.app, link, (result) => {
                    let replacement;
                    if (result.isWiki) {
                        if (result.text === result.destination) {
                            replacement = `[[${result.destination}]]`;
                        } else {
                            replacement = `[[${result.destination}|${result.text}]]`;
                        }
                    } else {
                        replacement = `[${result.text}](${result.destination})`;
                    }

                    editor.replaceRange(replacement, { line: cursor.line, ch: start }, { line: cursor.line, ch: end });

                    let newCh;
                    if (this.settings.alwaysMoveToEnd) {
                        newCh = start + replacement.length;
                    }
                    // Fix cursor move logic slightly to ensure we only jump to the right side if coming from the left
                    else {
                        newCh = enteredFromLeft ? start + replacement.length : start;
                    }
                    editor.setCursor({ line: cursor.line, ch: newCh });
                }, shouldSelectText, conversionNotice).open();
            },
        });

        this.addSettingTab(new LinkEditorSettingTab(this.app, this));
    }

    onunload() {}

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}

class LinkEditorSettingTab extends obsidian.PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl("h2", { text: "Link Editor Settings" });

        new obsidian.Setting(containerEl)
            .setName("Always move cursor to end of link")
            .setDesc("If enabled, the cursor will always move after the link after editing.")
            .addToggle((toggle) => toggle
                .setValue(this.plugin.settings.alwaysMoveToEnd)
                .onChange(async (value) => {
                    this.plugin.settings.alwaysMoveToEnd = value;
                    await this.plugin.saveSettings();
                }));
    }
}

module.exports = LinkEditorPlugin;
