import {
  App,
  Editor,
  MarkdownView,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
} from "obsidian";
import { LinkEditModal, LinkData } from "./LinkEditModal";
import { DEFAULT_SETTINGS, LinkEditorSettings as LinkEditorSettings } from "./settings";

export default class LinkEditorPlugin extends Plugin {
  settings: LinkEditorSettings;

  async onload() {
    await this.loadSettings();

    this.addCommand({
      id: "edit-link",
      name: "Edit link",
      editorCallback: (editor: Editor, view: MarkdownView) => {
        const cursor = editor.getCursor();
        const line = editor.getLine(cursor.line);

        const mdRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
        const wikiRegex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

        let match: RegExpExecArray | null;
        let link: LinkData | null = null;
        let start = 0;
        let end = 0;
        let enteredFromLeft = true;

        while ((match = mdRegex.exec(line)) !== null) {
          start = match.index;
          end = match.index + match[0].length;
          if (cursor.ch >= start && cursor.ch <= end) {
            link = {
              text: match[1],
              destination: match[2],
              isWiki: false,
            };
            enteredFromLeft = cursor.ch <= start + 1;
            break;
          }
        }

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

        if (!link) {
          new Notice("No link at cursor");
          return;
        }

        new LinkEditModal(this.app, link, (result) => {
          let replacement: string;
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

          let newCh: number;
          if (this.settings.alwaysMoveToEnd) {
            newCh = start + replacement.length;
          } else {
            if (enteredFromLeft) {
              newCh = start + replacement.length;
            } else {
              newCh = start;
            }
          }
          editor.setCursor({ line: cursor.line, ch: newCh });
        }).open();
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

class LinkEditorSettingTab extends PluginSettingTab {
  plugin: LinkEditorPlugin;

  constructor(app: App, plugin: LinkEditorPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();
    containerEl.createEl("h2", { text: "Link Editor Settings" });

    new Setting(containerEl)
      .setName("Always move cursor to end of link")
      .setDesc(
        "If enabled, the cursor will always move after the link after editing, instead of respecting entry direction."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.alwaysMoveToEnd)
          .onChange(async (value) => {
            this.plugin.settings.alwaysMoveToEnd = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
