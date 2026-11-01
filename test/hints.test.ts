import { describe, expect, test } from "vite-plus/test";
import { isNumberHint, letterHint, numberHint } from "../src/page/hints";

describe("letterHint", () => {
	test("single letters first, then pairs", () => {
		expect(letterHint(0)).toBe("a");
		expect(letterHint(25)).toBe("z");
		expect(letterHint(26)).toBe("aa");
		expect(letterHint(27)).toBe("ab");
		expect(letterHint(26 + 26)).toBe("ba");
		expect(letterHint(26 + 26 * 26 - 1)).toBe("zz");
	});

	test("every hint up to zz is distinct", () => {
		const hints = Array.from({ length: 26 + 26 * 26 }, (_, i) => letterHint(i));
		expect(new Set(hints).size).toBe(hints.length);
	});
});

describe("numberHint", () => {
	test("counts from 1", () => {
		expect(numberHint(0)).toBe("1");
		expect(numberHint(11)).toBe("12");
	});
});

describe("isNumberHint", () => {
	test("tells quick pick numbers from sidebar letters", () => {
		expect(isNumberHint("12")).toBe(true);
		expect(isNumberHint("ab")).toBe(false);
		expect(isNumberHint("a1")).toBe(false);
	});
});
