import { expect, test } from "@playwright/test";
import type { HarnessRect, SteadyLinksHarness } from "./harnessTypes";

function getHarness(): SteadyLinksHarness {
	const harness = window.__steadyLinksHarness;
	if (!harness) {
		throw new Error("Steady Links Playwright harness did not initialize");
	}
	return harness;
}

test.beforeEach(async ({ page }) => {
	await page.goto("/tests/playwright/index.html");
	await page.waitForFunction(() => Boolean(window.__steadyLinksHarness));
});

test("focusing a linked line does not shift following lines", async ({ page }) => {
	await page.evaluate(() => {
		window.__steadyLinksHarness?.setDoc("Before\n[[Target note]]\nAfter\nTail", 0);
	});

	const before = await page.evaluate(() => {
		const harness = window.__steadyLinksHarness;
		if (!harness) {
			throw new Error("Steady Links Playwright harness did not initialize");
		}
		return harness.getLineTops();
	});

	await page.evaluate(() => {
		const harness = window.__steadyLinksHarness;
		if (!harness) {
			throw new Error("Steady Links Playwright harness did not initialize");
		}
		const doc = harness.getDoc();
		const pos = doc.indexOf("Target note");
		harness.setCursor(pos);
	});

	const after = await page.evaluate(() => {
		const harness = window.__steadyLinksHarness;
		if (!harness) {
			throw new Error("Steady Links Playwright harness did not initialize");
		}
		return harness.getLineTops();
	});

	expect(after).toHaveLength(before.length);
	for (let i = 0; i < before.length; i += 1) {
		expect(Math.abs(after[i] - before[i])).toBeLessThan(0.5);
	}
	expect(Math.abs(after[2] - before[2])).toBeLessThan(0.5);
	expect(Math.abs(after[3] - before[3])).toBeLessThan(0.5);
});

test("hidden syntax anchor remains measurable at a link boundary", async ({ page }) => {
	await page.evaluate(() => {
		const harness = window.__steadyLinksHarness;
		if (!harness) {
			throw new Error("Steady Links Playwright harness did not initialize");
		}
		harness.setDoc("[[Target]]", 0);
		const doc = harness.getDoc();
		const pos = doc.indexOf("Target");
		harness.setCursor(pos);
	});

	const anchorRect = await page.evaluate(() => {
		const harness = window.__steadyLinksHarness;
		if (!harness) {
			throw new Error("Steady Links Playwright harness did not initialize");
		}
		return harness.getAnchorRect();
	});

	expect(anchorRect).not.toBeNull();
	expect((anchorRect as HarnessRect).height).toBeGreaterThan(0);
	expect((anchorRect as HarnessRect).width).toBeGreaterThan(0);
});
