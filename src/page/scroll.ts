import type { ScrollDirection, ScrollPlace } from "../requests";
import { nextFrame } from "./click";
import { pageDistance } from "./page-distance";
import { openQuickInput, sidebarRowWithHint, sidebars } from "./rows";
import { SELECTORS } from "./selectors";
import { splitOnSide } from "./split-on-side";

/**
 * Scrolls "up", "down" (most of a screen), to the "top" or to the "bottom".
 * The "left" or "right" place is that editor split. Otherwise it's the open
 * quick pick, else the sidebar list holding the row with this hint (or
 * under the view header with it), else for "bar" the tallest sidebar list,
 * and for "document" the editor split with the focus.
 */
export function scroll(direction: ScrollDirection, hint: string, place: ScrollPlace): void {
	const view = viewToScroll(hint, place);
	if (!view) {
		console.log(`[beans] nothing to scroll${hint ? ` for hint "${hint}"` : ` in the ${place}`}`);
		return;
	}
	const page = pageDistance(view.box.getBoundingClientRect().height, view.rowHeight);
	const distance = { up: -page, down: page, top: -1e6, bottom: 1e6 }[direction];
	const scroller = view.box.matches(SELECTORS.nativeScroller)
		? view.box
		: view.box.querySelector<HTMLElement>(SELECTORS.nativeScroller);
	if (scroller) scroller.scrollBy({ top: distance });
	else scrollBy(view.rows, distance);
}

/**
 * Something to scroll: the box it shows in, the element that moves inside
 * it (a list's rows, an editor's lines), and how tall one row or line is.
 */
interface ScrollView {
	box: HTMLElement;
	rows: HTMLElement;
	rowHeight: number;
}

function viewToScroll(hint: string, place: ScrollPlace): ScrollView | null {
	if (place === "left" || place === "right") return documentIn(splitToScroll(place));
	const quickInput = openQuickInput();
	if (quickInput) return listView(quickInput.querySelector<HTMLElement>(SELECTORS.list));
	if (hint) {
		const row = sidebarRowWithHint(hint);
		if (row?.matches(SELECTORS.paneHeader))
			return listView(row.parentElement?.querySelector<HTMLElement>(SELECTORS.list) ?? null);
		return listView(row?.closest<HTMLElement>(SELECTORS.list) ?? null);
	}
	if (place === "bar") return listView(tallestSidebarList());
	return documentIn(splitToScroll("document"));
}

function listView(list: HTMLElement | null): ScrollView | null {
	if (!list) return null;
	return {
		box: list,
		rows: list.querySelector<HTMLElement>(SELECTORS.listRows) ?? list,
		rowHeight: list.querySelector(SELECTORS.row)?.getBoundingClientRect().height ?? 22,
	};
}

function tallestSidebarList(): HTMLElement | null {
	const lists = sidebars().flatMap((part) => Array.from(part.querySelectorAll<HTMLElement>(SELECTORS.list)));
	const heights = lists.map((list) => list.getBoundingClientRect().height);
	const tallest = Math.max(0, ...heights);
	return tallest > 0 ? (lists[heights.indexOf(tallest)] ?? null) : null;
}

/**
 * What a split shows: the biggest text editor or list in it. That's the
 * text in a text editor, the modified side in a diff editor, the list of
 * cells in a notebook, the settings in Settings. Webviews, such as the
 * Markdown preview, have neither.
 */
function documentIn(split: HTMLElement | null): ScrollView | null {
	if (!split) return null;
	const views = [
		...[...split.querySelectorAll<HTMLElement>(SELECTORS.editor)].map((editor) => editorView(editor)),
		...[...split.querySelectorAll<HTMLElement>(SELECTORS.list)].map((list) => listView(list)),
	];
	let biggest: ScrollView | null = null;
	let biggestArea = 0;
	for (const view of views) {
		if (!view) continue;
		const { width, height } = view.box.getBoundingClientRect();
		// A tie goes to the later one: a side-by-side diff's modified side.
		if (width * height > 0 && width * height >= biggestArea) {
			biggest = view;
			biggestArea = width * height;
		}
	}
	return biggest;
}

function editorView(editor: HTMLElement): ScrollView | null {
	const lines = editor.querySelector<HTMLElement>(SELECTORS.editorLines);
	if (!lines) return null;
	return {
		box: editor,
		rows: lines,
		rowHeight: editor.querySelector(SELECTORS.editorLine)?.getBoundingClientRect().height || 18,
	};
}

/**
 * The editor split with the focus, or that had it last, or the left or
 * right split beside it.
 */
