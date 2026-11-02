import type { ResolveResult, SetExpandedResult, Target } from "../shared/types";
import { clickElement, clickRow, nextFrame } from "./click";
import { expandedState, hintOf, rowPath, sidebars, viewOf, visibleRows } from "./rows";
import { placeRow, rowIndex } from "./scroll";
import { SELECTORS } from "./selectors";

/**
 * Resolves a spoken target to the sidebar rows it names, in on-screen
 * order: the file rows, the hints of rows that aren't files (skipped), and
 * hints that aren't on screen (missing).
 */
export function resolve(target: Target): ResolveResult {
	const { rows, missing } = targetRows(target);
	const result: ResolveResult = { items: [], skipped: [], missing };
	for (const row of rows) {
		const hint = hintOf(row);
		const path = rowPath(row);
		if (!path) result.skipped.push(hint);
		// Only folder rows can expand.
		else {
			const state = expandedState(row);
			result.items.push({ hint, path, isFolder: state !== null, isExpanded: state === true, view: viewOf(row) });
		}
	}
	return result;
}

/**
 * A row to expand or collapse. A view header has no list, and Theia's rows
 * no index; they're clicked where they are.
 */
interface Toggle {
	row: HTMLElement;
	list?: HTMLElement;
	index?: number;
}

/**
 * Expands or collapses the rows a target names: any tree row that can,
 * such as a folder, a Search file or an Outline symbol, and view headers
 * said by their own hint. Rows that can't, such as files, are left alone,
 * and so are the headers inside a range. Returns the Explorer folders among
 * the rows as { hint, path }, for expanding deeper, and the hints that
 * aren't on screen (missing).
 */
export function setExpanded(target: Target, expanded: boolean): SetExpandedResult {
	const { rows, ends, missing } = targetRows(target);
	const focused = document.activeElement;
	// Every row is read before the first click. A click rebuilds the sticky
	// scroll rows, and a collapse at the end of a list scrolls it back, which
	// puts other items in these row elements.
	const folders: SetExpandedResult["folders"] = [];
	const toggles: Toggle[] = [];
	for (const row of rows) {
		const state = expandedState(row);
		if (state === null) continue;
		const hint = hintOf(row);
		if (row.matches(SELECTORS.paneHeader)) {
			// "collapse C through H" means the rows, not the whole views between them.
			if (ends.has(hint) && state !== expanded) toggles.push({ row });
			continue;
		}
		const path = rowPath(row);
		if (path && viewOf(row) === "explorer") folders.push({ hint, path });
		if (state !== expanded) {
			const index = rowIndex(row);
			const list = row.closest<HTMLElement>(SELECTORS.list) ?? undefined;
			toggles.push(Number.isNaN(index) ? { row } : { row, list, index });
		}
	}
	// Bottom up, since expanding a row rebuilds the rows below it.
	for (const { row, list, index } of toggles.toReversed()) {
		if (!list || index === undefined) {
			// Clicking a row's label opens it in most views; its arrow only expands or collapses it.
			clickElement(row.querySelector<HTMLElement>(SELECTORS.twistie) ?? row);
			continue;
		}
		const current = rowAtIndex(row, list, index);
		const twistie = current?.querySelector<HTMLElement>(SELECTORS.twistie);
		if (!current || !twistie || expandedState(current) === expanded) continue;
		if (current.matches(SELECTORS.stickyRow)) clickStickyTwistie(current, twistie);
		else clickElement(twistie);
	}
	// A click in a list focuses it. Focus goes back, so you can go on typing in the editor.
	if (focused instanceof HTMLElement && focused !== document.body && document.activeElement !== focused)
		focused.focus();
	return { folders, missing };
}

/**
 * The element that shows the list's item at this index: the row itself
 * while it still does, else whichever rendered row does, preferring a
 * list row to its sticky scroll copy. Null when the item isn't rendered.
 */
