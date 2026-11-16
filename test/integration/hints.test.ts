import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { scrollChannelText, type ScrollRequest } from "../../src/requests";
import type { Editor as EditorKind, ResolveResult } from "../../src/shared/types";
import { EDITOR_KIND, KEYS, startEditor, type Editor, type Key } from "./start-editor";

const WORKSPACE = path.join(import.meta.dirname, "workspace");

// What the tests look for in each editor's page. These are written out here
// rather than taken from src/page/selectors.ts, so a selector Beans gets
// wrong fails the test instead of passing along with it.
const DOM = {
	vscode: {
		name: "VS Code",
		row: ".monaco-list-row",
		rowName: ".monaco-icon-name-container",
		header: ".pane-header",
		headerTitle: ".title",
		// A collapsed view to expand: VS Code's Explorer shows Outline collapsed.
		view: "Outline",
		headerExpanded: (header: string) => `${header}?.getAttribute("aria-expanded") === "true"`,
		tabName: ".tabs-container .tab .label-name",
		paletteRow: ".quick-input-widget .monaco-list-row",
		// What the palette's list moves by style.top as it scrolls.
		paletteRows: ".quick-input-widget .monaco-list-rows",
		sidebarItems: ".part.sidebar :is(.monaco-list-row, .pane-header)[data-beans-hint]",
		// An editor split, and in it a text editor and the lines it moves by
		// style.top as it scrolls.
		editorSplit: ".editor-group-container",
		textEditor: ".monaco-editor",
		editorLines: ".monaco-editor .lines-content",
		editorLine: ".monaco-editor .view-line",
		// The Activity Bar button that shows a view container, and the
		// container's id.
		containers: {
			Explorer: { button: '.part.activitybar .action-label[aria-label^="Explorer"]', id: "workbench.view.explorer" },
			Extensions: {
				button: '.part.activitybar .action-label[aria-label^="Extensions"]',
				id: "workbench.view.extensions",
			},
		},
	},
	theia: {
		name: "Theia",
		row: "#files .theia-TreeNode",
		rowName: ".theia-TreeNodeSegmentGrow",
		header: ".theia-view-container-part-header",
		headerTitle: ".label",
		// Theia's Explorer shows Open Editors collapsed.
		view: "Open Editors",
		// A view is open when its part is taller than its header: the
		// size on screen, not the collapsed class Beans itself reads.
		headerExpanded: (header: string) => `${header}?.parentElement.offsetHeight > ${header}?.offsetHeight`,
		tabName: "#theia-main-content-panel .lm-TabBar-tab .lm-TabBar-tabLabel",
		paletteRow: ".quick-input-widget .monaco-list-row",
		paletteRows: ".quick-input-widget .monaco-list-rows",
		sidebarItems: "#theia-left-side-panel :is(.theia-TreeNode, .theia-view-container-part-header)[data-beans-hint]",
		// The editor shown in each split of the main area.
		editorSplit: "#theia-main-content-panel > .lm-DockPanel-widget:not(.lm-mod-hidden)",
		textEditor: ".monaco-editor",
		editorLines: ".monaco-editor .lines-content",
		editorLine: ".monaco-editor .view-line",
		containers: {
			Explorer: { button: "#shell-tab-explorer-view-container", id: "explorer-view-container" },
			Extensions: { button: "#shell-tab-vsx-extensions-view-container", id: "vsx-extensions-view-container" },
		},
	},
} satisfies Record<EditorKind, unknown>;
const dom = DOM[EDITOR_KIND];

// Expressions the tests evaluate in the workbench page.
const findRow = (name: string) =>
	`[...document.querySelectorAll(${JSON.stringify(dom.row)})]
		.find((row) => row.querySelector(${JSON.stringify(dom.rowName)})?.textContent?.trim() === ${JSON.stringify(name)})`;
const rowHint = (name: string) => `(${findRow(name)})?.getAttribute("data-beans-hint") ?? null`;
const hasRow = (name: string) => `!!(${findRow(name)})`;
const findHeader = (title: string) =>
	`[...document.querySelectorAll(${JSON.stringify(dom.header)})]
		.find((header) => header.querySelector(${JSON.stringify(dom.headerTitle)})?.textContent?.trim().toLowerCase() === ${JSON.stringify(title.toLowerCase())})`;
