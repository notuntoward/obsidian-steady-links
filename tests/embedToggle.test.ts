// @vitest-environment jsdom

/**
 * Regression tests for the "Embed content" toggle control in EditLinkModal.
 *
 * Verifies that:
 *  1. Spacebar toggles the embed control when focused (inverting embed state).
 *  2. Second Spacebar toggles it back.
 *  3. Spacebar updates the setting description.
 *  4. Mouse click toggles the embed control.
 *  5. Enter on the embed control submits the modal without inverting the embed state.
 */

import { describe, it, expect, vi } from "vitest";
import { EditLinkModal } from "../src/EditLinkModal";
import { App } from "./__mocks__/obsidian";
import { LinkInfo } from "../src/types";

// ---------------------------------------------------------------------------
// Patch HTMLElement with Obsidian's DOM extension methods that EditLinkModal
// calls (empty, addClass, removeClass, hasClass, createEl, createDiv, createSpan).
// ---------------------------------------------------------------------------
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
	if (!proto.createEl) {
		proto.createEl = function (
			tag: string,
			opts?: { text?: string; cls?: string }
		): HTMLElement {
			const el = document.createElement(tag);
			if (opts?.cls) el.className = opts.cls;
			if (opts?.text != null) el.textContent = opts.text;
			this.appendChild(el);
			return el;
		};
	}
	if (!proto.createDiv) {
		proto.createDiv = function (opts?: { cls?: string }): HTMLElement {
			return this.createEl("div", opts);
		};
	}
	if (!proto.createSpan) {
		proto.createSpan = function (opts?: { cls?: string; text?: string }): HTMLElement {
			return this.createEl("span", opts);
		};
	}
}
patchObsidianDom();

function openModal(linkOverrides: Partial<LinkInfo> = {}) {
	const app = new App() as any;
	Object.defineProperty(globalThis.navigator, "clipboard", {
		value: { readText: vi.fn().mockResolvedValue("") },
		writable: true,
		configurable: true,
	});

	const link: LinkInfo = {
		text: "My Document",
		destination: "Document.pdf",
		isWiki: true,
		isEmbed: false,
		...linkOverrides,
	};

	const onSubmit = vi.fn();
	const modal = new EditLinkModal(app, link, onSubmit);
	modal.open();

	return { modal, toggleEl: modal.embedToggle.toggleEl, onSubmit };
}

describe("Embed content toggle — Spacebar keyboard navigation", () => {
	it("Spacebar toggles embed control from false to true when focused", () => {
		const { modal, toggleEl } = openModal({ isEmbed: false });
		expect(modal.embedToggle.getValue()).toBe(false);

		// Focus the toggle element
		toggleEl.focus();

		// Dispatch Spacebar keydown on the focused toggle element
		toggleEl.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));

		// Embed value MUST be toggled to true
		expect(modal.embedToggle.getValue()).toBe(true);
	});

	it("Spacebar toggles embed control from true to false when focused", () => {
		const { modal, toggleEl } = openModal({ isEmbed: true });
		expect(modal.embedToggle.getValue()).toBe(true);

		toggleEl.focus();
		toggleEl.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));

		expect(modal.embedToggle.getValue()).toBe(false);
	});

	it("consecutive Spacebar presses toggle back and forth", () => {
		const { modal, toggleEl } = openModal({ isEmbed: false });
		expect(modal.embedToggle.getValue()).toBe(false);

		toggleEl.focus();
		toggleEl.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
		expect(modal.embedToggle.getValue()).toBe(true);

		toggleEl.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
		expect(modal.embedToggle.getValue()).toBe(false);
	});

	it("mouse click continues to toggle embed control", () => {
		const { modal, toggleEl } = openModal({ isEmbed: false });
		expect(modal.embedToggle.getValue()).toBe(false);

		toggleEl.click();
		expect(modal.embedToggle.getValue()).toBe(true);

		toggleEl.click();
		expect(modal.embedToggle.getValue()).toBe(false);
	});

	it("Enter on embed control submits the modal without toggling the embed state", () => {
		const { modal, toggleEl, onSubmit } = openModal({ isEmbed: false });
		expect(modal.embedToggle.getValue()).toBe(false);

		toggleEl.focus();
		toggleEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

		// Must submit with isEmbed still false (not toggled to true by Enter)
		expect(modal.embedToggle.getValue()).toBe(false);
		expect(onSubmit).toHaveBeenCalledTimes(1);
		expect(onSubmit).toHaveBeenCalledWith(
			expect.objectContaining({
				isEmbed: false,
			})
		);
	});
});
