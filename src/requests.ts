import { isRecord } from "./shared/guards";
import type { ResizeRequest, ResizeTarget, Target, TargetItem } from "./shared/types";

export { isRecord };

// Talon's requests arrive through command-server as plain JSON, so each is
// checked here, once, and the rest of the extension trusts the types.

/** A hint's letters or digits from whatever Talon sent, lower case; "" when there are none. */
export function hintFrom(value: unknown): string {
	const text = typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
	return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export const SCROLL_DIRECTIONS = ["up", "down", "top", "bottom"] as const;
export type ScrollDirection = (typeof SCROLL_DIRECTIONS)[number];

export function scrollDirectionFrom(value: unknown): ScrollDirection | null {
	return SCROLL_DIRECTIONS.find((direction) => direction === value) ?? null;
}

/** The target in a command's arguments, or null when there isn't a usable one. */
export function targetFrom(value: unknown): Target | null {
	if (!isRecord(value) || !Array.isArray(value.items)) return null;
	const items = value.items.filter(isTargetItem);
	return items.length ? { items } : null;
}

function isTargetItem(value: unknown): value is TargetItem {
	if (!isRecord(value)) return false;
	if (typeof value.hint === "string") return true;
	return typeof value.from === "string" && typeof value.to === "string";
}

/** A resize request, or null when it names no target. */
export function resizeRequestFrom(value: unknown): ResizeRequest | null {
	if (!isRecord(value)) return null;
	const { by, to, max } = value;
	const target = resizeTargetFrom(value.target);
	if (!target) return null;
	return {
		target,
		...(typeof by === "number" && { by }),
		...(typeof to === "number" && { to }),
		...(max === true && { max }),
	};
}

function resizeTargetFrom(value: unknown): ResizeTarget | null {
	if (value === "sidebar" || value === "secondary" || value === "panel") return value;
	if (isRecord(value) && typeof value.hint === "string") return { hint: value.hint };
	return null;
}
