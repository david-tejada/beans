import { stableLetterHints } from "./hints";
import { rowKeys, type RowKey } from "./row-keys";

/** What tab hints carry from frame to frame: letters by tab key, and each tab element's key. */
export interface TabMemory<Tab> {
	letters: Map<string, string>;
	tabs: Map<Tab, RowKey>;
}

/** An open tab: its element, the split it's in, and the name of what it shows. */
export interface TabParts<Tab> {
	tab: Tab;
	/** An id for the tab's split that stays the same while the split is open. */
	group: number;
	/** The file's name, or VS Code's name for another editor, which doesn't change while it's open. */
	name: string | null;
	/** The text on the tab, for a tab without a name. */
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
	// makes the same file open in two splits two tabs. Tabs with the same
	// name in one split, such as a file and its diff, get "#2"; they can
	// trade letters when one closes, since closing moves tabs into other
	// elements. A file's full path would tell them apart, but VS Code only
	// shows it once a preview tab is kept open, which would change its key.
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
export function tabBase({ group, name, label }: Omit<TabParts<unknown>, "tab">): string {
	return `${group}|${name || label}`;
}