const headerHint = (title: string) => `(${findHeader(title)})?.getAttribute("data-beans-hint") ?? null`;
const headerExpanded = (title: string) => dom.headerExpanded(`(${findHeader(title)})`);
const tabOpen = (name: string) =>
	`[...document.querySelectorAll(${JSON.stringify(dom.tabName)})].some((label) => label.textContent?.trim() === ${JSON.stringify(name)})`;
// The hint of the primary sidebar's top row or view header.
const topSidebarHint = `[...document.querySelectorAll(${JSON.stringify(dom.sidebarItems)})]
	.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0]
	?.getAttribute("data-beans-hint") ?? null`;
const target = (hint: string) => `{ items: [{ hint: ${JSON.stringify(hint)} }] }`;
// The editor splits on screen, left to right.
const editorSplits = `[...document.querySelectorAll(${JSON.stringify(dom.editorSplit)})]
	.filter((split) => split.getBoundingClientRect().width > 0)
	.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)`;
// How far each split's text editor is scrolled, in pixels: the editor moves
// its lines up by style.top.
const splitScrolls = `(${editorSplits}).map((split) =>
	-parseFloat(split.querySelector(${JSON.stringify(dom.editorLines)})?.style.top || "0"))`;

describe(`Beans in a real ${dom.name}`, () => {
	let editor: Editor;

	beforeAll(async () => {
		editor = await startEditor(WORKSPACE);
	});

	afterAll(async () => {
		await editor?.close();
	});

	it("hints the Explorer's rows and the view headers", async () => {
		// Theia's tree adds its rows over a few frames after the first one shows.
		for (const name of ["dir", "a.txt", "b.txt"]) {
			expect(await editor.waitFor<string>(rowHint(name), `the ${name} row`)).toMatch(/^[a-z]+$/);
		}
		expect(await editor.waitFor<string>(headerHint(dom.view), `the ${dom.view} header`)).toMatch(/^[a-z]+$/);
	});

	it("resolves a hint to its file", async () => {
		const hint = await editor.waitFor<string>(rowHint("a.txt"), "the a.txt row");
		const result = await editor.evaluate<ResolveResult>(`window.__beans.resolve(${target(hint)})`);
		expect(result.missing).toEqual([]);
		expect(result.skipped).toEqual([]);
		expect(result.items).toHaveLength(1);
		expect(result.items[0]).toMatchObject({ hint, isFolder: false, view: "explorer" });
		expect(result.items[0]?.path).toMatch(/[\\/]a\.txt$/);
	});

	it("expands and collapses a folder", async () => {
		const hint = await editor.waitFor<string>(rowHint("dir"), "the dir row");
		await editor.evaluate(`window.__beans.setExpanded(${target(hint)}, true)`);
		await editor.waitFor(hasRow("c.txt"), "the folder's files to show");
		expect(await editor.evaluate<boolean>(hasRow("d.txt"))).toBe(true);

		const again = await editor.waitFor<string>(rowHint("dir"), "the dir row");
		await editor.evaluate(`window.__beans.setExpanded(${target(again)}, false)`);
		await editor.waitFor(`!(${hasRow("c.txt")})`, "the folder's files to hide");
		expect(await editor.evaluate<boolean>(hasRow("d.txt"))).toBe(false);
	});

	it("expands and collapses a view header", async () => {
		const hint = await editor.waitFor<string>(headerHint(dom.view), `the ${dom.view} header`);
		await editor.evaluate(`window.__beans.setExpanded(${target(hint)}, true)`);
		await editor.waitFor(headerExpanded(dom.view), `${dom.view} to expand`);
		expect(await editor.evaluate<boolean>(headerExpanded(dom.view))).toBe(true);

		const again = await editor.waitFor<string>(headerHint(dom.view), `the ${dom.view} header`);
		await editor.evaluate(`window.__beans.setExpanded(${target(again)}, false)`);
		await editor.waitFor(`!(${headerExpanded(dom.view)})`, `${dom.view} to collapse`);
		expect(await editor.evaluate<boolean>(headerExpanded(dom.view))).toBe(false);
	});

	it("numbers the Command Palette and runs Beans: Toggle hints from it", async () => {
		const paletteHints = `[...document.querySelectorAll(${JSON.stringify(`${dom.paletteRow}[data-beans-hint]`)})]
			.map((row) => row.getAttribute("data-beans-hint"))`;
		await editor.press(KEYS.F1);
		await editor.waitFor(`(${paletteHints}).length > 0`, "the Command Palette's rows to get hints");
		expect((await editor.evaluate<string[]>(paletteHints)).slice(0, 3)).toEqual(["1", "2", "3"]);

		await editor.type("Beans: Toggle hints");
		await editor.press(KEYS.Enter);
		await editor.waitFor(`document.body.classList.contains("beans-hidden")`, "the hints to hide");

		await editor.press(KEYS.F1);
		await editor.type("Beans: Toggle hints");
		await editor.press(KEYS.Enter);
		await editor.waitFor(`!document.body.classList.contains("beans-hidden")`, "the hints to show again");
	});

	it("opens a file with beans.pick", async () => {
		const hint = await editor.waitFor<string>(rowHint("b.txt"), "the b.txt row");
		// A keybinding carries the arguments a Talon command would. The editor
		// reloads its keybindings file by itself, so press until it has.
		editor.setKeybindings([{ key: "ctrl+alt+9", command: "beans.pick", args: hint }]);
		let opened = false;
		for (let attempt = 0; attempt < 5 && !opened; attempt++) {
			await editor.press({ key: "9", code: "Digit9", keyCode: 57, ctrl: true, alt: true });
			opened = await editor.waitFor(tabOpen("b.txt"), "b.txt to open", 3000).then(
				() => true,
				() => false,
			);
		}
		expect(opened).toBe(true);
	});

	it("keeps a row's letter with beans.stableHints", async () => {
		// A changed setting injects the script again, which sets this.
		editor.setSettings({ "beans.stableHints": true });
		await editor.waitFor("window.__beansStableHints === true", "the stable hints script");
		try {
			const before = await hintsOf(["a.txt", "b.txt"]);
			const dir = await editor.waitFor<string>(rowHint("dir"), "the dir row");
			await setDirExpanded(dir, true);
			// Positional hints would move a.txt and b.txt down past c.txt and d.txt.
			expect(await hintsOf(["a.txt", "b.txt"])).toEqual(before);
			const added = await hintsOf(["c.txt", "d.txt"]);
			expect(new Set([dir, ...before, ...added]).size).toBe(5);

			await setDirExpanded(dir, false);
			await setDirExpanded(dir, true);
			expect(await hintsOf(["c.txt", "d.txt"])).toEqual(added);
		} finally {
			editor.setSettings({});
			await editor.waitFor("window.__beansStableHints === false", "the positional hints script");
		}
	});

	// Positional hints put "a" on top too: this checks that with stable hints,
	// the letters of the view switched away from don't stay taken.
	it("forgets the letters of a view container that's switched away with beans.stableHints", async () => {
		editor.setSettings({ "beans.stableHints": true });
		await editor.waitFor("window.__beansStableHints === true", "the stable hints script");
		try {
			await showContainer("Extensions");
			expect(await editor.evaluate<string | null>(topSidebarHint)).toBe("a");
			await showContainer("Explorer");
			expect(await editor.evaluate<string | null>(topSidebarHint)).toBe("a");
		} finally {
			editor.setSettings({});
			await editor.waitFor("window.__beansStableHints === false", "the positional hints script");
		}
	});

	// Switches the primary sidebar with its Activity Bar button, then waits
	// for Beans to relabel.
	async function showContainer(name: keyof typeof dom.containers): Promise<void> {
		const { button, id } = dom.containers[name];
		await editor.click(button);
		await editor.waitFor(`document.getElementById(${JSON.stringify(id)})?.offsetParent != null`, `${name} to show`);
		await editor.evaluate("new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))");
	}

	async function hintsOf(names: string[]): Promise<(string | null)[]> {
		return Promise.all(names.map((name) => editor.evaluate<string | null>(rowHint(name))));
	}

	// Expands or collapses dir, then waits for Beans to relabel. VS Code reuses
	// row elements it took off screen, along with the hints they had, so a row
	// can show an old hint until the next frame.
	async function setDirExpanded(hint: string, expanded: boolean): Promise<void> {
		await editor.evaluate(`window.__beans.setExpanded(${target(hint)}, ${expanded})`);
		const shown = expanded ? hasRow("d.txt") : `!(${hasRow("d.txt")})`;
		await editor.waitFor(shown, expanded ? "the folder's files to show" : "the folder's files to hide");
		await editor.evaluate("new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))");
	}

	it("scrolls the focused document most of a screen with beans.scroll", async () => {
		await openOnly(editor, "long.txt");
		await markFocus(editor);
		const before = await editor.evaluate<number[]>(splitScrolls);
		expect(before).toHaveLength(1);

		await editor.press(SCROLL_KEY);
		const after = await settledScrolls(editor, before);
		const { height, lineHeight } = await editor.evaluate<EditorSize>(editorSize);
		// 80% of the editor, in whole lines.
		const moved = (after[0] ?? 0) - (before[0] ?? 0);
		expect(moved).toBeGreaterThan(0.8 * height - lineHeight - 1);
		expect(moved).toBeLessThan(0.8 * height + 1);
		expect(await focusKept(editor)).toBe(true);
	});

	it("scrolls the document most of a screen with editor.smoothScrolling", async () => {
		editor.setSettings({ "editor.smoothScrolling": true });
		try {
			await openOnly(editor, "long.txt");
			// Nothing on the page says the setting has arrived; the editor reads
			// its settings file within a moment.
			await new Promise((resolve) => setTimeout(resolve, 2000));
			const { height, lineHeight } = await editor.evaluate<EditorSize>(editorSize);
			// A few in a row, since Monaco only takes a run of wheel events for
			// a mouse's, and smooths those.
			for (let scroll = 0; scroll < 3; scroll++) {
				const before = await editor.evaluate<number[]>(splitScrolls);
				await editor.press(SCROLL_KEY);
				const after = await settledScrolls(editor, before);
				const moved = (after[0] ?? 0) - (before[0] ?? 0);
				expect(moved, `scroll ${scroll + 1}`).toBeGreaterThan(0.8 * height - lineHeight - 1);
				expect(moved, `scroll ${scroll + 1}`).toBeLessThan(0.8 * height + 1);
			}
		} finally {
			editor.setSettings({});
		}
	});

	it("scrolls the left and right splits without moving the focus", async () => {
		await openOnly(editor, "long.txt");
		await pressUntil(editor, SPLIT_KEY, `(${splitScrolls}).length === 2`, "the editor to split");
		await editor.waitFor(
			`(${editorSplits}).every((split) => split.querySelector(${JSON.stringify(dom.editorLine)}))`,
			"both splits to show their lines",
		);
		await markFocus(editor);
		for (const [side, index] of [
			["left", 0],
			["right", 1],
		] as const) {
			const before = await editor.evaluate<number[]>(splitScrolls);
			await sendScroll(editor, { direction: "down", hint: "", place: side });
			const after = await settledScrolls(editor, before);
			expect(after[index], `the ${side} split`).toBeGreaterThan(before[index] ?? 0);
			expect(after[1 - index], `the split that isn't ${side}`).toBe(before[1 - index]);
		}
		expect(await focusKept(editor)).toBe(true);
	});

	it("scrolls the Command Palette, not the document, while it's open, even for a split", async () => {
		await openOnly(editor, "long.txt");
		// "|| 0" turns -0, which the page can't send back as a value, into 0.
		const paletteScroll = `(-parseFloat(document.querySelector(${JSON.stringify(dom.paletteRows)})?.style.top || "0") || 0)`;
		await editor.press(KEYS.F1);
		await editor.waitFor(`document.querySelectorAll(${JSON.stringify(dom.paletteRow)}).length > 5`, "the palette");
		try {
			const documentScroll = await editor.evaluate<number[]>(splitScrolls);
			// The palette keeps keys to itself, so this sends what Talon's
			// "downer" and "downer left" do.
			for (const place of ["document", "left"] as const) {
				const palette = await editor.evaluate<number>(paletteScroll);
				await sendScroll(editor, { direction: "down", hint: "", place });
				await editor.waitFor(`${paletteScroll} > ${palette}`, `the palette to scroll for "${place}"`);
				expect(await editor.evaluate<number[]>(splitScrolls), `the document after "${place}"`).toEqual(documentScroll);
			}
		} finally {
			await editor.press(KEYS.Escape);
		}
	});
});

