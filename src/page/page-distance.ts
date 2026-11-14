// How much of a view one scroll moves past: the rest stays in sight, so you
// don't lose your place.
const PAGE_SHARE = 0.8;

/**
 * How far one scroll moves a view this tall whose rows (or lines) are this
 * tall, in pixels: 80% of the view, keeping at least one row in sight, and
 * never less than one row. Rounded down to whole rows, so the row at the
 * top is cut the same way before and after.
 */
export function pageDistance(height: number, rowHeight: number): number {
	const kept = Math.max(height * (1 - PAGE_SHARE), rowHeight);
	const rows = Math.floor((height - kept) / rowHeight + 1e-9);
	return Math.max(rows, 1) * rowHeight;
}
