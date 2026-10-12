declare module "electron" {
	export interface Shell {
		openPath(path: string): Promise<string>;
		openExternal(url: string, options?: Record<string, unknown>): Promise<void>;
	}
	export const shell: Shell;
}
