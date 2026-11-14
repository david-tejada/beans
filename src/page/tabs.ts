import { clickElement } from "./click";
import { SELECTORS, TAB_HINT_ATTR } from "./selectors";
import { tabHints, type TabMemory, type TabParts } from "./tab-hints";

export type { TabMemory };

/**
 * Gives every open editor tab, in every split, letters it keeps while it's
 * open, including tabs scrolled out of their strip. With enabled false,
 * removes them. memory is what the last call returned.
 */
export function labelTabs(memory: TabMemory<HTMLElement>, enabled: boolean): TabMemory<HTMLElement> {
	const open = enabled ? [...document.querySelectorAll<HTMLElement>(SELECTORS.tab)].map(tabParts) : [];
	const { hints, memory: next } = tabHints(open, memory);
	const hinted = new Set<Element>();
	for (const [tab, hint] of hints) {
		if (!hint) continue;
		// The tab carries the hint for slot(); the box with its name shows it.
		const place = tab.querySelector(SELECTORS.tabHintPlace);
		for (const element of place ? [tab, place] : [tab]) {
			if (element.getAttribute(TAB_HINT_ATTR) !== hint) element.setAttribute(TAB_HINT_ATTR, hint);
			hinted.add(element);
		}
	}
	for (const element of document.querySelectorAll(`[${TAB_HINT_ATTR}]`)) {
		if (!hinted.has(element)) element.removeAttribute(TAB_HINT_ATTR);
	}
	return next;
}

// An id for each split, from the order Beans first saw them in. A split
// keeps its element while it's open, wherever it moves.
const groupIds = new WeakMap<Element, number>();
let nextGroupId = 1;

function tabParts(tab: HTMLElement): TabParts<HTMLElement> {
	const group = tab.closest(SELECTORS.editorGroup);
	let id = group ? groupIds.get(group) : 0;
	if (id === undefined && group) {
		id = nextGroupId++;
		groupIds.set(group, id);
	}
	return {
		tab,
		group: id ?? 0,
		name: tab.getAttribute(SELECTORS.tabNameAttribute),
		label: tab.textContent?.trim() ?? "",
	};
}

/**
 * Switches to the tab with this hint, in whichever split it is, scrolled
 * into its strip or not. Returns whether there was one.
 */
export function slot(hint: string): boolean {
	const tab = document.querySelector<HTMLElement>(`${SELECTORS.tab}[${TAB_HINT_ATTR}="${CSS.escape(hint)}"]`);
	if (!tab) {
		console.log(`[beans] no tab with hint "${hint}"`);
		return false;
	}
	// VS Code opens a tab's editor on mousedown, even while the tab is
	// scrolled out of its strip. The click goes to the label, so it can't
	// land on the tab's close button.
	clickElement(tab.querySelector<HTMLElement>(SELECTORS.tabLabel) ?? tab);
	console.log(`[beans] switched to tab "${hint}"`);
	return true;
}
