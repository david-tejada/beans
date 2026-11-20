import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { scrollChannelText, type ScrollRequest } from "../../src/requests";
import type { Editor as EditorKind, ResolveResult } from "../../src/shared/types";
import { EDITOR_KIND, KEYS, startEditor, type Editor, type Key, type Keybinding } from "./start-editor";

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
		// A split of the editor area, the one with focus, and a tab in it, with
		// its file's name. Theia has no tab hints yet.
		tabs: {
			group: ".editor-group-container",
			activeGroup: ".editor-group-container.active",
			tab: ".editor-group-container .tabs-container > .tab",
			activeTab: ".tabs-container > .tab.active",
			name: ".label-name",
			// A preview tab's label, in italics.
			preview: ".tab-label.italic",
			// The strip's box, as wide as the part of it on screen.
			strip: ".editor-group-container .tabs-container",
		},
		// An editor split, and in it a text editor and the lines it moves by
		// style.top as it scrolls.
		editorSplit: ".editor-group-container",
		textEditor: ".monaco-editor",
		editorLines: ".monaco-editor .lines-content",
		editorLine: ".monaco-editor .view-line",
		// An Explorer file's row, to click, and a selected row.
		fileRow: (name: string) => `.explorer-folders-view .monaco-list-row[aria-label=${JSON.stringify(name)}]`,
		selectedRow: ".monaco-list-row.selected",
		// What has the focus while typing in an editor.
		editorInput: ".monaco-editor .native-edit-context, .monaco-editor textarea",
		// A row in Open Editors, a sidebar list that isn't the Explorer's.
		openEditorsRow: ".open-editors .monaco-list-row",
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
		tabs: null,
		// The editor shown in each split of the main area.
		editorSplit: "#theia-main-content-panel > .lm-DockPanel-widget:not(.lm-mod-hidden)",
		textEditor: ".monaco-editor",
		editorLines: ".monaco-editor .lines-content",
		editorLine: ".monaco-editor .view-line",
		fileRow: (name: string) => `#files .theia-FileStatNode[title$=${JSON.stringify(`/${name}`)}]`,
		selectedRow: ".theia-TreeNode.theia-mod-selected",
		editorInput: ".monaco-editor .native-edit-context, .monaco-editor textarea",
		openEditorsRow: "#theia-open-editors-widget .theia-TreeNode",
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

	it('resolves "this" to the selected rows, and says when none is on screen', async () => {
		await clickUntilSelected("a.txt");
		expect(await namesOfThis()).toEqual({ names: ["a.txt"], missing: [] });

		const b = await fileItem("b.txt");
		await cmdClick([b], true);
		expect(await namesOfThis()).toEqual({ names: ["a.txt", "b.txt"], missing: [] });

		// With the focus in the editor, "this" is still the Explorer's selection.
		// In Theia both rows stay selected only because the test profile turns
		// explorer.autoReveal off: with it on, Theia selects the open file alone.
		await editor.waitFor(`!!document.querySelector(${JSON.stringify(dom.editorInput)})`, "an editor to open");
		await editor.evaluate(`document.querySelector(${JSON.stringify(dom.editorInput)}).focus()`);
		await editor.waitFor(`document.activeElement?.matches(${JSON.stringify(dom.editorInput)})`, "the editor's focus");
		expect(await namesOfThis()).toEqual({ names: ["a.txt", "b.txt"], missing: [] });

		// The first selected row's point, for a right-click.
		const a = await fileItem("a.txt");
		const point = await editor.evaluate<unknown>(`window.__beans.rowPoint("this")`);
		expect(point).not.toBeNull();
		expect(point).toEqual(await editor.evaluate<unknown>(`window.__beans.rowPoint(${JSON.stringify(a.hint)})`));

		// Cmd+click (Ctrl+click) takes a selected row out of the selection.
		await cmdClick([a, b], false);
		expect(await namesOfThis()).toEqual({ names: [], missing: ["this"] });
		expect(await editor.evaluate<unknown>(`window.__beans.rowPoint("this")`)).toBeNull();
	});

	it('resolves "this" alongside hints and as either end of a range', async () => {
		await clickUntilSelected("b.txt");
		const a = await fileItem("a.txt");
		const b = await fileItem("b.txt");
		expect(await namesOf([{ hint: a.hint }, { hint: "this" }])).toEqual(["a.txt", "b.txt"]);
		// b is both said and selected, and shows up once.
		expect(await namesOf([{ hint: b.hint }, { hint: "this" }])).toEqual(["b.txt"]);
		expect(await namesOf([{ from: "this", to: a.hint }])).toEqual(["a.txt", "b.txt"]);
		expect(await namesOf([{ from: a.hint, to: "this" }])).toEqual(["a.txt", "b.txt"]);

		// With a and b selected, a range's end is the first of them.
		await cmdClick([a], true);
		expect(await namesOf([{ hint: b.hint }, { hint: "this" }])).toEqual(["a.txt", "b.txt"]);
		expect(await namesOf([{ from: "this", to: a.hint }])).toEqual(["a.txt"]);
	});

	it('resolves "this" to the selection of the focused list when that isn\'t the Explorer', async () => {
		await clickUntilSelected("a.txt");
		const openEditorsRow = JSON.stringify(dom.openEditorsRow);
		// The hint of the selected Open Editors row, once Beans has hinted it.
		const selectedHint = `[...document.querySelectorAll(${openEditorsRow})]
			.find((row) => row.matches(${JSON.stringify(dom.selectedRow)}) && row.hasAttribute("data-beans-hint"))
			?.getAttribute("data-beans-hint") ?? null`;
		if (EDITOR_KIND === "vscode") {
			// VS Code hides Open Editors; this command shows it and focuses it.
			editor.setKeybindings([{ key: "ctrl+alt+8", command: "workbench.files.action.focusOpenEditorsView" }]);
			let shown = false;
			for (let attempt = 0; attempt < 5 && !shown; attempt++) {
				await editor.press({ key: "8", code: "Digit8", keyCode: 56, ctrl: true, alt: true });
				shown = await editor
					.waitFor(`document.activeElement?.closest(".open-editors") != null`, "Open Editors' focus", 3000)
					.then(
						() => true,
						() => false,
					);
			}
			if (!shown) throw new Error("Open Editors didn't get the focus");
		} else {
			// Theia shows Open Editors collapsed. A click on one of its rows
			// isn't a reliable way to select it: a click that selects also
			// activates that editor, which takes the focus, and with one editor
			// open Theia rebuilds the Open Editors tree on every change to the
			// editor area, with nothing selected but the focus mark kept. Down
			// selects the row after the focused one, so on that lone row it
			// does nothing. Escape clears the focus mark, and Down then selects
			// the first row. Which editors are open here depends on the tests
			// before, so the row is whichever one ends up selected.
			const header = await editor.waitFor<string>(headerHint("Open Editors"), "the Open Editors header");
			await editor.evaluate(`window.__beans.setExpanded(${target(header)}, true)`);
			await editor.waitFor(`!!document.querySelector(${openEditorsRow})`, "a row in Open Editors");
			let selected = false;
			for (let attempt = 0; attempt < 5 && !selected; attempt++) {
				await editor.evaluate(`document.querySelector("#theia-open-editors-widget").focus()`);
				await editor.press(KEYS.Escape);
				await editor.press({ key: "ArrowDown", code: "ArrowDown", keyCode: 40 });
				selected = await editor.waitFor(selectedHint, "a selected row in Open Editors", 2000).then(
					() => true,
					() => false,
				);
			}
			if (!selected) throw new Error("No row in Open Editors got selected from the keyboard");
		}
		const hint = await editor.waitFor<string>(selectedHint, "a selected row in Open Editors to get a hint");
		const result = await editor.evaluate<ResolveResult>(`window.__beans.resolve(${target("this")})`);
		expect({ ...result, items: result.items.map((item) => [item.hint, item.view]) }).toMatchObject({
			items: [[hint, "openEditors"]],
			missing: [],
		});

		if (EDITOR_KIND === "theia") {
			const header = await editor.waitFor<string>(headerHint("Open Editors"), "the Open Editors header");
			await editor.evaluate(`window.__beans.setExpanded(${target(header)}, false)`);
			// Its rows hold letters until it has collapsed, and the Explorer's
			// rows get other letters once they're gone: a test that read a
			// hint before then would pick the wrong row with it.
			await editor.waitFor(`!(${headerExpanded("Open Editors")})`, "Open Editors to collapse");
			await editor.evaluate("new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))");
		} else {
			// Hide Open Editors again: it sits above the files, so its rows
			// would come first for a test that looks a row up by its name.
			editor.setKeybindings([{ key: "ctrl+alt+8", command: "workbench.explorer.openEditorsView.removeView" }]);
			let hidden = false;
			for (let attempt = 0; attempt < 5 && !hidden; attempt++) {
				await editor.press({ key: "8", code: "Digit8", keyCode: 56, ctrl: true, alt: true });
				hidden = await editor
					.waitFor(`!(document.querySelector(".open-editors")?.offsetHeight > 0)`, "Open Editors to hide", 3000)
					.then(
						() => true,
						() => false,
					);
			}
			if (!hidden) throw new Error("Open Editors didn't hide");
		}
	});

	// VS Code only: Cmd+A (Ctrl+A) doesn't select all in Theia's trees.
	it.skipIf(EDITOR_KIND === "theia")("won't delete a selection that runs past the screen", async () => {
		// More files than the Explorer shows, made here rather than kept in the fixture.
		const folder = path.join(WORKSPACE, "many");
		const names = Array.from({ length: 60 }, (_, i) => `m${String(i + 1).padStart(2, "0")}.txt`);
		fs.mkdirSync(folder, { recursive: true });
		for (const name of names) fs.writeFileSync(path.join(folder, name), "");
		try {
			// The folder's row can show before VS Code will expand it, so this
			// expands it again until its files show.
			let expanded = false;
			for (let attempt = 0; attempt < 5 && !expanded; attempt++) {
				const hint = await editor.waitFor<string>(rowHint("many"), "the many folder's row");
				await editor.evaluate(`window.__beans.setExpanded(${target(hint)}, true)`);
				expanded = await editor.waitFor(hasRow("m01.txt"), "the folder's files to show", 3000).then(
					() => true,
					() => false,
				);
			}
			if (!expanded) throw new Error("The many folder didn't expand");
			await clickUntilSelected("m01.txt");
			const mac = process.platform === "darwin";
			// The key can arrive before the list has the focus, so press until it selects.
			let selectedAll = false;
			for (let attempt = 0; attempt < 5 && !selectedAll; attempt++) {
				await editor.press({ key: "a", code: "KeyA", keyCode: 65, meta: mac, ctrl: !mac });
				selectedAll = await editor
					.waitFor(
						`document.querySelectorAll(${JSON.stringify(dom.selectedRow)}).length > 10`,
						"select-all to select the rows",
						2000,
					)
					.then(
						() => true,
						() => false,
					);
				if (!selectedAll) await clickUntilSelected("m01.txt");
			}
			expect(selectedAll).toBe(true);
			const all = await editor.evaluate<ResolveResult>(`window.__beans.resolve(${target("this")})`);
			expect(all.selectionRunsPast).toBe(true);

			// Beans says why it did nothing, so the toast shows the command ran.
			editor.setKeybindings([
				{ key: "ctrl+alt+7", command: "beans.delete", args: { target: { items: [{ hint: "this" }] } } },
			]);
			let refused = false;
			for (let attempt = 0; attempt < 5 && !refused; attempt++) {
				await editor.press({ key: "7", code: "Digit7", keyCode: 55, ctrl: true, alt: true });
				refused = await editor
					.waitFor(`document.body.innerText.includes("Beans did nothing")`, "the refusal", 3000)
					.then(
						() => true,
						() => false,
					);
			}
			expect(refused).toBe(true);
			expect(fs.readdirSync(folder)).toHaveLength(names.length);

			// Two rows in the middle of the screen are all there is.
			await clickUntilSelected("m02.txt");
			await cmdClick([await fileItem("m03.txt")], true);
			const two = await editor.evaluate<ResolveResult>(`window.__beans.resolve(${target("this")})`);
			expect(two.selectionRunsPast).toBe(false);
			expect(two.items.map((item) => path.basename(item.path))).toEqual(["m02.txt", "m03.txt"]);
		} finally {
			fs.rmSync(folder, { recursive: true, force: true });
		}
	});

	// Clicks an Explorer file's row with the mouse until it shows as
	// selected: Theia can miss a click while it's still settling.
	async function clickUntilSelected(name: string): Promise<void> {
		const selected = `!!document.querySelector(${JSON.stringify(dom.fileRow(name))})?.closest(${JSON.stringify(dom.selectedRow)})`;
		for (let attempt = 0; attempt < 5; attempt++) {
			await editor.click(dom.fileRow(name));
			if (
				await editor.waitFor(selected, `${name} to be selected`, 2000).then(
					() => true,
					() => false,
				)
			)
				return;
		}
		throw new Error(`${name} didn't get selected`);
	}

	// Cmd+clicks (Ctrl+clicks) Explorer rows, which adds them to the
	// selection or takes them out, until they show it. Theia redraws its
	// trees after a debounce, and now and then drops a click, so a row is
	// clicked again only while it doesn't show the state yet.
	async function cmdClick(items: { hint: string; path: string }[], selected: boolean): Promise<void> {
		const shows = (item: { hint: string }) =>
			`${selected ? "" : "!"}document.querySelector(${JSON.stringify(`${dom.row}[data-beans-hint="${item.hint}"]`)})?.matches(${JSON.stringify(dom.selectedRow)})`;
		let pending = items;
		for (let attempt = 0; attempt < 3 && pending.length; attempt++) {
			await editor.evaluate(`window.__beans.select(${JSON.stringify(pending)})`);
			await editor.waitFor(pending.map(shows).join(" && "), "the rows to show the click", 2000).catch(() => undefined);
			const done = await Promise.all(pending.map((item) => editor.evaluate<boolean>(shows(item))));
			pending = pending.filter((_, i) => !done[i]);
		}
		if (pending.length) {
			const hints = pending.map((item) => item.hint).join(", ");
			throw new Error(`Cmd+click didn't ${selected ? "select" : "unselect"} the rows with hints ${hints}`);
		}
	}

	// What window.__beans.select takes for an Explorer file: its hint and path.
	async function fileItem(name: string): Promise<{ hint: string; path: string }> {
		const hint = await editor.waitFor<string>(rowHint(name), `the ${name} row`);
		const result = await editor.evaluate<ResolveResult>(`window.__beans.resolve(${target(hint)})`);
		return { hint, path: result.items[0]!.path };
	}

	// The names of the files a target's items resolve to.
	async function namesOf(items: object[]): Promise<string[]> {
		const result = await editor.evaluate<ResolveResult>(`window.__beans.resolve(${JSON.stringify({ items })})`);
		return result.items.map((item) => path.basename(item.path));
	}

	// The names of the files "this" resolves to, and what it reports missing.
	async function namesOfThis(): Promise<{ names: string[]; missing: string[] }> {
		const result = await editor.evaluate<ResolveResult>(`window.__beans.resolve(${target("this")})`);
		return { names: result.items.map((item) => path.basename(item.path)), missing: result.missing };
	}

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

	// Tab hints: VS Code only, for now.
	const tabs = dom.tabs;

	// Every test closes all the editors first, which frees their letters, so
	// the letters start from A again.
	it.skipIf(!tabs)("letters every editor tab, and a tab keeps its letters when another closes", async () => {
		await openTabs(["a.txt", "b.txt", "c.txt"]);
		// The tabs are in the Explorer's order, folders first: c.txt, a.txt, b.txt.
		const names = await editor.evaluate<string[]>(tabNamesIn(0));
		expect(names).toEqual(["c.txt", "a.txt", "b.txt"]);
		expect(await editor.evaluate(tabHintsIn(0))).toEqual(["a", "b", "c"]);

		await runCommand("beans.slot", "a", `${activeTabName(0)} === "c.txt"`, "c.txt to show");
		await runCommand(
			"workbench.action.closeActiveEditor",
			undefined,
			`${tabHint("c.txt")} === null && ${tabHint("a.txt")} !== null`,
			"c.txt to close",
		);
		// VS Code moves a.txt and b.txt into the tab elements to their left.
		expect(await editor.evaluate(tabNamesIn(0))).toEqual(["a.txt", "b.txt"]);
		expect(await editor.evaluate(tabHintsIn(0))).toEqual(["b", "c"]);
	});

	it.skipIf(!tabs)("letters the same file in two splits apart, and beans.slot switches to either", async () => {
		await openTabs(["a.txt", "b.txt"]);
		await runCommand("workbench.action.splitEditor", undefined, `${groupCount} >= 2`, "a second split");
		expect(await editor.waitFor<string>(tabHint("b.txt", 1), "b.txt's tab in the second split")).toBe("c");
		expect(await tabHintsOf(["a.txt", "b.txt"])).toEqual(["a", "b"]);

		// a.txt isn't the active tab of the first split, and the second has focus.
		await runCommand("beans.slot", "a", `${activeGroup} === 0 && ${activeTabName(0)} === "a.txt"`, "a.txt to show");
		await runCommand("beans.slot", "c", `${activeGroup} === 1`, "the second split to take focus");
		expect(await editor.evaluate<string>(activeTabName(1))).toBe("b.txt");
	});

	// In the next two, the tabs to the left close first, which frees A and B:
	// a tab whose key changed would take A.
	it.skipIf(!tabs)("keeps a preview tab's letters when it's kept open", async () => {
		await openTabs(["b.txt", "c.txt"]);
		const row = await editor.waitFor<string>(rowHint("a.txt"), "the a.txt row");
		// A click on a file opens it in a preview tab, which VS Code keeps
		// open once you edit the file or double-click it.
		await runCommand("beans.pick", row, `${tabHint("a.txt")} !== null && ${isPreview(2)}`, "a.txt's preview tab");
		expect(await tabHintsOf(["a.txt"])).toEqual(["c"]);
		await runCommand("workbench.action.closeEditorsToTheLeft", undefined, `${tabsIn(0)}.length === 1`, "a.txt alone");
		await runCommand("workbench.action.keepEditor", undefined, `!(${isPreview(0)})`, "a.txt to be kept open");
		await relabel();
		expect(await tabHintsOf(["a.txt"])).toEqual(["c"]);
	});

	it.skipIf(!tabs)("keeps an untitled file's letters while its first line, its name, is typed", async () => {
		await openTabs(["a.txt", "b.txt"]);
		await runCommand("workbench.action.files.newUntitledFile", undefined, `${tabsIn(0)}.length === 3`, "a new file");
		expect(await editor.evaluate(tabHintsIn(0))).toEqual(["a", "b", "c"]);
		await runCommand(
			"workbench.action.closeEditorsToTheLeft",
			undefined,
			`${tabsIn(0)}.length === 1`,
			"the new file alone",
		);
		try {
			await editor.type("hello world");
			await editor.waitFor(`${tabHint("hello world")} !== null`, "the untitled tab to take its first line's name");
			await relabel();
			expect(await editor.evaluate(tabHintsIn(0))).toEqual(["c"]);
		} finally {
			await runCommand(
				"workbench.action.revertAndCloseActiveEditor",
				undefined,
				`${tabsIn(0)}.length === 0`,
				"the untitled file to close",
			);
		}
	});

	it.skipIf(!tabs)("switches with beans.slot to a tab scrolled out of the tab strip", async () => {
		await openTabs([]);
		// Empty untitled files, enough to overflow the strip; they close without asking.
		for (let count = 1; count <= 20; count++) {
			await runCommand(
				"workbench.action.files.newUntitledFile",
				undefined,
				`${tabsIn(0)}.length >= ${count}`,
				`untitled file ${count}`,
			);
		}
		await editor.waitFor(`${tabsIn(0)}.every((tab) => tab.hasAttribute("data-beans-tab"))`, "every tab's letters");
		expect(await editor.evaluate(`${tabsIn(0)}[0].getAttribute("data-beans-tab")`)).toBe("a");
		expect(await editor.evaluate(isOutOfStrip(0))).toBe(true);

		const first = await editor.evaluate<string>(
			`${tabsIn(0)}[0].querySelector(${JSON.stringify(tabs?.name)}).textContent.trim()`,
		);
		await runCommand("beans.slot", "a", `${activeTabName(0)} === ${JSON.stringify(first)}`, "the first tab to show");
		expect(await editor.evaluate<string>(`${tabsIn(0)}[0].getAttribute("data-beans-tab")`)).toBe("a");
	});

	it.skipIf(!tabs)("draws no tab hints with beans.tabHints off", async () => {
		await openTabs(["a.txt"]);
		editor.setSettings({ "beans.tabHints": false });
		try {
			await editor.waitFor("window.__beansTabHints === false", "the script without tab hints");
			await editor.waitFor(`document.querySelectorAll("[data-beans-tab]").length === 0`, "the tab hints to go");
			expect(await editor.evaluate<number>(`document.querySelectorAll(${JSON.stringify(tabs!.tab)}).length`)).toBe(1);
		} finally {
			editor.setSettings({});
			await editor.waitFor("window.__beansTabHints === true", "the script with tab hints");
		}
	});

	// Expressions about the tabs. A split is given by its place among the
	// splits, a tab by its file's name.
	const groupCount = `document.querySelectorAll(${JSON.stringify(tabs?.group)}).length`;
	const activeGroup = `[...document.querySelectorAll(${JSON.stringify(tabs?.group)})].findIndex((group) => group.matches(${JSON.stringify(tabs?.activeGroup)}))`;
	const tabsIn = (group: number) =>
		`[...(document.querySelectorAll(${JSON.stringify(tabs?.group)})[${group}]?.querySelectorAll(${JSON.stringify(tabs?.tab)}) ?? [])]`;
	const tabHint = (name: string, group = 0) =>
		`(${tabsIn(group)}.find((tab) => tab.querySelector(${JSON.stringify(tabs?.name)})?.textContent?.trim() === ${JSON.stringify(name)})?.getAttribute("data-beans-tab") ?? null)`;
	const activeTabName = (group: number) =>
		`(document.querySelectorAll(${JSON.stringify(tabs?.group)})[${group}]?.querySelector(${JSON.stringify(`${tabs?.activeTab} ${tabs?.name}`)})?.textContent?.trim() ?? null)`;

	const tabNamesIn = (group: number) =>
		`${tabsIn(group)}.map((tab) => tab.querySelector(${JSON.stringify(tabs?.name)})?.textContent?.trim())`;
	const tabHintsIn = (group: number) => `${tabsIn(group)}.map((tab) => tab.getAttribute("data-beans-tab"))`;
	// Whether the first split's tab at this place is a preview, shown in italics.
	const isPreview = (place: number) => `!!${tabsIn(0)}[${place}]?.querySelector(${JSON.stringify(tabs?.preview)})`;
	// Whether the first split's tab at this place is scrolled out of its strip.
	const isOutOfStrip = (place: number) => `(() => {
		const tab = ${tabsIn(0)}[${place}].getBoundingClientRect();
		const strip = document.querySelector(${JSON.stringify(tabs?.strip)}).getBoundingClientRect();
		return tab.right <= strip.left || tab.left >= strip.right;
	})()`;
	// Makes Beans relabel, as a resize of the window does, and waits for it:
	// what changes a tab's look alone doesn't.
	const relabel = async () => {
		await editor.evaluate(`window.dispatchEvent(new Event("resize"))`);
		await nextFrames();
	};
	const nextFrames = () =>
		editor.evaluate("new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))");

	async function tabHintsOf(names: string[]): Promise<(string | null)[]> {
		return Promise.all(names.map((name) => editor.evaluate<string | null>(tabHint(name))));
	}

	// Closes every editor, then opens these files of the workspace in one
	// split, pinned, in this order, and waits for their tabs' hints.
	async function openTabs(names: string[]): Promise<void> {
		await runCommand(
			"workbench.action.closeAllGroups",
			undefined,
			`${groupCount} === 1 && ${tabsIn(0)}.length === 0`,
			"no editors open",
		);
		// Beans relabels on the next frame, which frees the closed tabs' letters.
		await nextFrames();
		if (names.length === 0) return;
		const dir = await editor.waitFor<string>(rowHint("dir"), "the dir row");
		await setDirExpanded(dir, true);
		const hints = await Promise.all(names.map((name) => editor.waitFor<string>(rowHint(name), `the ${name} row`)));
		const shown = names.map((name) => `${tabHint(name)} !== null`).join(" && ");
		await runCommand("beans.open", { target: { items: hints.map((hint) => ({ hint })) } }, shown, "the tabs' hints");
		await setDirExpanded(dir, false);
	}

	// Runs a command through a keybinding, as Talon would, until the
	// expression holds. Each command and arguments gets its own key, so a
	// press can't reach a binding the editor hasn't reloaded yet: Ctrl+Alt
	// and a digit, then a letter.
	const bindings: Keybinding[] = [];
	const KEY_NAMES = "0123456789abcdefghijklmnopqrstuvwxyz";
	async function runCommand(command: string, args: unknown, until: string, what: string): Promise<void> {
		let index = bindings.findIndex(
			(binding) => binding.command === command && JSON.stringify(binding.args) === JSON.stringify(args),
		);
		if (index === -1) {
			index = bindings.length;
			if (index >= KEY_NAMES.length) throw new Error("runCommand ran out of keys");
			bindings.push({ key: `ctrl+alt+${KEY_NAMES[index]}`, command, args });
			editor.setKeybindings(bindings);
		}
		const name = KEY_NAMES[index]!;
		const isDigit = index < 10;
		const key = {
			key: name,
			code: isDigit ? `Digit${name}` : `Key${name.toUpperCase()}`,
			keyCode: name.toUpperCase().charCodeAt(0),
			ctrl: true,
			alt: true,
		};
		for (let attempt = 0; attempt < 5; attempt++) {
			await editor.press(key);
			const done = await editor.waitFor(until, what, 3000).then(
				() => true,
				() => false,
			);
			if (done) return;
		}
		throw new Error(`Timed out waiting for ${what}`);
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
			if (EDITOR_KIND === "vscode" && process.env.VSCODE_VERSION?.startsWith("1.90."))
				context.skip("VS Code 1.90 doesn't smooth a synthetic mouse wheel");
			await editor.waitFor(mouseWheelAnimates, "the editor to smooth a mouse wheel");
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
		// The second arrives the frame the first's first event moves the
		// lines, while it's still measuring.
		const down: ScrollRequest = { direction: "down", hint: "", place: "document" };
		await editor.evaluate(`(async () => {
			${writeScroll(down)};
			while (!((${splitScrolls})[0] > 0)) await new Promise((done) => requestAnimationFrame(done));
			${writeScroll(down)};
		})()`);
		await new Promise((resolve) => setTimeout(resolve, 300));
		await settledScroll(editor);
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
		// Theia 1.77, like VS Code, leaves the focus in the Explorer after a
		// click opens a file, and the split command needs an active editor.
		await editor.click(`${dom.editorSplit} ${dom.textEditor}`);
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
// (see src/page/scroll-lines.ts). 18px lines don't divide 500,000, so a
// shift is one of two numbers of lines, depending on which it is: 499,986px
// at 500,000px, then 500,004px at 2,000,000px. With the room to scroll the
// last line to the top, huge.txt's bottom is 2,003,004px down, more than a
// page past that shift, and edge.txt's 2,000,016px, just past it.
// first.txt passes the first shift, where the line at 500,004px is the
// first past it.
const HUGE_LINES = 111_279;
const EDGE_LINES = 111_113;
const FIRST_LINES = 28_000;
const SHIFT_AT_LINE = 2_000_000 / 18 + 1;
const FIRST_SHIFT_LINE = 500_004 / 18 + 1;

describe(`Beans in a real ${dom.name}, in files of over ${EDGE_LINES} lines`, () => {
	let editor: Editor;
	let workspace: string;

	beforeAll(async () => {
		workspace = fs.mkdtempSync(path.join(os.tmpdir(), "beans-long-"));
		for (const [name, count] of [
			["huge.txt", HUGE_LINES],
			["edge.txt", EDGE_LINES],
			["first.txt", FIRST_LINES],
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

	it("moves 80% of a screen exactly when a page's first event crosses the first shift", async () => {
		await openOnly(editor, "first.txt");
		await editor.waitFor(`${editorSize}.lineHeight === 18`, "the 18px lines setting");
		const { height, lineHeight } = await editor.evaluate<EditorSize>(editorSize);
		const page = pagePixels(height, lineHeight) / lineHeight;
		await sendScroll(editor, { direction: "bottom", hint: "", place: "document" });
		await editor.waitFor(lineShown(FIRST_LINES), "the last line");

		// A few lines before the shift, so the first event of a page down
		// crosses it, then a few lines past it, for a page up.
		for (const [direction, from, to] of [
			["down", FIRST_SHIFT_LINE - 5, FIRST_SHIFT_LINE - 1],
			["up", FIRST_SHIFT_LINE + 1, FIRST_SHIFT_LINE + 5],
		] as const) {
			await wheelToLines(editor, from, to, page);
			const line = await settledTopLine(editor);
			const cut = await editor.evaluate<number>(topLineCut);
			await sendScroll(editor, { direction, hint: "", place: "document" });
			const after = await settledTopLine(editor, line);
			expect(Math.abs(after - line), `${direction} from ${line} to ${after}`).toBe(page);
			expect(await editor.evaluate<number>(topLineCut), `the top line's cut after a page ${direction}`).toBeCloseTo(
				cut,
				0,
			);
		}
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
	await editor.evaluate(writeScroll(request));
}

// An expression that writes a scroll request into the channel.
const writeScroll = (request: ScrollRequest) => `(() => {
	const channel = document.getElementById(window.__beansChannelId);
	const walker = document.createTreeWalker(channel, NodeFilter.SHOW_TEXT);
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		if (node.data.includes("beans:")) node.data = "beans:" + Date.now() + ":scroll:" + ${JSON.stringify(scrollChannelText(request))};
	}
})()`;

// Waits for the splits' scroll positions to change from these and stop
// changing: Beans measures each wheel event once the lines stop moving.
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

// Pages up to within a page of these lines, then turns the wheel a notch at
// a time until the first line in sight is between them.
async function wheelToLines(editor: Editor, from: number, to: number, page: number): Promise<void> {
	let line = await settledTopLine(editor);
	while (line - to > page) {
		await sendScroll(editor, { direction: "up", hint: "", place: "document" });
		line = await settledTopLine(editor, line);
	}
	for (let notch = 0; notch < 60; notch++) {
		if (line >= from && line <= to) return;
		await nudge(editor, line < from ? 1 : -1);
		line = await settledTopLine(editor);
	}
	throw new Error(`the wheel never brought line ${from} to ${to} to the top`);
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
