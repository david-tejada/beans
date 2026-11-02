import type { HintSpacing } from "./shared/types";

// How wide a hint pill is, and the space on each side of it: between the
// icon or chevron and the pill, and between the pill and the name. "comfortable"
// keeps the 6px VS Code has after an icon; "default" sits midway.
const HINT_SPACINGS: Record<HintSpacing, { width: string; gap: string }> = {
	compact: { width: "2.5em", gap: "1px" },
	default: { width: "2.75em", gap: "3px" },
	comfortable: { width: "3em", gap: "6px" },
};

/** The CSS rule that sets the spacing's variables. An unknown spacing gets the default. */
export function hintSpacingRule(spacing: string): string {
	const { width, gap } = HINT_SPACINGS[toHintSpacing(spacing)];
	return `:root { --beans-hint-width: ${width}; --beans-gap: ${gap}; }`;
}

/** The spacing a setting's value names, or "default" when it names none. */
export function toHintSpacing(value: string): HintSpacing {
	return isHintSpacing(value) ? value : "default";
}

function isHintSpacing(value: string): value is HintSpacing {
	// A settings.json can hold any string, so only the spacings' own names count.
	return Object.hasOwn(HINT_SPACINGS, value);
}
