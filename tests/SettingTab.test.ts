// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { App } from "./__mocks__/obsidian";
import { SteadyLinksSettingTab } from "../src/SettingTab";
import { createSettings } from "./factories";

// Patch JSDOM with Obsidian element creators
function patchObsidianDom() {
	const proto = HTMLElement.prototype as any;
	if (!proto.empty) {
		proto.empty = function () {
			while (this.firstChild) this.removeChild(this.firstChild);
		};
	}
	if (!proto.addClass) {
		proto.addClass = function (cls: string) {
			this.classList.add(cls);
		};
	}
	if (!proto.removeClass) {
		proto.removeClass = function (cls: string) {
			this.classList.remove(cls);
		};
	}
	if (!proto.hasClass) {
		proto.hasClass = function (cls: string) {
			return this.classList.contains(cls);
		};
	}
	if (!proto.toggleClass) {
		proto.toggleClass = function (cls: string, force?: boolean) {
			this.classList.toggle(cls, force);
		};
	}
	if (!proto.createEl) {
		proto.createEl = function (
			tag: string,
			opts?: string | { text?: string; cls?: string }
		): HTMLElement {
			const el = document.createElement(tag);
			if (typeof opts === "string") {
				el.className = opts;
			} else if (opts) {
				if (opts.cls) el.className = opts.cls;
				if (opts.text != null) el.textContent = opts.text;
			}
			this.appendChild(el);
			return el;
		};
	}
	if (!proto.createDiv) {
		proto.createDiv = function (opts?: string | { cls?: string }): HTMLElement {
			return this.createEl("div", opts);
		};
	}
}
patchObsidianDom();

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
	});

	it("renders setting tab elements correctly", () => {
		tab.display();
		expect(tab.containerEl.querySelector("h2")?.textContent).toBe("Steady Links Settings");
		expect(tab.containerEl.querySelector(".steady-links-steady-group")).toBeTruthy();
		expect(tab.containerEl.querySelector(".steady-links-subsettings")).toBeTruthy();
	});

	it("toggles keepLinksSteady setting and updates UI classes dynamically", async () => {
		tab.display();
		
		const subSettingsContainer = tab.containerEl.querySelector(".steady-links-subsettings") as HTMLElement;
		// Initially keepLinksSteady is false, so container should have 'is-disabled' class
		expect(subSettingsContainer.classList.contains("is-disabled")).toBe(true);

		// Find the master toggle component element
		const checkboxes = tab.containerEl.querySelectorAll(".checkbox-container");
		const masterToggleEl = checkboxes[0] as HTMLElement;
		expect(masterToggleEl).toBeTruthy();

		// Click the master toggle to enable it
		masterToggleEl.click();

		// Flush microtasks to allow async saveSettings and follow-up code to run
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(pluginMock.settings.keepLinksSteady).toBe(true);
		expect(pluginMock.saveSettings).toHaveBeenCalled();
		expect(pluginMock.applySyntaxHiderSetting).toHaveBeenCalled();

		// Should dynamically remove 'is-disabled' class
		expect(subSettingsContainer.classList.contains("is-disabled")).toBe(false);
	});

	it("toggles sub-settings without re-rendering the whole display", async () => {
		// Spy on the display method to verify it is NOT called during onChange toggle
		const displaySpy = vi.spyOn(tab, "display");
		
		tab.display();
		displaySpy.mockClear();

		const checkboxes = tab.containerEl.querySelectorAll(".checkbox-container");
		const masterToggleEl = checkboxes[0] as HTMLElement;

		// Toggle the master switch
		masterToggleEl.click();
		
		// The display method should not be re-called when toggling (focus is preserved)
		expect(displaySpy).not.toHaveBeenCalled();
	});
});
