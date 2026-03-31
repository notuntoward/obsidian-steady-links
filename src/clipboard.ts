/**
 * Clipboard Service Abstraction
 *
 * Provides an injectable interface for clipboard operations,
 * allowing tests to mock clipboard access without relying on
 * browser APIs.
 */

// ============================================================================
// Interface
// ============================================================================

/**
 * Service interface for clipboard operations
 */
export interface ClipboardService {
	/**
	 * Read text from the clipboard
	 * @returns The clipboard text, or empty string if unavailable
	 */
	readText(): Promise<string>;

	/**
	 * Write text to the clipboard
	 * @param text The text to write
	 */
	writeText(text: string): Promise<void>;
}

// ============================================================================
// Browser Implementation
// ============================================================================

/**
 * Default clipboard service using the browser's Navigator.clipboard API
 */
export const browserClipboard: ClipboardService = {
	async readText(): Promise<string> {
		try {
			return await navigator.clipboard.readText();
		} catch {
			// Clipboard access may fail due to permissions or security
			return '';
		}
	},

	async writeText(text: string): Promise<void> {
		await navigator.clipboard.writeText(text);
	},
};

// ============================================================================
// Mock Implementations for Testing
// ============================================================================

/**
 * Options for creating a mock clipboard
 */
export interface MockClipboardOptions {
	/** Initial clipboard content */
	initialText?: string;
	/** Whether readText should throw an error */
	shouldFail?: boolean;
	/** Custom error message for failures */
	errorMessage?: string;
}

/**
 * Create a mock clipboard service for testing
 *
 * @example
 * ```ts
 * const clipboard = createMockClipboard({ initialText: 'https://example.com' });
 * const text = await clipboard.readText(); // 'https://example.com'
 * ```
 */
export function createMockClipboard(options: MockClipboardOptions = {}): ClipboardService & {
	/** Get the current clipboard content (test helper) */
	getText(): string;
	/** Set the clipboard content (test helper) */
	setText(text: string): void;
	/** Get the write history (test helper) */
	getWriteHistory(): string[];
} {
	let text = options.initialText ?? '';
	const writeHistory: string[] = [];

	return {
		async readText(): Promise<string> {
			if (options.shouldFail) {
				throw new Error(options.errorMessage ?? 'Clipboard access denied');
			}
			return text;
		},

		async writeText(newText: string): Promise<void> {
			if (options.shouldFail) {
				throw new Error(options.errorMessage ?? 'Clipboard access denied');
			}
			text = newText;
			writeHistory.push(newText);
		},

		// Test helpers
		getText(): string {
			return text;
		},

		setText(newText: string): void {
			text = newText;
		},

		getWriteHistory(): string[] {
			return [...writeHistory];
		},
	};
}

/**
 * Create a clipboard service that tracks calls but delegates to real implementation
 * Useful for integration tests that want to verify clipboard usage
 */
export function createTrackingClipboard(realClipboard: ClipboardService): ClipboardService & {
	/** Get the number of times readText was called */
	getReadCount(): number;
	/** Get the number of times writeText was called */
	getWriteCount(): number;
	/** Get all texts that were written */
	getWrittenTexts(): string[];
	/** Reset all tracking counters */
	reset(): void;
} {
	let readCount = 0;
	let writeCount = 0;
	const writtenTexts: string[] = [];

	return {
		async readText(): Promise<string> {
			readCount++;
			return realClipboard.readText();
		},

		async writeText(text: string): Promise<void> {
			writeCount++;
			writtenTexts.push(text);
			return realClipboard.writeText(text);
		},

		getReadCount(): number {
			return readCount;
		},

		getWriteCount(): number {
			return writeCount;
		},

		getWrittenTexts(): string[] {
			return [...writtenTexts];
		},

		reset(): void {
			readCount = 0;
			writeCount = 0;
			writtenTexts.length = 0;
		},
	};
}

// ============================================================================
// Null/No-op Implementation
// ============================================================================

/**
 * A no-op clipboard service that does nothing
 * Useful for tests that don't need clipboard functionality
 */
export const nullClipboard: ClipboardService = {
	async readText(): Promise<string> {
		return '';
	},

	async writeText(_text: string): Promise<void> {
		// No-op
	},
};
