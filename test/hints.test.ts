import { describe, expect, test } from "vite-plus/test";
import { isNumberHint, letterHint, numberHint, stableLetterHints } from "../src/page/hints";

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

// Runs stableLetterHints over frames of on-screen keys, from an empty
// memory, and returns each frame's letters in screen order.
function lettersOverFrames(frames: string[][]): string[][] {
	let memory = new Map<string, string>();
	return frames.map((onScreen) => {
		memory = stableLetterHints(onScreen, memory);
		return onScreen.map((key) => memory.get(key) ?? "");
	});
}

const keys = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => `${prefix}${i}`);

describe("stableLetterHints", () => {
	test("first frame: letters in screen order", () => {
		expect(lettersOverFrames([["dir", "a.txt", "b.txt"]])).toEqual([["a", "b", "c"]]);
	});

	test("rows on screen keep their letters when rows appear above them", () => {
		const [, after] = lettersOverFrames([
			["dir", "a.txt", "b.txt"],
			["dir", "c.txt", "d.txt", "a.txt", "b.txt"],
		]);
		expect(after).toEqual(["a", "d", "e", "b", "c"]);
	});

	test("a row that leaves and comes back gets its old letter", () => {
		const [, , back] = lettersOverFrames([
			["dir", "c.txt", "d.txt", "a.txt"],
			["dir", "a.txt"],
			["dir", "c.txt", "d.txt", "a.txt"],
		]);
		expect(back).toEqual(["a", "b", "c", "d"]);
	});

	test("a new row skips the letters of rows that left", () => {
		const [, , withNew] = lettersOverFrames([["x", "y", "z"], ["z"], ["z", "new"]]);
		expect(withNew).toEqual(["c", "d"]);
	});

	test("a row scrolled far away gets its old letter back", () => {
		// A 20-row view scrolling one row at a time down 60 rows and back up.
		const rows = keys("row", 80);
		const tops = [...Array.from({ length: 61 }, (_, top) => top), ...Array.from({ length: 61 }, (_, i) => 60 - i)];
		const frames = lettersOverFrames(tops.map((top) => rows.slice(top, top + 20)));
		expect(frames.at(-1)).toEqual(frames[0]);
	});

	test("once every single letter is taken, a new row gets a pair", () => {
		const [, , withNew, returned] = lettersOverFrames([keys("first", 20), keys("second", 6), ["new"], ["first0"]]);
		expect(withNew).toEqual(["aa"]);
		expect(returned).toEqual(["a"]);
	});

	test("once every letter up to zz is taken, a new row takes the letter of the row that left longest ago", () => {
		const [, , withNew, returned] = lettersOverFrames([
			keys("first", 26),
			keys("second", 26 * 26),
			["new"],
			["first0"],
		]);
		expect(withNew).toEqual(["a"]);
		// first0 lost "a" and comes back with the letter of the next row gone longest.
		expect(returned).toEqual(["b"]);
	});

	test("switching a sidebar to another view container forgets its letters", () => {
		const [, scm, explorerAgain] = lettersOverFrames([
			["explorer|a.txt", "explorer|b.txt", "explorer|c.txt"],
			["scm|change"],
			["explorer|c.txt"],
		]);
		expect(scm).toEqual(["a"]);
		expect(explorerAgain).toEqual(["a"]);
	});

	test("switching one sidebar keeps the other sidebar's letters", () => {
		const [, switched] = lettersOverFrames([
			["explorer|a.txt", "chat|session"],
			["scm|change", "chat|session"],
		]);
		expect(switched).toEqual(["a", "b"]);
	});

	test("scrolling through thousands of rows never runs out of letters", () => {
		// A 25-row view scrolling one row at a time down 2000 rows and back up.
		const rows = keys("row", 2000);
		const down = Array.from({ length: 1976 }, (_, top) => top);
		const frames = lettersOverFrames([...down, ...down.toReversed()].map((top) => rows.slice(top, top + 25)));
		for (const letters of frames) {
			expect(letters.every((letter) => /^[a-z]{1,2}$/.test(letter))).toBe(true);
			expect(new Set(letters).size).toBe(letters.length);
		}
	});

	test("letters on screen are always distinct", () => {
		const frames = Array.from({ length: 40 }, (_, frame) => keys("row", 60).slice(frame, frame + 20 + (frame % 9)));
		for (const letters of lettersOverFrames(frames)) {
			expect(new Set(letters).size).toBe(letters.length);
			expect(letters.every((letter) => /^[a-z]{1,2}$/.test(letter))).toBe(true);
		}
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
