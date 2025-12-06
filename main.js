'use strict';

const obsidian = require('obsidian');

// --- File Suggester Class with Heading/Block Support ---

class FileSuggest extends obsidian.AbstractInputSuggest {
    constructor(app, textInputEl, modal) {
        super(app, textInputEl);
        this.modal = modal;
        this.app = app;
    }

    async getSuggestions(query) {
        if (this.modal.isUrl(query)) return [];

        const trimmedQuery = query.trim();

        // Non-wiki: just files.
        if (!this.modal.isWiki) {
            return this.getFiles(trimmedQuery);
        }

        // --- WIKILINK MODE PATTERNS ---

        // 1) "##heading" in all files
        if (trimmedQuery.startsWith('##')) {
            const headingQuery = trimmedQuery.slice(2).toLowerCase();
            const allHeadings = this.getAllHeadings();
            if (!headingQuery) return allHeadings;
            return allHeadings.filter(h => h.heading.toLowerCase().includes(headingQuery));
        }

        // 2) "#^block" in current file (must come BEFORE single # check)
        if (trimmedQuery.startsWith('#^')) {
            const blockQuery = trimmedQuery.slice(2).toLowerCase();
            const activeFile = this.app.workspace.getActiveFile();
            if (!activeFile) return [];
            return await this.getAllBlocksInFile(activeFile, blockQuery);
        }

        // 3) "#heading" in current file
        if (trimmedQuery.startsWith('#') && !trimmedQuery.startsWith('##')) {
            const headingQuery = trimmedQuery.slice(1).toLowerCase();
            const allHeadings = this.getHeadingsInCurrentFile();
            if (!headingQuery) return allHeadings;
            return allHeadings.filter(h => h.heading.toLowerCase().includes(headingQuery));
        }

        // 4) "^block" in current file
        if (trimmedQuery.startsWith('^')) {
            const blockQuery = trimmedQuery.slice(1).toLowerCase();
            const activeFile = this.app.workspace.getActiveFile();
            if (!activeFile) return [];
            return await this.getAllBlocksInFile(activeFile, blockQuery);
        }

        // 5) "file#^block" in specific file (must come BEFORE file#heading check)
        if (trimmedQuery.includes('#^')) {
            const [fileName, blockQuery = ''] = trimmedQuery.split('#^');
            const file = this.findFile(fileName);
            if (!file) return [];
            return await this.getAllBlocksInFile(file, blockQuery);
        }

        // 6) "file#heading" in specific file
        if (trimmedQuery.includes('#') && !trimmedQuery.startsWith('#')) {
            const [fileName, headingQuery = ''] = trimmedQuery.split('#');
            return this.getHeadingsInFile(fileName, headingQuery);
        }

        // 7) "file^block" in specific file (without #)
        if (trimmedQuery.includes('^') && !trimmedQuery.startsWith('^')) {
            const [fileName, blockQuery = ''] = trimmedQuery.split('^');
            const file = this.findFile(fileName);
            if (!file) return [];
            return await this.getAllBlocksInFile(file, blockQuery);
        }

        // 8) Default: [[file]]
        return this.getFiles(trimmedQuery);
    }

