import { describe, expect, it, vi } from "vitest";
import {
	resolveLocalFileTargetPath,
	resolveVaultFileFromLink,
} from "../src/linkTargetResolution";
import { detectLinkAtCursor } from "../src/utils";

describe("resolveLocalFileTargetPath", () => {
	it("decodes Markdown paths before resolving and converts vault paths to OS paths", () => {
		const detectedLink = detectLinkAtCursor(
			"[Quarterly report](Attachments/Quarterly%20Report.pdf#page=4)",
			5
		);
		expect(detectedLink).not.toBeNull();
		const resolveVaultPath = vi.fn((linkPath: string) =>
			linkPath === "Attachments/Quarterly Report.pdf"
				? { path: "Attachments/Quarterly Report.pdf" }
				: null
		);
		const getFullPath = vi.fn((path: string) => `/vault/${path}`);

		expect(
			resolveLocalFileTargetPath(
				detectedLink!.link,
				"Notes/Current.md",
				resolveVaultPath,
				getFullPath
			)
		).toBe("/vault/Attachments/Quarterly Report.pdf");
		expect(resolveVaultPath).toHaveBeenCalledWith(
			"Attachments/Quarterly Report.pdf",
			"Notes/Current.md"
		);
		expect(getFullPath).toHaveBeenCalledWith("Attachments/Quarterly Report.pdf");
	});

	it("preserves percent escapes in wikilink filenames", () => {
		const detectedLink = detectLinkAtCursor("[[Notes/Report%20final.pdf]]", 4);
		expect(detectedLink).not.toBeNull();
		const resolveVaultPath = vi.fn(() => ({ path: "Notes/Report%20final.pdf" }));

		expect(
			resolveLocalFileTargetPath(
				detectedLink!.link,
				"Notes/Current.md",
				resolveVaultPath,
				(path) => `/vault/${path}`
			)
		).toBe("/vault/Notes/Report%20final.pdf");
		expect(resolveVaultPath).toHaveBeenCalledWith(
			"Notes/Report%20final.pdf",
			"Notes/Current.md"
		);
	});

	it("decodes an encoded hash in the filename without mistaking it for a subpath", () => {
		const detectedLink = detectLinkAtCursor(
			"[Report](Attachments/Report%23final.pdf#page=5)",
			4
		);
		expect(detectedLink).not.toBeNull();
		const resolveVaultPath = vi.fn((linkPath: string) =>
			linkPath === "Attachments/Report#final.pdf"
				? { path: "Attachments/Report#final.pdf" }
				: null
		);

		expect(
			resolveLocalFileTargetPath(
				detectedLink!.link,
				"Notes/Current.md",
				resolveVaultPath,
				(path) => `/vault/${path}`
			)
		).toBe("/vault/Attachments/Report#final.pdf");
		expect(resolveVaultPath).toHaveBeenCalledWith(
			"Attachments/Report#final.pdf",
			"Notes/Current.md"
		);
	});

	it("returns the resolved TFile so the native explorer can reveal that exact vault item", () => {
		const detectedLink = detectLinkAtCursor("[Quarterly report](Reports/Quarterly%20Report.md)", 5);
		expect(detectedLink).not.toBeNull();
		const targetFile = { path: "Reports/Quarterly Report.md", basename: "Quarterly Report" };
		const resolveVaultPath = vi.fn((linkPath: string) =>
			linkPath === "Reports/Quarterly Report.md" ? targetFile : null
		);

		expect(
			resolveVaultFileFromLink(
				detectedLink!.link,
				"Notes/Current.md",
				resolveVaultPath
			)
		).toBe(targetFile);
		expect(resolveVaultPath).toHaveBeenCalledWith(
			"Reports/Quarterly Report.md",
			"Notes/Current.md"
		);
	});

	it("uses a decoded absolute Markdown path when it is outside the vault", () => {
		const resolveVaultPath = vi.fn(() => null);

		expect(
			resolveLocalFileTargetPath(
				{ destination: "C:/Shared%20Files/Report.pdf#page=2", isWiki: false },
				"Notes/Current.md",
				resolveVaultPath
			)
		).toBe("C:/Shared Files/Report.pdf");
	});

	it("leaves malformed escapes intact so literal paths can still resolve", () => {
		const resolveVaultPath = vi.fn((linkPath: string) =>
			linkPath === "Attachments/Report%ZZ.pdf"
				? { path: "Attachments/Report%ZZ.pdf" }
				: null
		);

		expect(
			resolveLocalFileTargetPath(
				{ destination: "Attachments/Report%ZZ.pdf", isWiki: false },
				"Notes/Current.md",
				resolveVaultPath,
				(path) => `/vault/${path}`
			)
		).toBe("/vault/Attachments/Report%ZZ.pdf");
		expect(resolveVaultPath).toHaveBeenCalledWith(
			"Attachments/Report%ZZ.pdf",
			"Notes/Current.md"
		);
	});
});
