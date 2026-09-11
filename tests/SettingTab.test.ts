// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { App } from "./__mocks__/obsidian";
import { SteadyLinksSettingTab } from "../src/SettingTab";
import { createSettings } from "./factories";

describe("SteadyLinksSettingTab", () => {
	let app: App;
	let pluginMock: any;
	let tab: SteadyLinksSettingTab;

	beforeEach(() => {
		app = new App();
		pluginMock = {
			settings: createSettings({
				keepLinksSteady: false,
				shortenHeadingLinks: false,
				shortenFileLinks: false,
				copyLinkToCurrentNoteInTabMenu: false,
			}),
			saveSettings: vi.fn().mockResolvedValue(undefined),
			applySyntaxHiderSetting: vi.fn(),
		};
		tab = new SteadyLinksSettingTab(app as any, pluginMock);
		(tab as any).update = vi.fn();
	});

	it("returns declarative setting definitions with expected groups and keys", () => {
		const defs = tab.getSettingDefinitions();
		expect(defs).toHaveLength(2);

		const group1 = defs[0] as any;
		expect(group1.heading).toBe("Keep links steady");
		expect(group1.items).toHaveLength(3);
		expect(group1.items[0].control.key).toBe("keepLinksSteady");
		expect(group1.items[1].control.key).toBe("shortenHeadingLinks");
		expect(group1.items[2].control.key).toBe("shortenFileLinks");

		const group2 = defs[1] as any;
		expect(group2.heading).toBe("Tab menu");
		expect(group2.items[0].control.key).toBe("copyLinkToCurrentNoteInTabMenu");
	});

	it("disables shorten toggles when keepLinksSteady is off and enables when on", () => {
		let defs = tab.getSettingDefinitions() as any[];
		expect(defs[0].items[1].control.disabled()).toBe(true);
		expect(defs[0].items[2].control.disabled()).toBe(true);

		pluginMock.settings.keepLinksSteady = true;
		defs = tab.getSettingDefinitions() as any[];
		expect(defs[0].items[1].control.disabled()).toBe(false);
		expect(defs[0].items[2].control.disabled()).toBe(false);
	});

	it("getControlValue reads from plugin settings and setControlValue persists and applies", async () => {
		expect(tab.getControlValue("keepLinksSteady")).toBe(false);

		await tab.setControlValue("keepLinksSteady", true);

		expect(pluginMock.settings.keepLinksSteady).toBe(true);
		expect(pluginMock.saveSettings).toHaveBeenCalled();
		expect(pluginMock.applySyntaxHiderSetting).toHaveBeenCalled();
		expect((tab as any).update).toHaveBeenCalled();
	});

	it("setControlValue for copyLink does not call applySyntaxHiderSetting", async () => {
		await tab.setControlValue("copyLinkToCurrentNoteInTabMenu", true);

		expect(pluginMock.settings.copyLinkToCurrentNoteInTabMenu).toBe(true);
		expect(pluginMock.saveSettings).toHaveBeenCalled();
		expect(pluginMock.applySyntaxHiderSetting).not.toHaveBeenCalled();
	});
});
