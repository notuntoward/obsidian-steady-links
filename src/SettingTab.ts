import { App, PluginSettingTab, Setting } from "obsidian";
import type SteadyLinksPlugin from "./main";

export class SteadyLinksSettingTab extends PluginSettingTab {
	plugin: SteadyLinksPlugin;

	constructor(app: App, plugin: SteadyLinksPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "Link Editor Settings" });

		new Setting(containerEl)
			.setName("Keep links steady")
			.setDesc(
				"When enabled, moving the cursor into a link will not expand it, " +
				"and show its raw syntax. The link text stays editable as normal " +
				"text; use the Edit Link command to change the destination and " +
				"other properties."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.keepLinksSteady)
					.onChange(async (value) => {
						this.plugin.settings.keepLinksSteady = value;
						await this.plugin.saveSettings();
						this.plugin.applySyntaxHiderSetting();
					})
			);
	}
}
