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
		new Setting(containerEl)
			.setName("Shorten heading and block links")
			.setDesc(
				"Requires 'Keep links steady' to be enabled. When enabled, links " +
				"to headings or blocks without an alias (e.g. [[Note#Heading]], " +
				"[[Note#^block-id]]) hide the note path and \"#\"/\"#^\" marker, " +
				"showing only the heading text or block ID — and keep showing " +
				"only that even with the cursor on the link. Off by default, " +
				"since stock Obsidian does not shorten these links itself. Turn " +
				"this on for compatibility with plugins (such as Short Links) " +
				"that shorten link text only while the cursor is off the link, " +
				"which otherwise makes the link visually change when the cursor " +
				"enters it."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.shortenHeadingLinks)
					.onChange(async (value) => {
						this.plugin.settings.shortenHeadingLinks = value;
						await this.plugin.saveSettings();
						this.plugin.applySyntaxHiderSetting();
					})
			);
		new Setting(containerEl)
			.setName("Show Copy link to current note in tab menu")
			.setDesc(
				"When enabled, right-clicking a tab shows a 'Copy link to current note' " +
				"item that copies a wikilink to that note."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.copyLinkToCurrentNoteInTabMenu)
					.onChange(async (value) => {
						this.plugin.settings.copyLinkToCurrentNoteInTabMenu = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
