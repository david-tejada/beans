import { describe, expect, test } from "vite-plus/test";
import { hintStyleRule, isHintStyle } from "../src/hint-style";

describe("hintStyleRule", () => {
	test("sets the variables for a known style", () => {
		expect(hintStyleRule("compact")).toBe(":root { --beans-hint-width: 2.5em; --beans-gap: 1px; }");
	});

	test("falls back to the default for anything else, including Object.prototype names", () => {
		expect(hintStyleRule("default")).toBe(":root { --beans-hint-width: 3em; --beans-gap: 6px; }");
		expect(hintStyleRule("huge")).toBe(hintStyleRule("default"));
		expect(hintStyleRule("constructor")).toBe(hintStyleRule("default"));
	});
});

describe("isHintStyle", () => {
	test("knows the two styles", () => {
		expect(isHintStyle("default")).toBe(true);
		expect(isHintStyle("compact")).toBe(true);
		expect(isHintStyle("toString")).toBe(false);
	});
});
