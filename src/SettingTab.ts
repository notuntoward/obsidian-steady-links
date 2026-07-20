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
		containerEl.createEl("h2", { text: "Steady Links Settings" });

		const steadyGroup = containerEl.createDiv("steady-links-steady-group");

		let subSettingsContainer: HTMLDivElement;
		let shortenHeadingSetting: Setting;
		let shortenFileSetting: Setting;
		let shortenHeadingToggle: any;
		let shortenFileToggle: any;

		new Setting(steadyGroup)
			.setName("Keep links steady")
			.setDesc(
				"Keeps a link's display text visible instead of expanding to raw " +
				"syntax when the cursor enters it. Use the Edit Link command to " +
				"edit the destination or other properties."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.keepLinksSteady)
					.onChange(async (value) => {
						this.plugin.settings.keepLinksSteady = value;
						await this.plugin.saveSettings();
						this.plugin.applySyntaxHiderSetting();
						
						// Dynamically update the sub-settings UI states without rebuilding the DOM
						if (subSettingsContainer) {
							subSettingsContainer.toggleClass("is-disabled", !value);
						}
						if (shortenHeadingSetting) {
							shortenHeadingSetting.settingEl.toggleClass("is-disabled", !value);
						}
						if (shortenFileSetting) {
							shortenFileSetting.settingEl.toggleClass("is-disabled", !value);
						}
						shortenHeadingToggle?.setDisabled(!value);
						shortenFileToggle?.setDisabled(!value);
					})
			);

		// Sub-settings that only take effect when "Keep links steady" is on.
		// They are grouped under the master toggle in a nested box, indented
		// and dimmed/disabled when the master toggle is off.
		const subSettingsDisabled = !this.plugin.settings.keepLinksSteady;
		subSettingsContainer = steadyGroup.createDiv("steady-links-subsettings");
		subSettingsContainer.toggleClass("is-disabled", subSettingsDisabled);

		shortenHeadingSetting = new Setting(subSettingsContainer)
			.setName("Shorten heading and block links")
			.setDesc(
				"Hide the note path in heading/block links without an alias " +
				"(e.g. [[Note#Heading]] → \"Heading\"), even with the cursor on " +
				"the link."
			)
			.addToggle((toggle) => {
				shortenHeadingToggle = toggle;
				toggle
					.setValue(this.plugin.settings.shortenHeadingLinks)
					.setDisabled(subSettingsDisabled)
					.onChange(async (value) => {
						this.plugin.settings.shortenHeadingLinks = value;
						await this.plugin.saveSettings();
						this.plugin.applySyntaxHiderSetting();
					});
			});
		shortenHeadingSetting.settingEl.addClass("steady-links-subsetting");
		shortenHeadingSetting.settingEl.toggleClass("is-disabled", subSettingsDisabled);

		shortenFileSetting = new Setting(subSettingsContainer)
			.setName("Shorten file links")
			.setDesc(
				"Hide the parent folder path in plain file links without an " +
				"alias (e.g. [[folder/Note]] → \"Note\"), even with the cursor " +
				"on the link. Independent of the heading/block setting above."
			)
			.addToggle((toggle) => {
				shortenFileToggle = toggle;
				toggle
					.setValue(this.plugin.settings.shortenFileLinks)
					.setDisabled(subSettingsDisabled)
					.onChange(async (value) => {
						this.plugin.settings.shortenFileLinks = value;
						await this.plugin.saveSettings();
						this.plugin.applySyntaxHiderSetting();
					});
			});
		shortenFileSetting.settingEl.addClass("steady-links-subsetting");
		shortenFileSetting.settingEl.toggleClass("is-disabled", subSettingsDisabled);

		new Setting(containerEl)
			.setName("Show Copy link to current note in tab menu")
			.setDesc("Adds a 'Copy link to current note' item to the tab right-click menu.")
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