// A file long enough that Monaco shifts its lines back past each 500,000px
// (see scrollBy in src/page/scroll.ts). With 18px lines and the room to
// scroll the last line to the top, the bottom is 2,000,016px down: just
// past a shift, so a page up from there crosses it. 18 doesn't divide
// 500,000, so the shift isn't a round number there: 1,499,994px below it,
// 1,999,998px past it.
const LONG_FILE_LINES = 111_113;

describe(`Beans in a real ${dom.name}, in a file of ${LONG_FILE_LINES} lines`, () => {
	let editor: Editor;
	let workspace: string;

	beforeAll(async () => {
		workspace = fs.mkdtempSync(path.join(os.tmpdir(), "beans-long-"));
		const lines = Array.from({ length: LONG_FILE_LINES }, (_, index) => `Line ${index + 1}`);
		// No newline at the end, so the last line has text to look for.
		fs.writeFileSync(path.join(workspace, "huge.txt"), lines.join("\n"));
		editor = await startEditor(workspace);
		editor.setSettings({ "editor.lineHeight": 18, "editor.scrollBeyondLastLine": true });
	});

	afterAll(async () => {
		await editor?.close();
		if (workspace) fs.rmSync(workspace, { recursive: true, force: true });
	});

	it("reaches the last and the first line, and moves 80% of a screen deep in the file", async () => {
		await openOnly(editor, "huge.txt");
		await editor.waitFor(`${editorSize}.lineHeight === 18`, "the 18px lines setting");
		const { height, lineHeight } = await editor.evaluate<EditorSize>(editorSize);
		const page = Math.floor((0.8 * height) / lineHeight);

		await sendScroll(editor, { direction: "bottom", hint: "", place: "document" });
		await editor.waitFor(lineShown(LONG_FILE_LINES), "the last line");
		const bottom = await settledTopLine(editor);
		const cut = await editor.evaluate<number>(topLineCut);

		// Both cross the shift, and move whole lines: the top line is cut as before.
		await sendScroll(editor, { direction: "up", hint: "", place: "document" });
		const up = await settledTopLine(editor, bottom);
		expect(bottom - up, `${bottom} up to ${up}`).toBe(page);
		expect(await editor.evaluate<number>(topLineCut), "the top line's cut after a page up").toBeCloseTo(cut, 0);

		await sendScroll(editor, { direction: "down", hint: "", place: "document" });
		const down = await settledTopLine(editor, up);
		expect(down - up, `${up} down to ${down}`).toBe(page);
		expect(await editor.evaluate<number>(topLineCut), "the top line's cut after a page down").toBeCloseTo(cut, 0);

		await sendScroll(editor, { direction: "top", hint: "", place: "document" });
		await editor.waitFor(lineShown(1), "the first line");
	});
});

