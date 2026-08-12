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
	/**
	 * Sets the editor host width (px) to force soft wrapping.
	 */
	setHostWidth(px: number): void;
	/**
	 * Faithfully replicates obsidian-emacs-text-editor's
	 * moveToLineBoundary(editor, view, forward=true) (the "Move end of line"
	 * command), which is equivalent to CM6's cursorLineEnd / End key on a
	 * wrapped line: it seeds view.moveToLineBoundary with the current
	 * head+assoc, then dispatches the returned range tagged with the
	 * "emacs.moveToEnd" userEvent. Returns the head+assoc that
	 * moveToLineBoundary produced.
	 */
	dispatchEmacsMoveToEndFrom(fromPos: number): { head: number; assoc: number };
	/**
	 * Returns { head, assoc } of the main selection.
	 */
	getCursorAssoc(): { head: number; assoc: number };
	/**
	 * Returns the document coordinates (viewport-relative top/left) at
	 * (pos, assoc), or null. Used to determine which visual line a position
	 * renders on.
	 */
	coordsAtPos(pos: number, assoc: number): { top: number; left: number } | null;
	/**
	 * Replicates CM6's deleteCharForward for a collapsed cursor not at a
	 * logical line end: deletes the single character at the cursor head.
	 * Returns the deleted character and the head before deletion.
	 */
	deleteForwardAtCursor(): { deletedChar: string; headBefore: number };
};

declare global {
	interface Window {
		__steadyLinksHarness?: SteadyLinksHarness;
	}
}

export {};
