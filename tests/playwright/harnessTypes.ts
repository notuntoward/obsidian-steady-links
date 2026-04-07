export type HarnessRect = {
	top: number;
	left: number;
	width: number;
	height: number;
};

export type SteadyLinksHarness = {
	setDoc(doc: string, cursorPos?: number): void;
	setCursor(pos: number): void;
	getDoc(): string;
	getCursor(): number;
	getLineTops(): number[];
	getAnchorRect(): HarnessRect | null;
	getCursorRect(): HarnessRect | null;
	destroy(): void;
};

declare global {
	interface Window {
		__steadyLinksHarness?: SteadyLinksHarness;
	}
}

export {};
