// @vitest-environment node

/**
 * Obsidian's community plugin review guidelines require plugins not to log
 * to the developer console during normal operation. This repo has more than
 * one gated `console.log` debug helper (e.g. `EDITOR_SUGGEST_DEBUG` in
 * EditorFileSuggest.ts, `STEADY_LINKS_DEBUG` in linkSyntaxHider.ts) used to
 * diagnose hard-to-reproduce real-Obsidian issues. It is easy to flip one of
 * these to `true` while diagnosing a bug and forget to flip it back before
 * shipping — that happened once already in this repo.
 *
 * This test statically scans every `src/*.ts` file for any top-level
 * `const ..._DEBUG... = <boolean>` declaration and fails if any of them are
 * `true`, so leaving a debug flag on is caught by `npm test` / CI instead of
 * only being noticed by a user seeing console spam.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

describe("Debug flag compliance", () => {
	it("no source file leaves a *DEBUG* flag enabled by default", () => {
		const srcDir = join(__dirname, "..", "src");
		const files = readdirSync(srcDir).filter((f) => f.endsWith(".ts"));
		const offenders: string[] = [];

		for (const file of files) {
			const content = readFileSync(join(srcDir, file), "utf8");
			const matches = content.matchAll(/const\s+([A-Za-z0-9_]*DEBUG[A-Za-z0-9_]*)\s*=\s*(true|false)\b/g);
			for (const match of matches) {
				const [, name, value] = match;
				if (value === "true") {
					offenders.push(`${file}: ${name} = true`);
				}
			}
		}

		expect(offenders).toEqual([]);
	});

	it("sanity check: the scan actually finds the known debug flags (so a rename doesn't silently disable this test)", () => {
		const srcDir = join(__dirname, "..", "src");
		const files = readdirSync(srcDir).filter((f) => f.endsWith(".ts"));
		const found: string[] = [];

		for (const file of files) {
			const content = readFileSync(join(srcDir, file), "utf8");
			const matches = content.matchAll(/const\s+([A-Za-z0-9_]*DEBUG[A-Za-z0-9_]*)\s*=\s*(true|false)\b/g);
			for (const match of matches) {
				found.push(match[1]);
			}
		}

		expect(found).toContain("EDITOR_SUGGEST_DEBUG");
		expect(found).toContain("STEADY_LINKS_DEBUG");
	});
});
