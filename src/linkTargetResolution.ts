export interface VaultLinkTarget {
	path: string;
}

export interface LocalFileLink {
	destination: string;
	isWiki: boolean;
}

function filePathFromLink(link: LocalFileLink): string | null {
	let filePath = link.destination.trim();
	if (filePath.startsWith("<") && filePath.endsWith(">")) {
		filePath = filePath.slice(1, -1).trim();
	}
	filePath = filePath.split("#", 1)[0].trim();
	if (!filePath) return null;

	if (!link.isWiki) {
		try {
			filePath = decodeURIComponent(filePath);
		} catch {
			// Leave malformed escapes unchanged so a literal filename can still resolve.
		}
	}

	return filePath;
}

/**
 * Resolve a link to a vault file, decoding Markdown destinations before lookup.
 */
export function resolveVaultFileFromLink<T extends VaultLinkTarget>(
	link: LocalFileLink,
	sourcePath: string,
	resolveVaultPath: (linkPath: string, sourcePath: string) => T | null
): T | null {
	const filePath = filePathFromLink(link);
	if (!filePath) return null;

	try {
		return resolveVaultPath(filePath, sourcePath);
	} catch {
		return null;
	}
}

/**
 * Resolve a local link destination to an OS path for opening in its default app.
 *
 * Obsidian stores Markdown link destinations as URI-encoded paths, while
 * MetadataCache.getFirstLinkpathDest expects a decoded vault linkpath. Decode
 * only Markdown destinations: a wikilink can contain a literal percent escape
 * as part of its filename.
 */
export function resolveLocalFileTargetPath(
	link: LocalFileLink,
	sourcePath: string,
	resolveVaultPath: (linkPath: string, sourcePath: string) => VaultLinkTarget | null,
	getFullPath?: (vaultPath: string) => string
): string | null {
	const filePath = filePathFromLink(link);
	if (!filePath) return null;

	const file = resolveVaultFileFromLink(link, sourcePath, resolveVaultPath);
	if (file && getFullPath) return getFullPath(file.path);

	if (
		/^[A-Za-z]:[\\/]/.test(filePath) ||
		filePath.startsWith("/") ||
		filePath.startsWith("\\\\")
	) {
		return filePath;
	}

	return null;
}
