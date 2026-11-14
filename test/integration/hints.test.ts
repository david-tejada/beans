import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import type { Editor as EditorKind, ResolveResult } from "../../src/shared/types";
import { EDITOR_KIND, KEYS, startEditor, type Editor, type Keybinding } from "./start-editor";

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
		sidebarItems: ".part.sidebar :is(.monaco-list-row, .pane-header)[data-beans-hint]",
		// A split of the editor area, the one with focus, and a tab in it, with
		// its file's name. Theia has no tab hints yet.
		tabs: {
			group: ".editor-group-container",
			activeGroup: ".editor-group-container.active",
			tab: ".tabs-container > .tab",
			activeTab: ".tabs-container > .tab.active",
			name: ".label-name",
		},
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
		sidebarItems: "#theia-left-side-panel :is(.theia-TreeNode, .theia-view-container-part-header)[data-beans-hint]",
		tabs: null,
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

	// Tab hints: VS Code only, for now.
	const tabs = dom.tabs;

	it.skipIf(!tabs)("letters every editor tab, and a tab keeps its letters when another closes", async () => {
		await openTabs(["a.txt", "b.txt", "c.txt"]);
		const before = await tabHintsOf(["a.txt", "b.txt", "c.txt"]);
		for (const hint of before) expect(hint).toMatch(/^[a-z]+$/);
		expect(new Set(before).size).toBe(3);

		await runCommand("beans.slot", before[0], `${activeTabName(0)} === "a.txt"`, "a.txt to show");
		await runCommand(
			"workbench.action.closeActiveEditor",
			undefined,
			`${tabHint("a.txt")} === null && ${tabHint("b.txt")} !== null`,
			"a.txt to close",
		);
		// VS Code moves b.txt and c.txt into the tab elements to their left.
		expect(await tabHintsOf(["b.txt", "c.txt"])).toEqual(before.slice(1));
	});

	it.skipIf(!tabs)("letters the same file in two splits apart, and beans.slot switches to either", async () => {
		await openTabs(["a.txt", "b.txt"]);
		await runCommand("workbench.action.splitEditor", undefined, `${groupCount} >= 2`, "a second split");
		const right = await editor.waitFor<string>(tabHint("b.txt", 1), "b.txt's tab in the second split");
		const left = await editor.evaluate<string>(tabHint("b.txt", 0));
		expect(right).toMatch(/^[a-z]+$/);
		expect(left).toMatch(/^[a-z]+$/);
		expect(right).not.toBe(left);

		// a.txt isn't the active tab of the first split, and the second has focus.
		const a = await editor.evaluate<string>(tabHint("a.txt", 0));
		await runCommand("beans.slot", a, `${activeGroup} === 0 && ${activeTabName(0)} === "a.txt"`, "a.txt to show");
		await runCommand("beans.slot", right, `${activeGroup} === 1`, "the second split to take focus");
		expect(await editor.evaluate<string>(activeTabName(1))).toBe("b.txt");
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
		const dir = await editor.waitFor<string>(rowHint("dir"), "the dir row");
		await setDirExpanded(dir, true);
		const hints = await Promise.all(names.map((name) => editor.waitFor<string>(rowHint(name), `the ${name} row`)));
		const shown = names.map((name) => `${tabHint(name)} !== null`).join(" && ");
		await runCommand("beans.open", { target: { items: hints.map((hint) => ({ hint })) } }, shown, "the tabs' hints");
		await setDirExpanded(dir, false);
	}

	// Runs a command through a keybinding, as Talon would, until the
	// expression holds. Each command and arguments gets its own key, so a
	// press can't reach a binding the editor hasn't reloaded yet.
	const bindings: Keybinding[] = [];
	async function runCommand(command: string, args: unknown, until: string, what: string): Promise<void> {
		let digit = bindings.findIndex(
			(binding) => binding.command === command && JSON.stringify(binding.args) === JSON.stringify(args),
		);
		if (digit === -1) {
			digit = bindings.length;
			if (digit > 9) throw new Error("runCommand ran out of keys");
			bindings.push({ key: `ctrl+alt+${digit}`, command, args });
			editor.setKeybindings(bindings);
		}
		for (let attempt = 0; attempt < 5; attempt++) {
			await editor.press({ key: String(digit), code: `Digit${digit}`, keyCode: 48 + digit, ctrl: true, alt: true });
			const done = await editor.waitFor(until, what, 3000).then(
				() => true,
				() => false,
			);
			if (done) return;
		}
		throw new Error(`Timed out waiting for ${what}`);
	}
});