const SCROLL_KEY = { key: "8", code: "Digit8", keyCode: 56, ctrl: true, alt: true };
const SPLIT_KEY = { key: "7", code: "Digit7", keyCode: 55, ctrl: true, alt: true };
const CLOSE_KEY = { key: "6", code: "Digit6", keyCode: 54, ctrl: true, alt: true };
const PICK_KEY = { key: "9", code: "Digit9", keyCode: 57, ctrl: true, alt: true };

interface EditorSize {
	height: number;
	lineHeight: number;
}

// The height of the text editor, and of one line.
const editorSize = `({
	height: document.querySelector(${JSON.stringify(dom.textEditor)}).getBoundingClientRect().height,
	lineHeight: document.querySelector(${JSON.stringify(dom.editorLine)}).getBoundingClientRect().height,
})`;

// The number of the first line wholly in sight, from its text, "Line 12".
// Monaco draws spaces as no-break spaces, so this reads only the digits.
const topLine = `(() => {
	const top = document.querySelector(${JSON.stringify(dom.textEditor)}).getBoundingClientRect().top;
	const lines = [...document.querySelectorAll(${JSON.stringify(dom.editorLine)})]
		.map((line) => ({ top: line.getBoundingClientRect().top, number: Number(/\\d+/.exec(line.textContent)?.[0] ?? 0) }))
		.filter((line) => line.top >= top - 1)
		.sort((a, b) => a.top - b.top);
	return lines[0]?.number ?? 0;
})()`;

