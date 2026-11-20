import { describe, expect, test } from "vite-plus/test";
import { splitOnSide, type SplitBox } from "../src/page/split-on-side";

const box = (left: number, top: number, right: number, bottom: number): SplitBox => ({ left, top, right, bottom });

describe("splitOnSide", () => {
	test("picks the outer split of two side by side, wherever the focus is", () => {
		const splits = [box(0, 0, 400, 800), box(400, 0, 800, 800)];
		for (const focused of [splits[0] ?? null, splits[1] ?? null, null]) {
			expect(splitOnSide(splits, "left", focused)).toBe(0);
			expect(splitOnSide(splits, "right", focused)).toBe(1);
		}
	});

	test("picks the outer two of three in a row", () => {
		const splits = [box(300, 0, 600, 800), box(0, 0, 300, 800), box(600, 0, 900, 800)];
		expect(splitOnSide(splits, "left", splits[0] ?? null)).toBe(1);
		expect(splitOnSide(splits, "right", splits[0] ?? null)).toBe(2);
	});

	test("picks the one split for either side", () => {
		const splits = [box(0, 0, 800, 800)];
		expect(splitOnSide(splits, "left", null)).toBe(0);
		expect(splitOnSide(splits, "right", null)).toBe(0);
	});

	test("picks the split level with the focused one in a 2x2 grid", () => {
		const [topLeft, topRight, bottomLeft, bottomRight] = [
			box(0, 0, 400, 400),
			box(400, 0, 800, 400),
			box(0, 400, 400, 800),
			box(400, 400, 800, 800),
		];
		const splits = [topLeft, topRight, bottomLeft, bottomRight];
		expect(splitOnSide(splits, "left", bottomRight)).toBe(2);
		expect(splitOnSide(splits, "right", bottomRight)).toBe(3);
		expect(splitOnSide(splits, "left", topRight)).toBe(0);
		expect(splitOnSide(splits, "right", topLeft)).toBe(1);
	});

	test("picks the top of two stacked splits when the focused one is level with both", () => {
		const [tall, upper, lower] = [box(0, 0, 400, 800), box(400, 0, 800, 400), box(400, 400, 800, 800)];
		const splits = [tall, upper, lower];
		expect(splitOnSide(splits, "right", tall)).toBe(1);
		expect(splitOnSide(splits, "right", null)).toBe(1);
		expect(splitOnSide(splits, "right", lower)).toBe(2);
		expect(splitOnSide(splits, "left", lower)).toBe(0);
	});

	test("is -1 without splits", () => {
		expect(splitOnSide([], "left", null)).toBe(-1);
	});
});
