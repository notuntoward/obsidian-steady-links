import { expect, test } from "@playwright/test";

type CursorRect = {
	top: number;
	left: number;
	width: number;
	height: number;
};

declare global {
	interface Window {
		__steadyLinksHarness: {
			setDoc(doc: string, cursorPos?: number): void;
			setCursor(pos: number): void;
			getDoc(): string;
			getCursor(): number;
			getLineTops(): number[];
			getAnchorRect(): CursorRect | null;
			getCursorRect(): CursorRect | null;
		};
	}
}

test.beforeEach(async ({ page }) => {
	await page.goto("/tests/playwright/index.html");
	await page.waitForFunction(() => Boolean(window.__steadyLinksHarness));
});

test("focusing a linked line does not shift following lines", async ({ page }) => {
	await page.evaluate(() => {
		window.__steadyLinksHarness.setDoc("Before\n[[Target note]]\nAfter\nTail", 0);
	});

	const before = await page.evaluate(() => window.__steadyLinksHarness.getLineTops());

	await page.evaluate(() => {
		const doc = window.__steadyLinksHarness.getDoc();
		const pos = doc.indexOf("Target note");
		window.__steadyLinksHarness.setCursor(pos);
	});

	const after = await page.evaluate(() => window.__steadyLinksHarness.getLineTops());

	expect(after).toHaveLength(before.length);
	for (let i = 0; i < before.length; i += 1) {
		expect(Math.abs(after[i] - before[i])).toBeLessThan(0.5);
	}
	expect(Math.abs(after[2] - before[2])).toBeLessThan(0.5);
	expect(Math.abs(after[3] - before[3])).toBeLessThan(0.5);
});

test("hidden syntax anchor remains measurable at a link boundary", async ({ page }) => {
	await page.evaluate(() => {
		window.__steadyLinksHarness.setDoc("[[Target]]", 0);
		const doc = window.__steadyLinksHarness.getDoc();
		const pos = doc.indexOf("Target");
		window.__steadyLinksHarness.setCursor(pos);
	});

	const anchorRect = await page.evaluate(() => window.__steadyLinksHarness.getAnchorRect());

	expect(anchorRect).not.toBeNull();
	expect((anchorRect as CursorRect).height).toBeGreaterThan(0);
	expect((anchorRect as CursorRect).width).toBeGreaterThan(0);
});
