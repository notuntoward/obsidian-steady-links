import { describe, expect, it, vi } from "vitest";
import { revealInNativeFileExplorer } from "../src/fileExplorer";

describe("revealInNativeFileExplorer", () => {
	it("passes the linked TFile to Obsidian's native File Explorer plugin", () => {
		const file = { path: "Reports/Quarterly Report.md" };
		const revealInFolder = vi.fn();

		expect(
			revealInNativeFileExplorer({ instance: { revealInFolder } }, file)
		).toBe(true);
		expect(revealInFolder).toHaveBeenCalledWith(file);
	});

	it("reports when the native File Explorer reveal API is unavailable", () => {
		expect(revealInNativeFileExplorer(undefined, { path: "Reports/Quarterly Report.md" })).toBe(
			false
		);
		expect(revealInNativeFileExplorer({ instance: {} }, { path: "Reports/Quarterly Report.md" })).toBe(
			false
		);
	});
});
