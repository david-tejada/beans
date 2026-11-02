import type { Editor } from "./shared/types";

// Which editor Beans runs in. extension.ts sets it once, on activation.
let current: Editor = "vscode";

export function setEditor(editor: Editor): void {
	current = editor;
}

export function currentEditor(): Editor {
	return current;
}

/**
 * Which editor Beans runs in, from vscode.env.uriScheme: Eclipse Theia
 * registers "theia", and VS Code and its forks their own scheme.
 */
export function editorOf(uriScheme: string): Editor {
	return uriScheme === "theia" ? "theia" : "vscode";
}
