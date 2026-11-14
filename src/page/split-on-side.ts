/** Where a split sits on the page, as getBoundingClientRect gives it. */
export interface SplitBox {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

/**
 * Which of the splits is the left one or the right one: the one whose edge
 * is furthest to that side. When several are stacked there, the one level
 * with the focused split, else the top one. Returns its index, or -1 when
 * there are no splits.
 */
export function splitOnSide(splits: SplitBox[], side: "left" | "right", focused: SplitBox | null): number {
	const edge = (split: SplitBox) => (side === "left" ? -split.left : split.right);
	const furthest = Math.max(...splits.map(edge));
	// Splits on one side line up to the pixel, give or take rounding.
	const onSide = splits.flatMap((split, index) => (edge(split) >= furthest - 1 ? [index] : []));
	let best = -1;
	for (const index of onSide) {
		if (best === -1 || isBetter(splits[index], splits[best], focused)) best = index;
	}
	return best;
}

// More of it level with the focused split, then nearer the top.
function isBetter(split: SplitBox | undefined, other: SplitBox | undefined, focused: SplitBox | null): boolean {
	if (!split || !other) return false;
	const level = focused ? overlap(split, focused) - overlap(other, focused) : 0;
	if (Math.abs(level) >= 1) return level > 0;
	return split.top < other.top;
}

// How much of their heights two splits share.
function overlap(a: SplitBox, b: SplitBox): number {
	return Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
}
