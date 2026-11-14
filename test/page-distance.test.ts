import { describe, expect, test } from "vite-plus/test";
import { pageDistance } from "../src/page/page-distance";

describe("pageDistance", () => {
	test("moves 80% of a tall view", () => {
		// A document 50 lines of 18px tall moves 40 lines.
		expect(pageDistance(900, 18)).toBe(720);
		// A sidebar list of 10 rows of 22px moves 8 rows.
		expect(pageDistance(220, 22)).toBe(176);
	});

	test("keeps one row in sight in a short view", () => {
		expect(pageDistance(110, 22)).toBe(88);
		expect(pageDistance(66, 22)).toBe(44);
	});

	test("moves whole rows", () => {
		// 777px of 18px lines: 621.6px is 34.5 lines, so 34.
		expect(pageDistance(777, 18)).toBe(612);
	});

	test("never moves less than one row", () => {
		expect(pageDistance(22, 22)).toBe(22);
		expect(pageDistance(10, 22)).toBe(22);
	});
});
