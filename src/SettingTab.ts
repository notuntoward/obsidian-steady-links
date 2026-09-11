import { App, PluginSettingTab, SettingDefinitionItem } from "obsidian";
import type SteadyLinksPlugin from "./main";

export class SteadyLinksSettingTab extends PluginSettingTab {
	plugin: SteadyLinksPlugin;

	constructor(app: App, plugin: SteadyLinksPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const s = this.plugin.settings;
		return [
			{
				type: "group",
				heading: "Keep links steady",
				items: [
					{
						name: "Keep links steady",
						desc: "Keeps a link's display text visible instead of expanding to raw syntax when the cursor enters it. Use the Edit Link command to edit the destination or other properties.",
						control: { type: "toggle", key: "keepLinksSteady" },
					},
					{
						name: "Shorten heading and block links",
						desc: "Hide the note path in heading/block links without an alias (e.g. [[Note#Heading]] \u2192 \"Heading\"), even with the cursor on the link.",
						control: {
							type: "toggle",
							key: "shortenHeadingLinks",
							disabled: () => !s.keepLinksSteady,
						},
					},
					{
						name: "Shorten file links",
						desc: "Hide the parent folder path in plain file links without an alias (e.g. [[folder/Note]] \u2192 \"Note\"), even with the cursor on the link. Independent of the heading/block setting above.",
						control: {
							type: "toggle",
							key: "shortenFileLinks",
							disabled: () => !s.keepLinksSteady,
						},
					},
				],
			},
			{
				type: "group",
				heading: "Tab menu",
				items: [
					{
						name: "Show Copy link to current note in tab menu",
						desc: "Adds a 'Copy link to current note' item to the tab right-click menu.",
						control: { type: "toggle", key: "copyLinkToCurrentNoteInTabMenu" },
					},
				],
			},
		];
	}

	override getControlValue(key: string): unknown {
		return (this.plugin.settings as unknown as Record<string, unknown>)[key];
	}

	override async setControlValue(key: string, value: unknown): Promise<void> {
		(this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
		await this.plugin.saveSettings();
		if (key === "keepLinksSteady" || key === "shortenHeadingLinks" || key === "shortenFileLinks") {
			this.plugin.applySyntaxHiderSetting();
		}
		this.update();
	}
}
