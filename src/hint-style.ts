import type { HintStyle } from "./shared/types";

// How wide a hint pill is, and the space on each side of it: between the
// icon or chevron and the pill, and between the pill and the name. "default"
// keeps the 6px VS Code has after an icon.
const HINT_STYLES: Record<HintStyle, { width: string; gap: string }> = {
	default: { width: "3em", gap: "6px" },
	compact: { width: "2.5em", gap: "1px" },
};

/** The CSS rule that sets the hint style's variables. An unknown style gets the default. */
export function hintStyleRule(hintStyle: string): string {
	// A settings.json can hold any string, so only the styles' own names count.
	const { width, gap } = isHintStyle(hintStyle) ? HINT_STYLES[hintStyle] : HINT_STYLES.default;
	return `:root { --beans-hint-width: ${width}; --beans-gap: ${gap}; }`;
}

export function isHintStyle(value: string): value is HintStyle {
	return Object.hasOwn(HINT_STYLES, value);
}
