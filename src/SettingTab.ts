import { App, PluginSettingTab, Setting } from "obsidian";
import type LinkEditorPlugin from "./main";

export class LinkEditorSettingTab extends PluginSettingTab {
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
			.setDesc("If enabled, the cursor will always move after the link after editing.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.alwaysMoveToEnd).onChange(async (value) => {
					this.plugin.settings.alwaysMoveToEnd = value;
					await this.plugin.saveSettings();
				})
			);
	}
}
