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

	it("scrolls the document most of a screen with editor.smoothScrolling, after a mouse wheel", async (context) => {
		editor.setSettings({ "editor.smoothScrolling": true });
		try {
			await openOnly(editor, "long.txt");
			await scrollAndSettle(editor, { direction: "top", hint: "", place: "document" });
			// Monaco animates a wheel event once a run of them looks like a
			// mouse's: whole notches, all alike. Those notches show both that the
			// setting has arrived and that Monaco is smoothing. VS Code 1.90
			// doesn't smooth these synthetic notches, so there's nothing to test.
			const smoothing = await editor.waitFor(mouseWheelAnimates, "the editor to smooth a mouse wheel", 15_000).then(
				() => true,
				() => false,
			);
			if (!smoothing) context.skip("the editor doesn't smooth a synthetic mouse wheel");
			const { height, lineHeight } = await editor.evaluate<EditorSize>(editorSize);
			const before = await settledScroll(editor);
			const cut = await editor.evaluate<number>(topLineCut);
			await scrollAndSettle(editor, { direction: "down", hint: "", place: "document" });
			expect((await settledScroll(editor)) - before).toBe(pagePixels(height, lineHeight));
			expect(await editor.evaluate<number>(topLineCut), "the top line's cut").toBeCloseTo(cut, 0);
		} finally {
			editor.setSettings({});
		}
	});

	it("moves two pages for two scrolls said close together", async () => {
		await openOnly(editor, "long.txt");
		await scrollAndSettle(editor, { direction: "top", hint: "", place: "document" });
		const { height, lineHeight } = await editor.evaluate<EditorSize>(editorSize);
		// The second arrives while the first is still lining up its lines.
		await sendScroll(editor, { direction: "down", hint: "", place: "document" });
		await new Promise((resolve) => setTimeout(resolve, 50));
		await scrollAndSettle(editor, { direction: "down", hint: "", place: "document" });
		expect(await settledScroll(editor)).toBe(2 * pagePixels(height, lineHeight));
	});

	it("stops at the top, with the first line whole, from a start that isn't whole lines", async () => {
		await openOnly(editor, "long.txt");
		await scrollAndSettle(editor, { direction: "top", hint: "", place: "document" });
		await nudgeOffLines(editor, 1);

		await scrollAndSettle(editor, { direction: "up", hint: "", place: "document" });
		expect(await settledScroll(editor)).toBe(0);
	});

	it("stops at the end, with the last line in sight, without editor.scrollBeyondLastLine", async () => {
		editor.setSettings({ "editor.scrollBeyondLastLine": false });
		try {
			await openOnly(editor, "long.txt");
			// The setting has arrived when the bottom shows a screenful, not only the last line.
			let screenful = false;
			for (let attempt = 0; attempt < 10 && !screenful; attempt++) {
				await scrollAndSettle(editor, { direction: "bottom", hint: "", place: "document" });
				screenful = await editor.evaluate<boolean>(`(${lastLineInSight}) && (${topLine}) < ${LONG_TXT_LINES - 5}`);
			}
			expect(screenful, "the end to show a screenful").toBe(true);
			const end = await settledScroll(editor);
			await nudgeOffLines(editor, -1);

			await scrollAndSettle(editor, { direction: "down", hint: "", place: "document" });
			expect(await settledScroll(editor)).toBe(end);
			expect(await editor.evaluate<boolean>(lastLineInSight)).toBe(true);
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

// Files long enough that Monaco shifts its lines back past each 500,000px
// (see scrollBy in src/page/scroll.ts). 18px lines don't divide 500,000,
// so the shift isn't a round number: 1,499,994px below 2,000,000px,
// 1,999,998px past it. With the room to scroll the last line to the top,
// huge.txt's bottom is 2,003,004px down, more than a page past the shift,
// and edge.txt's 2,000,016px, just past it.
const HUGE_LINES = 111_279;
const EDGE_LINES = 111_113;
const SHIFT_AT_LINE = 2_000_000 / 18 + 1;

describe(`Beans in a real ${dom.name}, in files of over ${EDGE_LINES} lines`, () => {
	let editor: Editor;
	let workspace: string;

	beforeAll(async () => {
		workspace = fs.mkdtempSync(path.join(os.tmpdir(), "beans-long-"));
		for (const [name, count] of [
			["huge.txt", HUGE_LINES],
			["edge.txt", EDGE_LINES],
		] as const) {
			const lines = Array.from({ length: count }, (_, index) => `Line ${index + 1}`);
			// No newline at the end, so the last line has text to look for.
			fs.writeFileSync(path.join(workspace, name), lines.join("\n"));
		}
		editor = await startEditor(workspace);
		editor.setSettings({ "editor.lineHeight": 18, "editor.scrollBeyondLastLine": true });
	});

	afterAll(async () => {
		await editor?.close();
		if (workspace) fs.rmSync(workspace, { recursive: true, force: true });
	});

	it("reaches the last and the first line, and moves 80% of a screen, in whole lines, across the shift", async () => {
		await openOnly(editor, "huge.txt");
		await editor.waitFor(`${editorSize}.lineHeight === 18`, "the 18px lines setting");
		const { height, lineHeight } = await editor.evaluate<EditorSize>(editorSize);
		const page = pagePixels(height, lineHeight) / lineHeight;

		await sendScroll(editor, { direction: "bottom", hint: "", place: "document" });
		await editor.waitFor(lineShown(HUGE_LINES), "the last line");
		let line = await settledTopLine(editor);
		const cut = await editor.evaluate<number>(topLineCut);

		// Up a page at a time until one crosses the shift, then down across it
		// again, a page short of the bottom so the end doesn't stop it.
		while (line >= SHIFT_AT_LINE) {
			await sendScroll(editor, { direction: "up", hint: "", place: "document" });
			const up = await settledTopLine(editor, line);
			expect(line - up, `${line} up to ${up}`).toBe(page);
			expect(await editor.evaluate<number>(topLineCut), `the top line's cut at ${up}`).toBeCloseTo(cut, 0);
			line = up;
		}
		await sendScroll(editor, { direction: "down", hint: "", place: "document" });
		const down = await settledTopLine(editor, line);
		expect(down - line, `${line} down to ${down}`).toBe(page);
		expect(await editor.evaluate<number>(topLineCut), "the top line's cut after a page down").toBeCloseTo(cut, 0);

		await sendScroll(editor, { direction: "top", hint: "", place: "document" });
		await editor.waitFor(lineShown(1), "the first line");
	});

	it("stops at the end when a page down crosses the shift and reaches it", async () => {
		await openOnly(editor, "edge.txt");
		await editor.waitFor(`${editorSize}.lineHeight === 18`, "the 18px lines setting");
		await sendScroll(editor, { direction: "bottom", hint: "", place: "document" });
		await editor.waitFor(lineShown(EDGE_LINES), "the last line");
		const bottom = await settledTopLine(editor);
		await sendScroll(editor, { direction: "up", hint: "", place: "document" });
		await settledTopLine(editor, bottom);
		// A page up from the bottom leaves the view just a page above it, below
		// the shift. One mouse notch down from there: not a whole number of
		// lines, still below the shift, and less than a page from the bottom,
		// so the page down crosses the shift and the end stops it.
		await nudge(editor, 1);
		await settledTopLine(editor);

		await scrollAndSettle(editor, { direction: "down", hint: "", place: "document" });
		expect(await settledTopLine(editor)).toBe(EDGE_LINES);
		expect(await editor.evaluate<number>(topLineCut)).toBeCloseTo(0, 0);
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

// The lines in long.txt.
const LONG_TXT_LINES = 400;

// How far a page moves a text editor this tall: 80% of it, in whole lines.
function pagePixels(height: number, lineHeight: number): number {
	return Math.floor((0.8 * height) / lineHeight) * lineHeight;
}

// The first text editor's lines, which move by style.top as it scrolls.
const shownLines = `document.querySelector(${JSON.stringify(`${dom.editorSplit} ${dom.editorLines}`)})`;

// A mouse wheel's notches: deltaY 120 a notch, down for a positive count.
// A synthetic event reads with the opposite sign of a real one (see
// scrollBy in src/page/scroll.ts).
const wheelNotches = (notches: number) =>
	`${shownLines}.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, view: window, deltaY: ${-120 * notches}, deltaMode: 0 }))`;

async function nudge(editor: Editor, notches: number): Promise<void> {
	await editor.evaluate(wheelNotches(notches));
}

/**
 * Turns the wheel a notch at a time, as a mouse would, until the view is a
 * few pixels short of half a line past whole lines from where it was: a
 * start that a scroll which lines up the top line wrongly would pull away
 * from an end.
 */
async function nudgeOffLines(editor: Editor, notches: 1 | -1): Promise<void> {
	const { lineHeight } = await editor.evaluate<EditorSize>(editorSize);
	const from = await settledScroll(editor);
	for (let notch = 0; notch < 10; notch++) {
		await nudge(editor, notches);
		const off = Math.abs((await settledScroll(editor)) - from) % lineHeight;
		if (off > 1 && off < lineHeight / 2 - 1) return;
	}
	throw new Error("the wheel never left the view a part of a line from where it was");
}

// Turns a few notches up and down, then whether a last one down moved the
// lines over several frames, as a smoothed scroll does, rather than at once.
const mouseWheelAnimates = `(async () => {
	const frame = () => new Promise((done) => requestAnimationFrame(done));
	for (const notches of [-1, 1, -1]) {
		${shownLines}.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, view: window, deltaY: -120 * notches, deltaMode: 0 }));
		for (let wait = 0; wait < 15; wait++) await frame();
	}
	${wheelNotches(1)};
	const seen = new Set();
	for (let wait = 0; wait < 12; wait++) {
		await frame();
		seen.add(${shownLines}.style.top);
	}
	return seen.size > 2;
})()`;

// Whether the last line of the file is wholly in sight.
const lastLineInSight = `(() => {
	const box = document.querySelector(${JSON.stringify(dom.textEditor)}).getBoundingClientRect();
	const last = [...document.querySelectorAll(${JSON.stringify(dom.editorLine)})].find((line) => /\\d+/.exec(line.textContent)?.[0] === ${JSON.stringify(String(LONG_TXT_LINES))});
	const lineBox = last?.getBoundingClientRect();
	return !!lineBox && lineBox.top >= box.top && lineBox.bottom <= box.bottom + 0.5;
})()`;

// Sends a scroll, then waits for the lines to stop moving, whether or not
// they moved: at an end they don't.
async function scrollAndSettle(editor: Editor, request: ScrollRequest): Promise<void> {
	await sendScroll(editor, request);
	await new Promise((resolve) => setTimeout(resolve, 300));
	await settledScroll(editor);
}

// The first split's scroll position, once it has stopped changing.
async function settledScroll(editor: Editor): Promise<number> {
	return (await settled<number[]>(editor, splitScrolls))[0] ?? 0;
}

async function markFocus(editor: Editor): Promise<void> {
	await editor.evaluate("window.__beansTestFocus = document.activeElement, true");
}

async function focusKept(editor: Editor): Promise<boolean> {
	return editor.evaluate<boolean>("document.activeElement === window.__beansTestFocus");
}
