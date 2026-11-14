/** What the page sees of one rendered row of a list. */
export interface RowFacts {
	selected: boolean;
	/** On screen, with a hint; a rendered row can be hidden past an edge or under sticky scroll. */
	shown: boolean;
	/** The list's focused row, where a Shift+arrow or Shift+click range ends. */
	focused: boolean;
}

/** What the page sees of a list: its rendered rows, top to bottom, and what it says about its selection. */
export interface ListFacts {
	rows: RowFacts[];
	/** VS Code says how many rows are selected: one, or more than one, wherever they are. */
	single: boolean;
	multiple: boolean;
	/** Whether the list has rows above, and below, the rendered ones. */
	moreAbove: boolean;
	moreBelow: boolean;
}

/**
 * Whether a list's selection may go on past the selected rows on screen.
 * Rows selected one by one, far apart, can't be told apart from a
 * selection that ends on screen, so this says false for them.
 */
export function selectionMayRunPast({ rows, single, multiple, moreAbove, moreBelow }: ListFacts): boolean {
	if (single) return false;
	const shownSelected = rows.filter((row) => row.selected && row.shown).length;
	if (multiple && shownSelected === 1) return true;
	// A selected row that's rendered but hidden: VS Code renders the rows
	// under sticky scroll, Theia a screen's worth past each edge.
	if (rows.some((row) => row.selected && !row.shown)) return true;
	return goesOnFrom(rows[0], moreAbove) || goesOnFrom(rows.at(-1), moreBelow);
}

// A selected row at the edge of what's rendered, with rows beyond it, may
// go on. Unless it's the focused row: a Shift range ends there.
function goesOnFrom(edge: RowFacts | undefined, more: boolean): boolean {
	return edge !== undefined && edge.selected && edge.shown && !edge.focused && more;
}
