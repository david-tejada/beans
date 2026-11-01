import type { ScrollDirection } from "../requests";
import { nextFrame } from "./click";
import { openQuickInput, sidebarRowWithHint, sidebars } from "./rows";
import { SELECTORS } from "./selectors";

/**
 * Scrolls a list "up", "down" (about a screen), to the "top" or to the
 * "bottom". The list is the open quick pick's, else the one holding the
 * row with this hint (or under the view header with it), else the tallest
 * one in the sidebars.
 */
export function scroll(direction: ScrollDirection, hint: string): void {
	const list = listToScroll(hint);
	if (!list) {
		console.log(`[beans] no list to scroll${hint ? ` for hint "${hint}"` : ""}`);
		return;
	}
	const rows = list.querySelector<HTMLElement>(SELECTORS.listRows) ?? list;
	const rowHeight = list.querySelector(SELECTORS.row)?.getBoundingClientRect().height ?? 22;
	// Keep two rows of the old view on screen, so you don't lose your place.
	const page = Math.max(list.getBoundingClientRect().height - 2 * rowHeight, rowHeight);
	const distance = { up: -page, down: page, top: -1e6, bottom: 1e6 }[direction];
	scrollBy(rows, distance);
}

/**
 * Scrolls a list's rows by about this many pixels (positive is down).
 *
 * VS Code's lists draw their own scrollbar and only react to wheel
 * events. How far a wheel event moves them depends on the screen's pixel
 * ratio and VS Code's settings, and a synthetic event even reads with the
 * opposite sign, so this sends one event, measures how far the rows
 * moved, and sends a second one for the rest. Both go out before the
 * next paint when the list moves at once, so the rows don't jump twice;
 * with smooth scrolling on, the second waits a frame.
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

// The list moves its rows by setting style.top to minus the scroll position.
export function scrollPosition(rows: HTMLElement): number {
	return -parseFloat(rows.style.top || "0");
}

function listToScroll(hint: string): HTMLElement | null {
	const quickInput = openQuickInput();
	if (quickInput) return quickInput.querySelector<HTMLElement>(SELECTORS.list);
	if (hint) {
		const row = sidebarRowWithHint(hint);
		if (row?.matches(SELECTORS.paneHeader))
			return row.parentElement?.querySelector<HTMLElement>(SELECTORS.list) ?? null;
		return row?.closest<HTMLElement>(SELECTORS.list) ?? null;
	}
	const lists = sidebars().flatMap((part) => Array.from(part.querySelectorAll<HTMLElement>(SELECTORS.list)));
	const heights = lists.map((list) => list.getBoundingClientRect().height);
	const tallest = Math.max(0, ...heights);
	return tallest > 0 ? (lists[heights.indexOf(tallest)] ?? null) : null;
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
		const rendered = [...rows.querySelectorAll<HTMLElement>(`:scope > ${SELECTORS.row}`)];
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
