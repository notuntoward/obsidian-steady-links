import { EditorState, EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createLinkSyntaxHiderExtension, setSyntaxHiderEnabled } from "../../src/linkSyntaxHider";
import type { SteadyLinksHarness } from "./harnessTypes";

const root = document.createElement("div");
root.className = "markdown-source-view is-live-preview steady-links-harness";
document.body.appendChild(root);

const editorHost = document.createElement("div");
editorHost.className = "cm-editor-host";
root.appendChild(editorHost);

const baseExtensions = [EditorView.lineWrapping, createLinkSyntaxHiderExtension()];

let view = createView("Before\n[[Target note]]\nAfter\nTail", 0);

function createView(doc: string, cursorPos: number): EditorView {
	const state = EditorState.create({
		doc,
		selection: EditorSelection.cursor(cursorPos),
		extensions: baseExtensions,
	});

	const editorView = new EditorView({
		state,
		parent: editorHost,
	});

	editorView.dispatch({ effects: [setSyntaxHiderEnabled.of(true)] });
	return editorView;
}

function replaceView(doc: string, cursorPos = 0): void {
	view.destroy();
	view = createView(doc, cursorPos);
	view.focus();
}

const harness: SteadyLinksHarness = {
	setDoc(doc: string, cursorPos = 0) {
		replaceView(doc, cursorPos);
	},
	setCursor(pos: number) {
		view.dispatch({
			selection: EditorSelection.cursor(pos),
			scrollIntoView: true,
		});
		view.focus();
	},
	getDoc() {
		return view.state.doc.toString();
	},
	getCursor() {
		return view.state.selection.main.head;
	},
	getLineTops() {
		return Array.from(view.dom.querySelectorAll(".cm-line")).map(
			(line) => line.getBoundingClientRect().top
		);
	},
	getAnchorRect() {
		const anchor = view.dom.querySelector(".le-hidden-syntax-anchor") as HTMLElement | null;
		if (!anchor) return null;
		const rect = anchor.getBoundingClientRect();
		return {
			top: rect.top,
			left: rect.left,
			width: rect.width,
			height: rect.height,
		};
	},
	getCursorRect() {
		const cursor = view.dom.querySelector(".cm-cursor") as HTMLElement | null;
		if (!cursor) return null;
		const rect = cursor.getBoundingClientRect();
		return {
			top: rect.top,
			left: rect.left,
			width: rect.width,
			height: rect.height,
		};
	},
	destroy() {
		view.destroy();
	},
};

window.__steadyLinksHarness = harness;

view.focus();