    getFiles(query) {
        const files = this.app.vault.getFiles();
        const lowerQuery = query.toLowerCase();
        const matches = files.filter(file =>
            file.path.toLowerCase().includes(lowerQuery) ||
            file.basename.toLowerCase().includes(lowerQuery)
        );
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
            file: activeFile,
        }));
    }

    getAllHeadings() {
        const files = this.app.vault.getMarkdownFiles();
        const all = [];
        for (const file of files) {
            const cache = this.app.metadataCache.getFileCache(file);
            if (cache && cache.headings) {
                cache.headings.forEach(h => {
                    all.push({
                        type: 'heading',
                        heading: h.heading,
                        level: h.level,
                        file,
                    });
                });
            }
        }
        return all.slice(0, 50);
    }

    getHeadingsInFile(fileName, headingQuery = '') {
        const files = this.app.vault.getFiles();
        const lowerFileName = fileName.toLowerCase();
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
                file,
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
        const content = await this.app.vault.cachedRead(file);
        const lines = content.split('\n');
        const results = [];

        if (cache.sections) {
            for (const section of cache.sections) {
                if (['paragraph', 'list', 'blockquote', 'code'].includes(section.type)) {
                    const startLine = section.position.start.line;
                    const endLine = section.position.end.line;
                    const blockText = lines.slice(startLine, endLine + 1).join('\n');
                    const blockIdMatch = blockText.match(/\^([a-zA-Z0-9-]+)\s*$/);
                    const blockId = blockIdMatch ? blockIdMatch[1] : null;
                    const displayText = blockId
                        ? blockText.replace(/\s*\^[a-zA-Z0-9-]+\s*$/, '')
                        : blockText;

                    if (blockQuery) {
                        const q = blockQuery.toLowerCase();
                        const matchesId = blockId && blockId.toLowerCase().includes(q);
                        const matchesText = displayText.toLowerCase().includes(q);
                        if (!matchesId && !matchesText) continue;
                    }

                    results.push({
                        type: 'block',
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

    generateBlockId() {
        return Math.random().toString(36).substr(2, 6);
    }

    async addBlockIdToFile(file, position, blockId) {
        const content = await this.app.vault.read(file);
        const lines = content.split('\n');
        const endLine = position.end.line;
        lines[endLine] = lines[endLine].trimEnd() + ` ^${blockId}`;
        await this.app.vault.modify(file, lines.join('\n'));
    }

    renderSuggestion(item, el) {
        el.addClass('mod-complex');
        const content = el.createDiv({ cls: 'suggestion-content' });

        if (item.type === 'heading') {
            content.createDiv({
                text: item.heading,
                cls: 'suggestion-title',
            });
            const aux = el.createDiv({ cls: 'suggestion-aux' });
            aux.createSpan({
                text: `H${item.level}`,
                cls: 'suggestion-flair',
            });

            if (item.file) {
                const currentQuery = this.textInputEl.value.trim();
                const currentFile = this.app.workspace.getActiveFile();
                const isFilenameHeadingPattern =
                    currentQuery.includes('#') &&
                    !currentQuery.startsWith('#') &&
                    !currentQuery.startsWith('##');
                const showPath =
                    !isFilenameHeadingPattern &&
                    (!currentFile || item.file.path !== currentFile.path);

                if (showPath) {
                    content.createDiv({
                        text: item.file.path,
                        cls: 'suggestion-note',
                    });
                }
            }
        } else if (item.type === 'block') {
            const blockText = item.blockText || '';
            const displayText =
                blockText.length > 100 ? blockText.substring(0, 100) + '...' : blockText;
            content.createDiv({
                text: displayText,
                cls: 'suggestion-title',
            });
            if (item.blockId) {
                content.createDiv({
                    text: `^${item.blockId}`,
                    cls: 'suggestion-note',
                });
            }
        } else {
            content.createDiv({ text: item.basename, cls: 'suggestion-title' });
            content.createDiv({ text: item.path, cls: 'suggestion-note' });
        }
    }

    async selectSuggestion(item) {
        let linkValue;

        if (item.type === 'heading') {
            const currentFile = this.app.workspace.getActiveFile();
            if (item.file && currentFile && item.file.path === currentFile.path) {
                linkValue = `#${item.heading}`;
            } else if (item.file) {
                const fileName = item.file.basename;
                linkValue = `${fileName}#${item.heading}`;
            }
        } else if (item.type === 'block') {
            if (!item.blockId) {
                const newBlockId = this.generateBlockId();
                await this.addBlockIdToFile(item.file, item.position, newBlockId);
                item.blockId = newBlockId;
            }
            const currentFile = this.app.workspace.getActiveFile();
            if (item.file && currentFile && item.file.path === currentFile.path) {
                linkValue = `#^${item.blockId}`;
            } else if (item.file) {
                const fileName = item.file.basename;
                linkValue = `${fileName}#^${item.blockId}`;
            }
        } else {
            if (item.extension === 'md') {
                linkValue = item.basename;
            } else {
                linkValue = item.name;
            }
        }

        this.textInputEl.value = linkValue;
        this.modal.handleDestInput();
        this.close();

        if (document.activeElement !== this.textInputEl) {
            this.textInputEl.focus();
        }
    }

    selectCurrentSuggestion() {
        if (this.suggest && this.suggest.useSelectedItem) {
            this.suggest.useSelectedItem(new KeyboardEvent('keydown', { key: 'Enter' }));
        }
    }
}

// --- Link Edit Modal ---

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

        contentEl.createEl('h4', { text: 'Edit Link' });

        if (this.isUrl(this.link.destination)) {
            this.isWiki = false;
        } else {
            this.isWiki = this.link.isWiki;
        }
        this.wasUrl = this.isUrl(this.link.destination);

        // Link Text
        new obsidian.Setting(contentEl)
            .setName('Link Text')
            .addText(text => {
                this.textInput = text;
                text.setValue(this.link.text);
                text.inputEl.style.width = '100%';
            });

        // Destination
        const destSetting = new obsidian.Setting(contentEl).setName('Destination');
        destSetting.addText(text => {
            this.destInput = text;
            text.setValue(this.link.destination);
            text.inputEl.style.width = '100%';

            this.fileSuggest = new FileSuggest(this.app, text.inputEl, this);

            text.inputEl.addEventListener('input', () => {
                this.handleDestInput();
            });
        });

        // Warnings container
        this.warningsContainer = contentEl.createDiv({ cls: 'link-warnings-container' });

        // Conversion notice
        if (this.conversionNotice) {
            this.warningsContainer.createEl('div', {
                cls: 'link-conversion-notice',
                text: this.conversionNotice,
            });
        }

        // Link Type toggle
        this.typeSetting = new obsidian.Setting(contentEl)
            .setName('Link Type')
            .setDesc(this.isWiki ? 'Wiki Link' : 'Markdown Link')
            .addToggle(toggle => {
                this.toggleComponent = toggle;
                toggle
                    .setValue(this.isWiki)
                    .onChange(value => {
                        this.isWiki = value;
                        this.updateUIState();
                    });
                toggle.toggleEl.setAttribute('tabindex', '0');
                toggle.toggleEl.addEventListener('keydown', e => {
                    if (e.key === ' ' || e.key === 'Spacebar') {
                        e.preventDefault();
                        const newValue = !toggle.getValue();
                        toggle.setValue(newValue);
                        this.isWiki = newValue;
                        this.updateUIState();
                    }
                });
            });

        // Apply button
        new obsidian.Setting(contentEl).addButton(btn => {
            this.applyBtn = btn;
            btn.setButtonText('Apply').setCta().onClick(() => this.submit());
        });

        // Key handling
        this.modalEl.addEventListener('keydown', e => {
            // TAB: manual cycle + optional suggester accept
            if (e.key === 'Tab') {
                e.preventDefault();

                const focusable = this.getFocusableElements();
                const active = document.activeElement;
                let index = focusable.indexOf(active);
                if (index === -1) index = 0;
                const forward = !e.shiftKey;

                // If on dest and suggester open, first Tab = accept suggestion
                if (active === this.destInput.inputEl) {
                    const suggest = this.fileSuggest.suggest;
                    const isOpen = suggest && suggest.isOpen;
                    if (isOpen && this.destInput.getValue().trim().length > 0) {
                        this.fileSuggest.selectCurrentSuggestion();
                    }
                }

                const step = forward ? 1 : -1;
                const nextIndex = (index + step + focusable.length) % focusable.length;
                focusable[nextIndex].focus();
                return;
            }

            // Ctrl+N / Ctrl+P to navigate suggestions
            if (e.ctrlKey && (e.key === 'n' || e.key === 'p') && document.activeElement === this.destInput.inputEl) {
                const suggest = this.fileSuggest.suggest;
                if (suggest && suggest.suggestions && suggest.suggestions.length > 0) {
                    e.preventDefault();
                    e.stopPropagation();
                    const arrowKey = e.key === 'n' ? 'ArrowDown' : 'ArrowUp';
                    suggest.suggestEl.dispatchEvent(
                        new KeyboardEvent('keydown', {
                            key: arrowKey,
                            bubbles: true,
                            cancelable: true,
                        }),
                    );
                    return;
                }
            }

            // Enter
            if (e.key === 'Enter') {
                if (e.target === this.toggleComponent.toggleEl) return;
                const suggest = this.fileSuggest.suggest;
                if (suggest && suggest.isOpen) return; // let suggester handle Enter
                e.preventDefault();
                this.submit();
                return;
            }

            // Escape
            if (e.key === 'Escape') {
                const suggest = this.fileSuggest.suggest;
                if (suggest && suggest.isOpen) {
                    this.fileSuggest.close();
                    return;
                }
                this.close();
            }
        });

        this.updateUIState();
        this.setInitialFocus();
    }

    getFocusableElements() {
        return [
            this.textInput.inputEl,
            this.destInput.inputEl,
            this.toggleComponent.toggleEl,
            this.applyBtn.buttonEl,
        ].filter(el => el && el.offsetParent !== null);
    }

    setInitialFocus() {
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
        this.typeSetting.setDesc(this.isWiki ? 'Wiki Link' : 'Markdown Link');

        const existingWarnings = this.warningsContainer.querySelectorAll('.link-warning');
        existingWarnings.forEach(w => w.remove());
        this.destInput.inputEl.classList.remove('link-warning-highlight');
        this.textInput.inputEl.classList.remove('link-warning-highlight');

        const dest = this.destInput.getValue();
        const destLength = dest ? dest.length : 0;
        const warnings = [];

        if (this.isWiki && this.isUrl(dest)) {
            warnings.push({
                text:
                    '⚠️ Warning: Valid URL detected but Wiki Link format selected. Wiki links cannot link to external URLs.',
                cls: 'link-warning-error',
            });
        }
        if (!this.isUrl(dest) && this.isAlmostUrl(dest)) {
            warnings.push({
                text: '⚠️ Warning: Destination looks like a URL but may have typos (check protocol).',
                cls: 'link-warning-caution',
            });
        }
        if (destLength > 500) {
            warnings.push({
                text: `⚠️ Warning: Destination is very long (${destLength} chars). Consider shortening for reliability.`,
                cls: 'link-warning-caution',
            });
        }

        if (warnings.length > 0) {
            warnings.forEach(w => {
                this.warningsContainer.createEl('div', {
                    cls: `link-warning ${w.cls}`,
                    text: w.text,
                });
            });
            this.destInput.inputEl.classList.add('link-warning-highlight');
        }
    }

    submit() {
        const linkText = this.textInput.getValue().trim();
        const linkDest = this.destInput.getValue().trim();

        if (!linkText || !linkDest) {
            const existingValidation = this.warningsContainer.querySelectorAll('.link-validation-error');
            existingValidation.forEach(w => w.remove());
            const errorDiv = this.warningsContainer.createEl('div', {
                cls: 'link-warning link-validation-error link-warning-error',
            });
            errorDiv.createEl('div', {
                text: '⚠️ Error: Both Link Text and Destination are required.',
            });
            errorDiv.createEl('div', {
                text: 'Press Escape to cancel and close without making changes.',
                cls: 'link-validation-hint',
            });

            if (!linkText) {
                this.textInput.inputEl.focus();
                this.textInput.inputEl.classList.add('link-warning-highlight');
            } else if (!linkDest) {
                this.destInput.inputEl.focus();
                this.destInput.inputEl.classList.add('link-warning-highlight');
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
            id: 'edit-link',
            name: 'Edit link',
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

                // Markdown
                while ((match = mdRegex.exec(line)) !== null) {
                    start = match.index;
                    end = match.index + match[0].length;
                    if (cursor.ch >= start && cursor.ch <= end) {
                        link = { text: match[1], destination: match[2], isWiki: false };
                        enteredFromLeft = cursor.ch <= start + 1;
                        break;
                    }
                }

                // Wiki
                if (!link) {
                    while ((match = wikiRegex.exec(line)) !== null) {
                        start = match.index;
                        end = match.index + match[0].length;
                        if (cursor.ch >= start && cursor.ch <= end) {
                            link = {
                                destination: match[1],
                                text: match[2] ?? match[1],
                                isWiki: true,
                            };
                            enteredFromLeft = cursor.ch <= start + 2;
                            break;
                        }
                    }
                }

                // New link
                let shouldSelectText = false;
                let conversionNotice = null;

                if (!link) {
                    const selection = editor.getSelection();
                    let clipboardText = '';
                    try {
                        clipboardText = await navigator.clipboard.readText();
                        clipboardText = clipboardText.trim();
                    } catch (e) {}

                    const isUrl = str => {
                        if (!str) return false;
                        const trimmed = str.trim();
                        return /^https?:\/\/\S+$|^www\.\S+$/i.test(trimmed);
                    };
                    const normalizeUrl = str => {
                        if (!str) return str;
                        const trimmed = str.trim();
                        if (/^https?:\/\//i.test(trimmed)) return trimmed;
                        if (/^www\./i.test(trimmed)) return 'https://' + trimmed;
                        return trimmed;
                    };

                    const isSelectionUrl = isUrl(selection);
                    const isClipboardUrl = isUrl(clipboardText);

                    let linkText = '';
                    let linkDest = '';
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
                        linkText = '';
                        linkDest = clipboardText;
                        shouldBeMarkdown = false;
                    }

                    link = {
                        text: linkText,
                        destination: linkDest,
                        isWiki: !shouldBeMarkdown,
                    };

                    if (editor.somethingSelected()) {
                        const selStart = editor.getCursor('from');
                        const selEnd = editor.getCursor('to');
                        start = selStart.ch;
                        end = selEnd.ch;
                    } else {
                        start = cursor.ch;
                        end = cursor.ch;
                    }
                }

                new LinkEditModal(
                    this.app,
                    link,
                    result => {
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

                        editor.replaceRange(
                            replacement,
                            { line: cursor.line, ch: start },
                            { line: cursor.line, ch: end },
                        );

                        let newCh;
                        if (this.settings.alwaysMoveToEnd) {
                            newCh = start + replacement.length;
                        } else {
                            newCh = enteredFromLeft ? start + replacement.length : start;
                        }
                        editor.setCursor({ line: cursor.line, ch: newCh });
                    },
                    shouldSelectText,
                    conversionNotice,
                ).open();
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
        containerEl.createEl('h2', { text: 'Link Editor Settings' });

        new obsidian.Setting(containerEl)
            .setName('Always move cursor to end of link')
            .setDesc('If enabled, the cursor will always move after the link after editing.')
            .addToggle(toggle =>
                toggle
                    .setValue(this.plugin.settings.alwaysMoveToEnd)
                    .onChange(async value => {
                        this.plugin.settings.alwaysMoveToEnd = value;
                        await this.plugin.saveSettings();
                    }),
            );
    }
}

module.exports = LinkEditorPlugin;
