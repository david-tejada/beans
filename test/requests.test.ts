import { describe, expect, test } from "vite-plus/test";
import { hintFrom, resizeRequestFrom, scrollDirectionFrom, targetFrom } from "../src/requests";

describe("hintFrom", () => {
	test("keeps letters and digits, lower case", () => {
		expect(hintFrom("AB")).toBe("ab");
		expect(hintFrom(" a-b 3 ")).toBe("ab3");
		expect(hintFrom(12)).toBe("12");
	});

	test("is empty for nothing", () => {
		expect(hintFrom(undefined)).toBe("");
		expect(hintFrom(null)).toBe("");
		expect(hintFrom("--")).toBe("");
	});
});

describe("scrollDirectionFrom", () => {
	test("accepts the four directions and nothing else", () => {
		expect(scrollDirectionFrom("up")).toBe("up");
		expect(scrollDirectionFrom("bottom")).toBe("bottom");
		expect(scrollDirectionFrom("sideways")).toBeNull();
		expect(scrollDirectionFrom(undefined)).toBeNull();
	});
});

describe("targetFrom", () => {
	test("keeps hints and ranges", () => {
		expect(targetFrom({ items: [{ hint: "a" }, { from: "b", to: "d" }] })).toEqual({
			items: [{ hint: "a" }, { from: "b", to: "d" }],
		});
	});

	test("drops items that aren't hints or ranges", () => {
		expect(targetFrom({ items: [{ hint: "a" }, { from: "b" }, 3] })).toEqual({ items: [{ hint: "a" }] });
	});

	test("is null without usable items", () => {
		expect(targetFrom({ items: [] })).toBeNull();
		expect(targetFrom({ items: [{}] })).toBeNull();
		expect(targetFrom("a")).toBeNull();
		expect(targetFrom(undefined)).toBeNull();
	});
});

describe("resizeRequestFrom", () => {
	test("accepts a part or a hint as the target", () => {
		expect(resizeRequestFrom({ target: "sidebar", by: 2 })).toEqual({ target: "sidebar", by: 2 });
		expect(resizeRequestFrom({ target: { hint: "a" }, to: 300 })).toEqual({ target: { hint: "a" }, to: 300 });
		expect(resizeRequestFrom({ target: "panel", max: true })).toEqual({ target: "panel", max: true });
	});

	test("leaves out amounts of the wrong type", () => {
		expect(resizeRequestFrom({ target: "panel", by: "2", max: "yes" })).toEqual({ target: "panel" });
	});

	test("is null without a target", () => {
		expect(resizeRequestFrom({ target: "editor" })).toBeNull();
		expect(resizeRequestFrom({ target: { hints: "a" } })).toBeNull();
		expect(resizeRequestFrom(null)).toBeNull();
	});
});
