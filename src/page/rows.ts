import type { View } from "../shared/types";
import { isNumberHint } from "./hints";
import { EDITOR, HINT_ATTR, SELECTORS, VIEW_NAMES } from "./selectors";

// Finding the rows: which are on screen, which has a hint, what a row shows.

/** The sidebars that are open. */
export function sidebars(): HTMLElement[] {
	return SELECTORS.parts
		.map((selector) => document.querySelector<HTMLElement>(selector))
		.filter((part): part is HTMLElement => part !== null && part.offsetParent !== null);
}

/** The quick pick that's open, if any. */
export function openQuickInput(): HTMLElement | null {
	const quickInput = document.querySelector<HTMLElement>(SELECTORS.quickInput);
	const isOpen = quickInput && quickInput.style.display !== "none" && quickInput.offsetParent !== null;
	return isOpen ? quickInput : null;
}

/**
 * Rows of these containers that are at least partly on screen, top to
 * bottom, container by container. View headers count as rows too, so
 * "hint <letters>" can expand or collapse a view.
 */
export function visibleRows(containers: HTMLElement[]): HTMLElement[] {
	const rows: HTMLElement[] = [];
	for (const container of containers) {
		const containerRows: { row: HTMLElement; top: number; left: number }[] = [];
		for (const row of container.querySelectorAll<HTMLElement>(rowSelector())) {
			if (SELECTORS.skip.length && row.querySelector(SELECTORS.skip.join(","))) continue;
			const rect = row.getBoundingClientRect();
			// A header isn't in a list, so it only has to show inside the sidebar.
			// The header of a sidebar's only view is hidden and has no height.
			const bounds = row.matches(SELECTORS.paneHeader) ? container : row.closest(SELECTORS.list);
			if (rect.height === 0 || !isInside(rect, bounds, stickyBottom(row))) continue;
			containerRows.push({ row, top: rect.top, left: rect.left });
		}
		containerRows.sort((a, b) => a.top - b.top || a.left - b.left);
		rows.push(...containerRows.map(({ row }) => row));
	}
	return rows;
}

function rowSelector(): string {
	return `${SELECTORS.row}, ${SELECTORS.paneHeader}`;
}

/** The sidebar row or view header with this hint in a container. */
export function rowWithHint(container: HTMLElement, hint: string): HTMLElement | null {
	const withHint = `[${HINT_ATTR}="${hint}"]`;
	return container.querySelector<HTMLElement>(`:is(${SELECTORS.row}, ${SELECTORS.paneHeader})${withHint}`);
}

/** The row with this hint in the sidebars. */
export function sidebarRowWithHint(hint: string): HTMLElement | null {
	return (
		sidebars()
			.map((part) => rowWithHint(part, hint))
			.find((row) => row !== null) ?? null
	);
}

/** The quick pick row (numbers) or sidebar row (letters) with this hint, logging when there's none. */
export function findRow(hint: string): HTMLElement | null {
	const containers = isNumberHint(hint) ? [openQuickInput()].filter((c): c is HTMLElement => c !== null) : sidebars();
	const row = containers.map((container) => rowWithHint(container, hint)).find((r) => r !== null) ?? null;
	if (!row) console.log(`[beans] no row with hint "${hint}"`);
	return row;
}

/**
 * What a row shows, for stable hints to follow an item from frame to frame
 * (see rowKeys), and its place in its list: the lists reuse row elements
 * for other items as they scroll.
 */
export function rowKeyParts(row: HTMLElement): { row: HTMLElement; base: string; index: string | null } {
	const index = row.closest(SELECTORS.listIndex)?.getAttribute("data-index") ?? null;
	return { row, base: rowBase(row), index };
}

// The id of the view container the row is in, then a file row's path, else
// its depth in the tree and its name. A sticky scroll row stands for a
// folder whose own row is scrolled past, so it shares that row's key.
function rowBase(row: HTMLElement): string {
	const container = row.closest(SELECTORS.viewContainer)?.id ?? "";
	const name = nameElement(row).textContent?.trim() ?? "";
	if (row.matches(SELECTORS.paneHeader)) return `${container}|header|${name}`;
	// VS Code gives a tree row's depth in aria-level; Theia only indents it.
	const depth = EDITOR === "theia" ? row.style.paddingLeft : (row.getAttribute("aria-level") ?? "");
	const item = rowPath(row) ?? `${depth}|${name}`;
	return `${container}|${viewOf(row)}|${item}`;
}

/** The element holding the row's name, where the hint is shown before the name. */
export function nameElement(row: HTMLElement): HTMLElement {
	if (row.matches(SELECTORS.paneHeader)) return row.querySelector<HTMLElement>(SELECTORS.paneTitle) ?? row;
	for (const selector of SELECTORS.names) {
		const element = row.querySelector<HTMLElement>(selector);
		if (element) return element;
	}
	return row.querySelector<HTMLElement>(SELECTORS.rowTarget) ?? row;
}

// The list clips rows that are scrolled half out of view. Those still get a
// hint, as long as a few pixels of them show; the list keeps rows just
// outside its edges rendered, so those are skipped. Rows above coveredTo,
// a page y, are hidden under something.
function isInside(rect: DOMRect, container: Element | null, coveredTo = -Infinity): boolean {
	if (!container) return false;
	const bounds = container.getBoundingClientRect();
	const top = Math.max(rect.top, bounds.top, coveredTo);
	const bottom = Math.min(rect.bottom, bounds.bottom, window.innerHeight);
	return bottom - top >= 2;
}

/**
 * Where the sticky scroll rows of the row's list end, as a page y, when
 * they cover the row; -Infinity otherwise. The sticky rows themselves are
 * rows too, and get their own hints.
 */
function stickyBottom(row: HTMLElement): number {
	const sticky = row.closest(SELECTORS.list)?.querySelector(SELECTORS.stickyRows);
	if (!sticky || sticky.contains(row)) return -Infinity;
	return sticky.getBoundingClientRect().bottom;
}

/** The path of the file a row shows, or undefined when it isn't a file. */
export function rowPath(row: Element): string | undefined {
	const label = row.matches(SELECTORS.pathLabel) ? row : row.querySelector(SELECTORS.pathLabel);
	// The hover text adds decorations after the path: "/a/notes.txt • Modified".
	return label?.getAttribute(SELECTORS.pathAttribute)?.split(" • ")[0];
}

/**
 * Whether a row or view header is expanded, or null when it can't expand.
 * VS Code says so in aria-expanded; Theia only in its chevron's class.
 */
export function expandedState(row: Element): boolean | null {
	if (EDITOR === "theia") {
		const twistie = row.querySelector(SELECTORS.twistie);
		return twistie ? !twistie.classList.contains(SELECTORS.collapsedClass) : null;
	}
	const state = row.getAttribute("aria-expanded");
	return state === null ? null : state === "true";
}

export function viewOf(row: Element): View {
	return VIEW_NAMES.find((name) => row.closest(SELECTORS.views[name])) ?? "other";
}

/** The hint a row carries, or "" when it has none. */
export function hintOf(row: Element): string {
	return row.getAttribute(HINT_ATTR) ?? "";
}
