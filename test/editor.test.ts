import { expect, test } from "vite-plus/test";
import { editorOf } from "../src/editor";

test("tells Theia from VS Code and its forks by the URI scheme", () => {
	expect(editorOf("theia")).toBe("theia");
	expect(editorOf("vscode")).toBe("vscode");
	expect(editorOf("vscode-insiders")).toBe("vscode");
	expect(editorOf("vscodium")).toBe("vscode");
});
