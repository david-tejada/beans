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

/**
 * What a scroll moves when it names no hint: the "document" in the focused
 * split, the "left" or "right" split, or the sidebar ("bar").
 */
export type ScrollPlace = "document" | "left" | "right" | "bar";

/** Where to scroll, from Talon's word for it; nothing means the document. Null for a word Beans doesn't know. */
export function scrollPlaceFrom(value: unknown): ScrollPlace | null {
	if (value === undefined || value === null || value === "" || value === "document") return "document";
	if (value === "left" || value === "right" || value === "bar") return value;
	return null;
}

/** A scroll as it travels from the extension host to the page. */
export interface ScrollRequest {
	direction: ScrollDirection;
	/** A sidebar row's letters, or "". */
	hint: string;
	place: ScrollPlace;
}

/**
 * A scroll request as the status bar channel carries it, "down-ab-bar".
 * The hint keeps only its letters: quick pick numbers aren't sidebar rows.
 */
export function scrollChannelText({ direction, hint, place }: ScrollRequest): string {
	return `${direction}-${hintFrom(hint).replace(/[0-9]/g, "")}-${place}`;
}

/** The scroll request in the channel's text, or null when it isn't one. */
export function scrollRequestFrom(text: string): ScrollRequest | null {
	const [direction, hint = "", place] = text.split("-");
	const to = scrollDirectionFrom(direction);
	const where = scrollPlaceFrom(place);
	return to && where ? { direction: to, hint, place: where } : null;
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