function rowAtIndex(row: HTMLElement, list: HTMLElement, index: number): HTMLElement | null {
	if (row.isConnected && rowIndex(row) === index) return row;
	const showing = [...list.querySelectorAll<HTMLElement>(`:is(${SELECTORS.row})[data-index="${index}"]`)];
	return showing.find((element) => !element.matches(SELECTORS.stickyRow)) ?? showing[0] ?? null;
}

/**
 * Clicks a sticky scroll row's arrow, which collapses it, without what
 * VS Code does on any click on a sticky row: scroll its folder into
 * place, focus the tree and select the folder. VS Code skips that for a
 * click on a toolbar button, so the arrow passes for one during the
 * click. Then Beans scrolls the folder to where its sticky row was, before
 * VS Code paints, as its own click does, so the tree doesn't jump.
 */
function clickStickyTwistie(row: HTMLElement, twistie: HTMLElement): void {
	const rows = row.closest(SELECTORS.list)?.querySelector<HTMLElement>(SELECTORS.listRows);
	// A sticky row is a copy of a list row, and keeps its index.
	const index = rowIndex(row);
	const { top } = row.getBoundingClientRect();
	twistie.classList.add(SELECTORS.actionItemClass);
	try {
		clickElement(twistie);
	} finally {
		twistie.classList.remove(SELECTORS.actionItemClass);
	}
	if (rows && !Number.isNaN(index)) placeRow(rows, index, top);
}

/**
 * The sidebar rows a target names, in on-screen order, the hints said
 * aloud, on their own or as a range's end (ends), and the hints that
 * aren't on screen (missing).
 */
function targetRows(target: Target): { rows: HTMLElement[]; ends: Set<string>; missing: string[] } {
	const rows = visibleRows(sidebars());
	const indexOf = (hint: string) => rows.findIndex((row) => hintOf(row) === hint);
	const chosen = new Set<number>();
	const ends = new Set<string>();
	const missing: string[] = [];
	for (const item of target.items) {
		const said: [string, string] = "hint" in item ? [item.hint, item.hint] : [item.from, item.to];
		const start = indexOf(said[0]);
		const end = indexOf(said[1]);
		if (start === -1 || end === -1) {
			if (start === -1) missing.push(said[0]);
			if (end === -1) missing.push(said[1]);
			continue;
		}
		for (const hint of said) ends.add(hint);
		// A range includes both ends, whichever way round they were said.
		for (let i = Math.min(start, end); i <= Math.max(start, end); i++) chosen.add(i);
	}
	const chosenRows = [...chosen].toSorted((a, b) => a - b).map((i) => rows[i]!);
	return { rows: chosenRows, ends, missing: [...new Set(missing)] };
}

/**
 * Adds rows to their list's selection, with Cmd+click or Ctrl+click.
 * Takes [{ hint, path }], and skips a row that no longer shows that path,
 * in case the list changed since the target was resolved. Returns the
 * paths of the Explorer's selected rows afterwards.
 */
export async function select(items: { hint: string; path: string }[], alsoSelected: string[] = []): Promise<string[]> {
	const rows = visibleRows(sidebars());
	const clicked = [...alsoSelected];
	for (const { hint, path } of items) {
		const row = rows.find((r) => hintOf(r) === hint);
		if (row && rowPath(row) === path) {
			clickRow(row, { addToSelection: true });
			clicked.push(path);
		}
	}
	// VS Code shows the new selection at once. Theia redraws its trees a few
	// milliseconds later, after a debounce, so this waits for the clicked
	// rows, and the ones the caller selected another way, to show as
	// selected, for up to 300ms.
	const deadline = performance.now() + 300;
	let paths = selectedExplorerPaths();
	while (!clicked.every((path) => paths.includes(path)) && performance.now() < deadline) {
		await nextFrame();
		paths = selectedExplorerPaths();
	}
	return paths;
}

function selectedExplorerPaths(): string[] {
	const selected = document.querySelectorAll(`${SELECTORS.views.explorer} ${SELECTORS.selectedRow}`);
	const paths = [...selected].map(rowPath).filter((path): path is string => path !== undefined);
	return [...new Set(paths)];
}
