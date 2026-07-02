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

test("down-arrow from blank line above markdown link: two presses reach line 3", async ({
	page,
}) => {
	// Doc: line 1 = "" (blank), line 2 = "[dklfsdfg](...) asdflkjasdlfj", line 3 = "alsdkfjasldjf"
	// Cursor starts on line 1 (pos 0).
	// Press ArrowDown twice.  If the cursor bounces back to line 1 after the
	// first ArrowDown, the second ArrowDown will land on line 2 again (stuck).
	// Correct behaviour: first ArrowDown → line 2, second ArrowDown → line 3.
	await page.evaluate(() => {
		const harness = window.__steadyLinksHarness;
		if (!harness) throw new Error("Steady Links Playwright harness did not initialize");
		harness.setDoc(
			"\n[dklfsdfg](http://arxiv.org/abs/2602.19141) asdflkjasdlfj\nalsdkfjasldjf",
			0
		);
	});

	await page.keyboard.press("ArrowDown");
	await page.waitForTimeout(100);

	await page.keyboard.press("ArrowDown");
	await page.waitForTimeout(100);

	const result = await page.evaluate(() => {
		const harness = window.__steadyLinksHarness;
		if (!harness) throw new Error("Steady Links Playwright harness did not initialize");
		const doc = harness.getDoc();
		const cursor = harness.getCursor();
		const lines = doc.split("\n");
		const line3Start = lines[0].length + 1 + lines[1].length + 1;
		const line3End = line3Start + lines[2].length;
		return { cursor, line3Start, line3End };
	});

	// After two ArrowDown presses, cursor must be on line 3
	expect(result.cursor).toBeGreaterThanOrEqual(result.line3Start);
	expect(result.cursor).toBeLessThanOrEqual(result.line3End);
});

test("up-arrow from below markdown link: two presses reach line 1", async ({ page }) => {
	// Doc: line 1 = "" (blank), line 2 = "[dklfsdfg](...) asdflkjasdlfj", line 3 = "alsdkfjasldjf"
	// Cursor starts on line 3 (pos 61).
	// Press ArrowUp twice.  If up-arrow skips line 2 (the link line), the
	// cursor goes directly from line 3 to line 1 in a single press —
	// meaning the second press has nowhere to go (already at line 1).
	// Correct behaviour: first ArrowUp → line 2, second ArrowUp → line 1.
	await page.evaluate(() => {
		const harness = window.__steadyLinksHarness;
		if (!harness) throw new Error("Steady Links Playwright harness did not initialize");
		harness.setDoc(
			"\n[dklfsdfg](http://arxiv.org/abs/2602.19141) asdflkjasdlfj\nalsdkfjasldjf",
			61
		);
	});

	// First ArrowUp: should land on line 2 (the link line), NOT skip to line 1
	await page.keyboard.press("ArrowUp");
	await page.waitForTimeout(100);

	const afterFirstUp = await page.evaluate(() => {
		const harness = window.__steadyLinksHarness;
		if (!harness) throw new Error("Steady Links Playwright harness did not initialize");
		const doc = harness.getDoc();
		const cursor = harness.getCursor();
		const lines = doc.split("\n");
		const line2Start = lines[0].length + 1;
		const line2End = line2Start + lines[1].length;
		return { cursor, line2Start, line2End };
	});

	// After one ArrowUp, cursor must be on line 2 (the link line), not line 1
	expect(afterFirstUp.cursor).toBeGreaterThanOrEqual(afterFirstUp.line2Start);
	expect(afterFirstUp.cursor).toBeLessThanOrEqual(afterFirstUp.line2End);
});

// ────────────────────────────────────────────────────────────────────────
// BUG GUARD: Emacs-style next-line with an active mark (selection) must
// not get stuck on a blank line before a line-start wikilink.
//
// This mirrors the obsidian-emacs-text-editor plugin's next-line command:
// with a mark set, it collapses the selection, moves down one visual line
// (real CM6 vertical motion via view.moveVertically, which is pixel-based
// and uses coordsAtPos — this cannot be faithfully simulated in jsdom),
// then re-expands the selection back to the mark.
// ────────────────────────────────────────────────────────────────────────
test("emacs next-line with active mark moves through blank line before a line-start wikilink", async ({
	page,
}) => {
	const doc = [
		"---",
		"title: Note Six",
		"is_active: true",
		"version: 2",
		"tags:",
		"  - project-c",
		"  - needs-review",
		"---",
		"# heading 1",
		"",
		"This note has boolean and number properties.",
		"[[Note-05]]",
		"",
		"## heading 1.1",
		"",
		"[[Western Climate Initiative]]",
	].join("\n");

	await page.evaluate((d) => {
		const harness = window.__steadyLinksHarness;
		if (!harness) throw new Error("Steady Links Playwright harness did not initialize");
		const markPos = d.indexOf("# heading 1");
		harness.setDoc(d, markPos);
	}, doc);

	const results = await page.evaluate(() => {
		const harness = window.__steadyLinksHarness;
		if (!harness) throw new Error("Steady Links Playwright harness did not initialize");
		const d = harness.getDoc();
		const markPos = d.indexOf("# heading 1");
		const out: { lineNumber: number; lineText: string }[] = [];
		const totalLines = d.split("\n").length;
		for (let i = 0; i < totalLines + 2; i += 1) {
			const r = harness.emacsMoveLine(markPos, true);
			out.push({ lineNumber: r.lineNumber, lineText: r.lineText });
		}
		return out;
	});

	// Line numbers must never decrease (no backward bounce), and the
	// cursor must end up on the final line (the line-start wikilink).
	for (let i = 1; i < results.length; i += 1) {
		expect(results[i].lineNumber).toBeGreaterThanOrEqual(results[i - 1].lineNumber);
	}
	expect(results[results.length - 1].lineText).toBe("[[Western Climate Initiative]]");
});
