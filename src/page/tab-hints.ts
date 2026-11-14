import { stableLetterHints } from "./hints";
import { rowKeys, type RowKey } from "./row-keys";

/** What tab hints carry from frame to frame: letters by tab key, and each tab element's key. */
export interface TabMemory<Tab> {
	letters: Map<string, string>;
	tabs: Map<Tab, RowKey>;
}

/** An open tab: its element, the split it's in, and what it shows, the most telling first. */
export interface TabParts<Tab> {
	tab: Tab;
	/** An id for the tab's split that stays the same while the split is open. */
	group: number;
	/** The file's full path, or the editor's name when it shows no file. */
	path: string | null;
	/** The file's name. */
	name: string | null;
	/** The text on the tab. */
	label: string;
}

/**
 * Letters for every open tab, in strip order, that a tab keeps for as long
 * as it's open, whatever the other tabs do. Returns each tab's letters and
 * the memory for the next frame. memory is what the last frame returned.
 */
export function tabHints<Tab>(
	open: TabParts<Tab>[],
	memory: TabMemory<Tab>,
): { hints: Map<Tab, string>; memory: TabMemory<Tab> } {
	// VS Code reuses a tab's element for the next tab when one closes, so a
	// tab is followed by what it shows, not by its element: rowKeys keeps an
	// element's key only while it shows the same thing. The split's id
	// makes the same file open in two splits two tabs.
	const tabs = rowKeys(
		open.map(({ tab, ...parts }) => ({ row: tab, base: tabBase(parts), index: null })),
		memory.tabs,
		false,
	);
	const keys = [...tabs.values()].map(({ key }) => key);
	// Every open tab is "on screen" to stableLetterHints, scrolled out of
	// the strip or not, so the only keys it remembers that aren't here are
	// closed tabs'. Dropping them frees their letters.
	const all = stableLetterHints(keys, memory.letters);
	const letters = new Map(keys.flatMap((key) => (all.has(key) ? [[key, all.get(key)!]] : [])));
	const hints = new Map([...tabs].map(([tab, { key }]) => [tab, letters.get(key) ?? ""]));
	return { hints, memory: { letters, tabs } };
}

/** What a tab shows, as one string that starts with its split's id. */
export function tabBase({ group, path, name, label }: Omit<TabParts<unknown>, "tab">): string {
	return `${group}|${path || name || label}`;
}
