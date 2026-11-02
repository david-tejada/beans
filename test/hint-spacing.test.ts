import { describe, expect, test } from "vite-plus/test";
import { hintSpacingRule, toHintSpacing } from "../src/hint-spacing";

describe("hintSpacingRule", () => {
	test("sets the variables for each spacing", () => {
		expect(hintSpacingRule("compact")).toBe(":root { --beans-hint-width: 2.5em; --beans-gap: 1px; }");
		expect(hintSpacingRule("default")).toBe(":root { --beans-hint-width: 2.75em; --beans-gap: 3px; }");
		expect(hintSpacingRule("comfortable")).toBe(":root { --beans-hint-width: 3em; --beans-gap: 6px; }");
	});

	test("falls back to the default for anything else, including Object.prototype names", () => {
		expect(hintSpacingRule("huge")).toBe(hintSpacingRule("default"));
		expect(hintSpacingRule("constructor")).toBe(hintSpacingRule("default"));
	});
});

describe("toHintSpacing", () => {
	test("names the three spacings and nothing else", () => {
		expect(toHintSpacing("compact")).toBe("compact");
		expect(toHintSpacing("default")).toBe("default");
		expect(toHintSpacing("comfortable")).toBe("comfortable");
		expect(toHintSpacing("tight")).toBe("default");
		expect(toHintSpacing("toString")).toBe("default");
	});
});
