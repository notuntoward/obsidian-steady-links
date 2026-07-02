export type HarnessRect = {
	top: number;
	left: number;
	width: number;
	height: number;
};

export type SteadyLinksHarness = {
	setDoc(doc: string, cursorPos?: number): void;
	setCursor(pos: number): void;
	pressKey(key: string): Promise<void>;
	getDoc(): string;
	getCursor(): number;
	getSelectionInfo(): { anchor: number; head: number; goalColumn: number | null };
	getLineTops(): number[];
	getAnchorRect(): HarnessRect | null;
	getCursorRect(): HarnessRect | null;
	destroy(): void;
	/**
	 * Simulates the emacs-text-editor plugin's next-line / previous-line
	 * command while a mark (selection anchor) is active:
	 *   1. Collapse the selection to the head.
	 *   2. Move one visual line via the real CM6 vertical-motion helper
	 *      (view.moveVertically — what cursorLineDown uses internally,
	 *      including pixel-based goal-column tracking).
	 *   3. Re-expand the selection from markPos to the new head.
	 * Returns the resulting selection head/anchor and the 1-based line
	 * number the head landed on.
	 */
	emacsMoveLine(
		markPos: number,
		forward: boolean
	): { anchor: number; head: number; lineNumber: number; lineText: string };
};

declare global {
	interface Window {
		__steadyLinksHarness?: SteadyLinksHarness;
	}
}

export {};