const lineShown = (number: number) =>
	`[...document.querySelectorAll(${JSON.stringify(dom.editorLine)})].some((line) => /\\d+/.exec(line.textContent)?.[0] === ${JSON.stringify(String(number))})`;

// How much of the line at the top of the editor is cut off, in pixels.
const topLineCut = `(() => {
	const top = document.querySelector(${JSON.stringify(dom.textEditor)}).getBoundingClientRect().top;
	const line = [...document.querySelectorAll(${JSON.stringify(dom.editorLine)})]
		.map((element) => element.getBoundingClientRect())
		.find((box) => box.top <= top && top < box.bottom);
	return line ? top - line.top : 0;
})()`;

/**
 * Closes every editor, then opens this file of the workspace from its
 * Explorer row, with the keybindings the scroll tests press.
 */
async function openOnly(editor: Editor, name: string): Promise<void> {
	const hint = await editor.waitFor<string>(rowHint(name), `the ${name} row`);
	editor.setKeybindings([
		{ key: "ctrl+alt+9", command: "beans.pick", args: hint },
		{ key: "ctrl+alt+8", command: "beans.scroll", args: "down" },
		{ key: "ctrl+alt+7", command: "workbench.action.splitEditorRight" },
		{ key: "ctrl+alt+6", command: "workbench.action.closeAllEditors" },
	]);
	await pressUntil(
		editor,
		CLOSE_KEY,
		`!document.querySelector(${JSON.stringify(`${dom.editorSplit} ${dom.editorLine}`)})`,
		"the editors to close",
	);
	await pressUntil(
		editor,
		PICK_KEY,
		`${tabOpen(name)} && !!document.querySelector(${JSON.stringify(`${dom.editorSplit} ${dom.editorLine}`)})`,
		`${name} to open`,
	);
}