function splitToScroll(place: "document" | "left" | "right"): HTMLElement | null {
	// VS Code opens Settings, among others, in a modal editor part over the
	// main one, with an active split of its own. That part comes later in
	// the page, and it's the one in sight.
	const mark = shown(document.querySelectorAll<HTMLElement>(SELECTORS.activeEditorGroup)).at(-1) ?? null;
	const part = mark?.closest(SELECTORS.editorPart) ?? document;
	const splits = shown(part.querySelectorAll<HTMLElement>(SELECTORS.editorGroup));
	const focused = mark && (splits.includes(mark) ? mark : splitBelow(mark, splits));
	if (place === "document") return focused;
	const boxes = splits.map((split) => split.getBoundingClientRect());
	return splits[splitOnSide(boxes, place, focused?.getBoundingClientRect() ?? null)] ?? null;
}

function shown(elements: NodeListOf<HTMLElement>): HTMLElement[] {
	return [...elements].filter((element) => {
		const { width, height } = element.getBoundingClientRect();
		return width > 0 && height > 0;
	});
}

// Theia marks the tab bar above the active split, not the split.
function splitBelow(mark: HTMLElement, splits: HTMLElement[]): HTMLElement | null {
	const markBox = mark.getBoundingClientRect();
	const middle = markBox.left + markBox.width / 2;
	let nearest: { split: HTMLElement; top: number } | null = null;
	for (const split of splits) {
		const box = split.getBoundingClientRect();
		const isBelow = box.left <= middle && middle <= box.right && box.top >= markBox.top;
		if (isBelow && (!nearest || box.top < nearest.top)) nearest = { split, top: box.top };
	}
	return nearest?.split ?? null;
}

/**
 * Scrolls a list's rows, or an editor's lines, by about this many pixels
 * (positive is down).
 *
 * VS Code's lists and editors draw their own scrollbar and only react to
 * wheel events. How far a wheel event moves them depends on the screen's pixel
 * ratio and VS Code's settings, and a synthetic event even reads with the
 * opposite sign, so this sends one event, measures how far the rows
 * moved, and sends a second one for the rest. Both go out before the
 * next paint when the list moves at once, so the rows don't jump twice;
 * an editor, or a list with smooth scrolling on, moves on the next frame,
 * so the second waits for it.
 */
export function scrollBy(rows: HTMLElement, distance: number): void {
	const wheel = (deltaY: number) =>
		rows.dispatchEvent(
			new WheelEvent("wheel", { bubbles: true, cancelable: true, view: window, deltaY, deltaMode: 0 }),
		);
	const before = scrollPosition(rows);
	const guess = -distance;
	wheel(guess);
	const finish = () => {
		const moved = scrollPosition(rows) - before;
		const remaining = distance - moved;
		if (moved === 0 || Math.abs(remaining) < 1) return;
		wheel(guess * (remaining / moved));
	};
	if (scrollPosition(rows) !== before) finish();
	else void nextFrame().then(finish);
}

// A list moves its rows, and an editor its lines, by setting style.top to
// minus the scroll position.
export function scrollPosition(rows: HTMLElement): number {
	return -parseFloat(rows.style.top || "0");
}

/**
 * Scrolls a list so the row at this index sits at this page y, as near
 * as the list can scroll. The list only renders the rows on screen, and
 * rows can differ in height (Source Control's commit box is taller), so
 * this scrolls by an estimate until the row is rendered, then by what's
 * left, measured. A list renders as it scrolls, so it's all done before
 * the next paint.
 */
export function placeRow(rows: HTMLElement, index: number, top: number): void {
	for (let attempt = 0; attempt < 5; attempt++) {
		const rendered = [...rows.querySelectorAll<HTMLElement>(`:scope > :is(${SELECTORS.row})`)];
		const row = rendered.find((element) => rowIndex(element) === index);
		let distance;
		if (row) distance = row.getBoundingClientRect().top - top;
		else {
			// Estimate from the rendered row nearest in index, as if the rows between were as tall as it.
			const distanceTo = (element: HTMLElement) => Math.abs(rowIndex(element) - index);
			const nearest = rendered.reduce<HTMLElement | undefined>(
				(best, element) => (best === undefined || distanceTo(element) < distanceTo(best) ? element : best),
				undefined,
			);
			if (!nearest) return;
			const box = nearest.getBoundingClientRect();
			distance = box.top + (index - rowIndex(nearest)) * box.height - top;
		}
		if (Math.abs(distance) < 1) return;
		const before = scrollPosition(rows);
		scrollBy(rows, distance);
		// At the top or bottom of the list, it can't scroll any nearer.
		if (row || scrollPosition(rows) === before) return;
	}
}

/** The list index a row shows, from its data-index; NaN when it has none. */
export function rowIndex(row: HTMLElement): number {
	return Number(row.dataset.index);
}
