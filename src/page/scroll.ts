import type { ScrollPlace, ScrollRequest } from "../requests";
import { nextFrame } from "./click";
import { pageDistance } from "./page-distance";
import { openQuickInput, sidebarRowWithHint, sidebars } from "./rows";
import { SELECTORS } from "./selectors";
import { splitOnSide } from "./split-on-side";

/**
 * Scrolls "up", "down" (most of a screen), to the "top" or to the "bottom".
 * An open quick pick takes every scroll. Otherwise it's the "left" or
 * "right" editor split, else the sidebar list holding the row with this
 * hint (or under the view header with it), else for "bar" the tallest
 * sidebar list, and for "document" the editor split with the focus.
 */
export function scroll({ direction, hint, place }: ScrollRequest): void {
	const view = viewToScroll(hint, place);
	if (!view) {
		console.log(`[beans] nothing to scroll${hint ? ` for hint "${hint}"` : ` in the ${place}`}`);
		return;
	}
	const page = pageDistance(view.box.getBoundingClientRect().height, view.rowHeight);
	const distance = { up: -page, down: page, top: -TO_THE_END, bottom: TO_THE_END }[direction];
	const scroller = view.box.matches(SELECTORS.nativeScroller)
		? view.box
		: view.box.querySelector<HTMLElement>(SELECTORS.nativeScroller);
	if (scroller) scroller.scrollBy({ top: distance });
	else scrollBy(view.rows, distance, view.box.matches(SELECTORS.editor) ? view.rowHeight : 0);
}

// Past the end of almost anything. Chromium caps the event's delta, and
// Monaco moves about 50 * wheelDeltaY / 120 for it, around 4e8px (less in
// VS Code 1.90, which also divides by the screen's pixel ratio): 10 to 20
// million lines.
const TO_THE_END = 1e9;

/**
 * Something to scroll: the box it shows in, the element that moves inside
 * it (a list's rows, an editor's lines), and how tall one row or line is,
 * or 0 when its rows differ in height.
 */
interface ScrollView {
	box: HTMLElement;
	rows: HTMLElement;
	rowHeight: number;
}

function viewToScroll(hint: string, place: ScrollPlace): ScrollView | null {
	const quickInput = openQuickInput();
	if (quickInput) return listView(quickInput.querySelector<HTMLElement>(SELECTORS.list), true);
	if (place === "left" || place === "right") return documentIn(splitToScroll(place));
	if (hint) {
		const row = sidebarRowWithHint(hint);
		if (row?.matches(SELECTORS.paneHeader))
			return listView(row.parentElement?.querySelector<HTMLElement>(SELECTORS.list) ?? null, true);
		return listView(row?.closest<HTMLElement>(SELECTORS.list) ?? null, true);
	}
	if (place === "bar") return listView(tallestSidebarList(), true);
	return documentIn(splitToScroll("document"));
}

