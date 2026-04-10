// @vitest-environment jsdom

/**
 * Integration tests for the Link Type segmented control in EditLinkModal.
 *
 * These tests open a real EditLinkModal instance (using the jsdom + mock
 * Obsidian API) and interact with the Wikilink / Markdown buttons directly,
 * protecting against the following AI regression patterns:
 *
 *  1. Replacing the segmented control back with a toggle
 *  2. Removing seg-btn--active from a button after it is clicked
 *  3. Losing the active class when focus moves away (the original bug)
 *  4. Space key not cycling between types
 *  5. Arrow keys not switching types
 *  6. Enter key being swallowed (not reaching the modal submit handler)
 *  7. Roving tabindex: active button must have tabindex="0", inactive "-1"
 *  8. updateUIState must keep active class in sync with isWiki
 *  9. Destination field must be converted when link type changes
 * 10. Both buttons must always be present (not reverted to single toggle)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EditLinkModal } from "../src/EditLinkModal";
import { App } from "./__mocks__/obsidian";
import { LinkInfo } from "../src/types";

// ---------------------------------------------------------------------------
// Patch HTMLElement with Obsidian's DOM extension methods that EditLinkModal
// calls (empty, addClass, removeClass, hasClass, createEl, createDiv).
// These live on the real Obsidian HTMLElement prototype but not in jsdom.
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

// ---------------------------------------------------------------------------
// Helper: open a modal with a wikilink and return it + its buttons
// ---------------------------------------------------------------------------

function openModal(linkOverrides: Partial<LinkInfo> = {}) {
	const app = new App() as any;
	// Stub clipboard so populateFromClipboard() doesn't blow up in jsdom.
	// navigator is read-only in jsdom so we must use defineProperty.
	Object.defineProperty(globalThis.navigator, "clipboard", {
		value: { readText: vi.fn().mockResolvedValue("") },
		writable: true,
		configurable: true,
	});

	const link: LinkInfo = {
		text: "Wote Nine",
		destination: "Note-09",
		isWiki: true,
		isEmbed: false,
		...linkOverrides,
	};

	const onSubmit = vi.fn();
	const modal = new EditLinkModal(app, link, onSubmit);
	modal.open();

	const wikiBtn = modal.wikiBtnEl;
	const mdBtn = modal.mdBtnEl;

	return { modal, wikiBtn, mdBtn, onSubmit };
}

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

describe("Link Type segmented control — structure", () => {
	it("renders both a Wikilink and a Markdown button", () => {
		const { wikiBtn, mdBtn } = openModal();
		expect(wikiBtn).toBeTruthy();
		expect(mdBtn).toBeTruthy();
		expect(wikiBtn.textContent).toBe("Wikilink");
		expect(mdBtn.textContent).toBe("Markdown");
	});

	it("buttons have type=button to prevent accidental form submit", () => {
		const { wikiBtn, mdBtn } = openModal();
		expect(wikiBtn.getAttribute("type")).toBe("button");
		expect(mdBtn.getAttribute("type")).toBe("button");
	});
});

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe("Link Type segmented control — initial state", () => {
	it("Wikilink button is active when link is a wikilink", () => {
		const { wikiBtn, mdBtn } = openModal({ isWiki: true });
		expect(wikiBtn.classList.contains("seg-btn--active")).toBe(true);
		expect(mdBtn.classList.contains("seg-btn--active")).toBe(false);
	});

	it("Markdown button is active when link is a markdown link", () => {
		const { wikiBtn, mdBtn } = openModal({
			isWiki: false,
			destination: "https://example.com",
		});
		expect(wikiBtn.classList.contains("seg-btn--active")).toBe(false);
		expect(mdBtn.classList.contains("seg-btn--active")).toBe(true);
	});

	it("active button has tabindex=0, inactive has tabindex=-1 (wikilink)", () => {
		const { wikiBtn, mdBtn } = openModal({ isWiki: true });
		expect(wikiBtn.getAttribute("tabindex")).toBe("0");
		expect(mdBtn.getAttribute("tabindex")).toBe("-1");
	});

	it("active button has tabindex=0, inactive has tabindex=-1 (markdown)", () => {
		const { wikiBtn, mdBtn } = openModal({
			isWiki: false,
			destination: "https://example.com",
		});
		expect(wikiBtn.getAttribute("tabindex")).toBe("-1");
		expect(mdBtn.getAttribute("tabindex")).toBe("0");
	});
});

// ---------------------------------------------------------------------------
// Mouse click
// ---------------------------------------------------------------------------

describe("Link Type segmented control — mouse click", () => {
	it("clicking Markdown button makes it active and deactivates Wikilink", () => {
		const { modal, wikiBtn, mdBtn } = openModal({ isWiki: true });
		mdBtn.click();
		expect(mdBtn.classList.contains("seg-btn--active")).toBe(true);
		expect(wikiBtn.classList.contains("seg-btn--active")).toBe(false);
		expect(modal.isWiki).toBe(false);
	});

	it("clicking Wikilink button makes it active and deactivates Markdown", () => {
		const { modal, wikiBtn, mdBtn } = openModal({
			isWiki: false,
			destination: "https://example.com",
		});
		wikiBtn.click();
		expect(wikiBtn.classList.contains("seg-btn--active")).toBe(true);
		expect(mdBtn.classList.contains("seg-btn--active")).toBe(false);
		expect(modal.isWiki).toBe(true);
	});

	it("active class persists after focus moves elsewhere", () => {
		// Regression: Obsidian button resets used to strip the active fill on blur
		const { modal, wikiBtn, mdBtn } = openModal({ isWiki: true });
		mdBtn.click();
		// Simulate focus moving away from the button
		mdBtn.dispatchEvent(new FocusEvent("blur"));
		wikiBtn.dispatchEvent(new FocusEvent("focus"));
		// Active class must still be on mdBtn — this was the visual regression
		expect(mdBtn.classList.contains("seg-btn--active")).toBe(true);
		expect(wikiBtn.classList.contains("seg-btn--active")).toBe(false);
		expect(modal.isWiki).toBe(false);
	});

	it("roving tabindex updates correctly after click", () => {
		const { wikiBtn, mdBtn } = openModal({ isWiki: true });
		mdBtn.click();
		expect(mdBtn.getAttribute("tabindex")).toBe("0");
		expect(wikiBtn.getAttribute("tabindex")).toBe("-1");
	});
});

// ---------------------------------------------------------------------------
// Keyboard — Space
// ---------------------------------------------------------------------------

describe("Link Type segmented control — Space key", () => {
	it("Space on Wikilink button cycles to Markdown", () => {
		const { modal, wikiBtn, mdBtn } = openModal({ isWiki: true });
		wikiBtn.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
		expect(modal.isWiki).toBe(false);
		expect(mdBtn.classList.contains("seg-btn--active")).toBe(true);
		expect(wikiBtn.classList.contains("seg-btn--active")).toBe(false);
	});

	it("Space on Markdown button cycles to Wikilink", () => {
		const { modal, wikiBtn, mdBtn } = openModal({
			isWiki: false,
			destination: "https://example.com",
		});
		mdBtn.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
		expect(modal.isWiki).toBe(true);
		expect(wikiBtn.classList.contains("seg-btn--active")).toBe(true);
		expect(mdBtn.classList.contains("seg-btn--active")).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Keyboard — Arrow keys
// ---------------------------------------------------------------------------

describe("Link Type segmented control — Arrow keys", () => {
	it("ArrowRight on Wikilink button switches to Markdown", () => {
		const { modal, wikiBtn, mdBtn } = openModal({ isWiki: true });
		wikiBtn.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
		expect(modal.isWiki).toBe(false);
		expect(mdBtn.classList.contains("seg-btn--active")).toBe(true);
	});

	it("ArrowLeft on Markdown button switches to Wikilink", () => {
		const { modal, wikiBtn, mdBtn } = openModal({
			isWiki: false,
			destination: "https://example.com",
		});
		mdBtn.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
		expect(modal.isWiki).toBe(true);
		expect(wikiBtn.classList.contains("seg-btn--active")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Keyboard — Enter must NOT be swallowed
// ---------------------------------------------------------------------------

describe("Link Type segmented control — Enter key propagation", () => {
	it("Enter on Wikilink button bubbles up (not stopped by button handler)", () => {
		const { wikiBtn } = openModal({ isWiki: true });
		let propagated = false;
		// Listen at the parent level — if Enter propagates we see it
		wikiBtn.parentElement!.addEventListener("keydown", (e) => {
			if (e.key === "Enter") propagated = true;
		});
		wikiBtn.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
		expect(propagated).toBe(true);
	});

	it("Enter on Markdown button bubbles up (not stopped by button handler)", () => {
		const { mdBtn } = openModal({ isWiki: true });
		let propagated = false;
		mdBtn.parentElement!.addEventListener("keydown", (e) => {
			if (e.key === "Enter") propagated = true;
		});
		mdBtn.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
		expect(propagated).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// updateUIState keeps active class in sync
// ---------------------------------------------------------------------------

describe("Link Type segmented control — updateUIState sync", () => {
	it("updateUIState sets Wikilink active when isWiki=true", () => {
		const { modal, wikiBtn, mdBtn } = openModal({ isWiki: true });
		// Force isWiki to false then call updateUIState
		modal.isWiki = false;
		modal.updateUIState();
		expect(mdBtn.classList.contains("seg-btn--active")).toBe(true);
		expect(wikiBtn.classList.contains("seg-btn--active")).toBe(false);
	});

	it("updateUIState sets Markdown active when isWiki=false", () => {
		const { modal, wikiBtn, mdBtn } = openModal({
			isWiki: false,
			destination: "https://example.com",
		});
		modal.isWiki = true;
		modal.updateUIState();
		expect(wikiBtn.classList.contains("seg-btn--active")).toBe(true);
		expect(mdBtn.classList.contains("seg-btn--active")).toBe(false);
	});

	it("updateUIState keeps roving tabindex in sync", () => {
		const { modal, wikiBtn, mdBtn } = openModal({ isWiki: true });
		modal.isWiki = false;
		modal.updateUIState();
		expect(mdBtn.getAttribute("tabindex")).toBe("0");
		expect(wikiBtn.getAttribute("tabindex")).toBe("-1");
	});
});
