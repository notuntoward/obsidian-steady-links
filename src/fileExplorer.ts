import type { VaultLinkTarget } from "./linkTargetResolution";

export interface NativeFileExplorerPlugin {
	instance?: {
		revealInFolder?: (file: VaultLinkTarget) => void;
	};
}

/**
 * Ask Obsidian's native File Explorer plugin to reveal a vault file.
 */
export function revealInNativeFileExplorer(
	plugin: NativeFileExplorerPlugin | null | undefined,
	file: VaultLinkTarget
): boolean {
	const instance = plugin?.instance;
	const revealInFolder = instance?.revealInFolder;
	if (typeof revealInFolder !== "function") return false;

	revealInFolder.call(instance, file);
	return true;
}
