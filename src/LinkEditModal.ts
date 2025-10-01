import { App, Modal, Setting, TextComponent, ButtonComponent } from "obsidian";

export interface LinkData {
  text: string;
  destination: string;
  isWiki: boolean;
}

export class LinkEditModal extends Modal {
  link: LinkData;
  onSubmit: (result: LinkData) => void;

  private textInput!: TextComponent;
  private destInput!: TextComponent;

  constructor(app: App, link: LinkData, onSubmit: (result: LinkData) => void) {
    super(app);
    this.link = link;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h4", { text: "Edit Link" });

    new Setting(contentEl).setName("Link Text").addText((text) => {
      this.textInput = text;
      text.setValue(this.link.text);
      text.inputEl.select();
    });

    new Setting(contentEl).setName("Destination").addText((text) => {
      this.destInput = text;
      text.setValue(this.link.destination);
    });

    new Setting(contentEl).addButton((btn: ButtonComponent) =>
      btn
        .setButtonText("Apply")
        .setCta()
        .onClick(() => this.submit())
    );

    contentEl.createEl("small", {
      text: this.link.isWiki ? "Wikilink" : "Markdown link",
    });

    this.modalEl.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.submit();
      } else if (e.key === "Escape") {
        this.close();
      }
    });
  }

  private submit() {
    this.onSubmit({
      text: this.textInput.getValue(),
      destination: this.destInput.getValue(),
      isWiki: this.link.isWiki,
    });
    this.close();
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