// Sidebar and quick pick rows are all one height; a notebook's cells and
// Settings' rows aren't, so for those the first row says nothing.
function listView(list: HTMLElement | null, rowsAlike: boolean): ScrollView | null {
	if (!list) return null;
	return {
		box: list,
		rows: list.querySelector<HTMLElement>(SELECTORS.listRows) ?? list,
		rowHeight: rowsAlike ? list.querySelector(SELECTORS.row)?.getBoundingClientRect().height || 22 : 0,
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
		...[...split.querySelectorAll<HTMLElement>(SELECTORS.list)].map((list) => listView(list, false)),
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
	// Theia marks no tab bar until a split has had the focus, such as right
	// after it starts with editors open.
	if (place === "document") return focused ?? splits[0] ?? null;
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
 * (positive is down). For an editor, lineHeight makes the move exact.
 *
 * VS Code's lists and editors draw their own scrollbar and only react to
 * wheel events. How far a wheel event moves them depends on the screen's
 * pixel ratio and VS Code's settings, and a synthetic event even reads
 * with the opposite sign, so this sends one event, measures how far it
 * went, and sends another for the rest (see scrollLinesBy for an editor).
 */
export function scrollBy(rows: HTMLElement, distance: number, lineHeight = 0): void {
	// To the top or the bottom, one event far past the end does it, and the
	// view stops there.
	if (Math.abs(distance) >= TO_THE_END) wheel(rows, -distance);
	else if (lineHeight > 0) void scrollLinesBy(rows, distance, lineHeight);
	else scrollRowsBy(rows, distance);
}

// A list: both events go out before the next paint when the list moves at
// once, so the rows don't jump twice; with smooth scrolling on, it moves on
// the next frame, so the second waits for it.
function scrollRowsBy(rows: HTMLElement, distance: number): void {
	const start = scrollPosition(rows);
	wheel(rows, -distance);
	const finish = () => {
		const moved = scrollPosition(rows) - start;
		if (moved !== 0 && Math.abs(distance - moved) >= 1) wheel(rows, (-distance * (distance - moved)) / moved);
	};
	if (scrollPosition(rows) !== start) finish();
	else void nextFrame().then(finish);
}

// The editor scrolls in progress, one after another: a scroll said while
// the last is still moving waits for it, so each moves its full page.
let editorScrolls = Promise.resolve();

/**
 * Scrolls an editor's lines by this many pixels, a whole number of lines,
 * in up to three events, waiting after each for the lines to stop moving,
 * since Monaco smooths a wheel event it takes for a mouse's. Stops where
 * the view reaches an end, or when the editor goes away.
 */
function scrollLinesBy(rows: HTMLElement, distance: number, lineHeight: number): Promise<void> {
	// One that failed doesn't hold up the next.
	editorScrolls = editorScrolls.catch(() => {}).then(() => scrollLinesNow(rows, distance, lineHeight));
	return editorScrolls;
}

async function scrollLinesNow(rows: HTMLElement, distance: number, lineHeight: number): Promise<void> {
	// Lines still moving, from a mouse wheel, would show in the readings.
	const start = await settledPosition(rows);
	if (!rows.isConnected) return;
	const first = -distance;
	wheel(rows, first);
	const afterFirst = await settledPosition(rows);
	if (!rows.isConnected) return;
	const firstMoves = possibleMoves(afterFirst - start, lineHeight);
	const [guess] = firstMoves;
	if (!guess) return;
	// The rest, at the ratio the first event seems to have moved by.
	const second = Math.round(((distance - guess) * first) / guess);
	if (second === 0) return;
	wheel(rows, second);
	const secondMoves = possibleMoves((await settledPosition(rows)) - afterFirst, lineHeight);
	if (!rows.isConnected) return;
	// Wheel events move in proportion, so the two moves agree on the ratio.
	// When no pair of them does, the view stopped at an end (or something
	// else moved it), and it stays where it is.
	const pairs = firstMoves.flatMap((moved) =>
		secondMoves.filter((then) => Math.abs((second * moved) / first - then) <= 3).map((then) => [moved, then]),
	);
	const [pair] = pairs;
	if (pairs.length !== 1 || !pair) return;
	const [moved = 0, then = 0] = pair;
	// Monaco moves by whole steps of a fraction of a pixel, and can stop a
	// pixel short.
	const rest = distance - moved - then;
	if (Math.abs(rest) >= 0.5 && Math.abs(rest) <= lineHeight / 2) wheel(rows, Math.round((rest * first) / moved));
}

/**
 * How far an event may have moved the lines, from how far style.top moved.
 * In a long file, Monaco keeps style.top small: each time the view passes
 * another 500,000px, it moves the lines back by about that much, rounded
 * down to whole lines, so the shift is one of two numbers of lines. An
 * event of a page never moves that far, so a bigger move is that shift.
 * The nearer guess comes first.
 */
function possibleMoves(raw: number, lineHeight: number): number[] {
	if (raw === 0) return [];
	if (Math.abs(raw) <= MONACO_SHIFT / 2) return [raw];
	const shift = Math.round(raw / MONACO_SHIFT) * MONACO_SHIFT;
	const lines = Math.floor(Math.abs(shift) / lineHeight);
	const [fewer, more] = [lines, lines + 1].map((count) => raw - Math.sign(shift) * count * lineHeight);
	if (fewer === undefined || more === undefined) return [];
	const flat = raw - shift;
	return Math.abs(fewer - flat) <= Math.abs(more - flat) ? [fewer, more] : [more, fewer];
}

const MONACO_SHIFT = 500_000;

// The scroll position once the lines have stopped moving: the same two
// frames running. Gives up after half a second.
async function settledPosition(rows: HTMLElement): Promise<number> {
	let last = scrollPosition(rows);
	for (let frame = 0, same = 0; frame < 30 && same < 2; frame++) {
		await nextFrame();
		const now = scrollPosition(rows);
		same = now === last ? same + 1 : 0;
		last = now;
	}
	return last;
}

function wheel(rows: HTMLElement, deltaY: number): void {
	rows.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, view: window, deltaY, deltaMode: 0 }));
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
