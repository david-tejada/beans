/** A row's key and what it was made from, kept from frame to frame. */
export interface RowKey {
	key: string;
	/** What the row shows, which rows that look alike share. */
	base: string;
	/** The row's place in its list, or null when the list doesn't say. */
	index: string | null;
}

/**
 * Keys for the rows on screen, in screen order, saying which item each row
 * shows, so stable hints can follow an item from frame to frame. A row is
 * mostly its base, with "#2", "#3"… for rows that look alike. previous is
 * what the last frame returned. indexKeepsItem says whether an element still
 * at the same index shows the same item, as in VS Code's lists, which reuse
 * an element for another item only when it changes place. Theia's trees
 * don't: each index has its own element, which shows whichever item comes
 * to that place, so expanding a folder moves the rows below it into other
 * elements. Without it, a row keeps its key only while its base does, rows
 * with no index too.
 */
export function rowKeys<Row>(
	rows: { row: Row; base: string; index: string | null }[],
	previous: Map<Row, RowKey>,
	indexKeepsItem: boolean,
): Map<Row, RowKey> {
	const keys: (string | undefined)[] = [];
	const used = new Set<string>();
	// A row element still showing the same item keeps its key, so rows that
	// look alike don't swap keys when one of them goes. Where the index keeps
	// the item, an element in the same place whose text changed (a chat answer
	// streaming, a rename) still shows the same item.
	rows.forEach(({ row, base, index }, at) => {
		const before = previous.get(row);
		if (!before || used.has(before.key)) return;
		const samePlace = indexKeepsItem && before.index === index;
		if (before.base !== base && !samePlace) return;
		keys[at] = before.key;
		used.add(before.key);
	});
	rows.forEach(({ base }, at) => {
		if (keys[at] !== undefined) return;
		let key = base;
		for (let count = 2; used.has(key); count++) key = `${base}#${count}`;
		keys[at] = key;
		used.add(key);
	});
	return new Map(rows.map(({ row, base, index }, at) => [row, { key: keys[at]!, base, index }]));
}