// Presses a key until the page shows what it should. The editor reloads
// its keybindings file by itself, a moment after it changes.
async function pressUntil(editor: Editor, key: Key, expression: string, what: string): Promise<void> {
	for (let attempt = 0; attempt < 5; attempt++) {
		await editor.press(key);
		const done = await editor.waitFor(expression, what, 3000).then(
			() => true,
			() => false,
		);
		if (done) return;
	}
	throw new Error(`Timed out waiting for ${what}`);
}

// Sends a scroll request through the status bar channel, in the text the
// extension writes there: a keybinding passes one argument, and
// beans.scroll takes where to scroll as its third. Only the text changes,
// so the editor can still show the extension's next request.
async function sendScroll(editor: Editor, request: ScrollRequest): Promise<void> {
	await editor.evaluate(`(() => {
		const channel = document.getElementById(window.__beansChannelId);
		const walker = document.createTreeWalker(channel, NodeFilter.SHOW_TEXT);
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			if (node.data.includes("beans:")) node.data = "beans:" + Date.now() + ":scroll:" + ${JSON.stringify(scrollChannelText(request))};
		}
	})()`);
}

// Waits for the splits' scroll positions to change from these and stop
// changing: Beans corrects its first wheel event on the next frame.
async function settledScrolls(editor: Editor, before: number[]): Promise<number[]> {
	await editor.waitFor(`JSON.stringify(${splitScrolls}) !== ${JSON.stringify(JSON.stringify(before))}`, "a scroll");
	return settled(editor, splitScrolls);
}

// The same for the first line in sight, which tells the scroll position in
// a file of any length.
async function settledTopLine(editor: Editor, before?: number): Promise<number> {
	if (before !== undefined) await editor.waitFor(`${topLine} !== ${before}`, "a scroll");
	return settled(editor, topLine);
}

async function settled<T>(editor: Editor, expression: string): Promise<T> {
	let last = await editor.evaluate<T>(expression);
	for (let still = 0; still < 3;) {
		await new Promise((resolve) => setTimeout(resolve, 100));
		const now = await editor.evaluate<T>(expression);
		still = JSON.stringify(now) === JSON.stringify(last) ? still + 1 : 0;
		last = now;
	}
	return last;
}

async function markFocus(editor: Editor): Promise<void> {
	await editor.evaluate("window.__beansTestFocus = document.activeElement, true");
}

async function focusKept(editor: Editor): Promise<boolean> {
	return editor.evaluate<boolean>("document.activeElement === window.__beansTestFocus");
}
