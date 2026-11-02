import { describe, expect, test } from "vite-plus/test";
import { rowKeys, type RowKey } from "../src/page/row-keys";

// A frame of rows: [element, base, index]. Elements are plain strings here.
type Frame = [string, string, string | null][];

// Runs rowKeys over frames, from no previous frame, and returns each frame's
// keys in screen order.
function keysOverFrames(frames: Frame[]): string[][] {
	let previous = new Map<string, RowKey>();
	return frames.map((frame) => {
		previous = rowKeys(
			frame.map(([row, base, index]) => ({ row, base, index })),
			previous,
		);
		return [...previous.values()].map(({ key }) => key);
	});
}

describe("rowKeys", () => {
	test("rows that look alike get #2, #3 in screen order", () => {
		const [keys] = keysOverFrames([
			[
				["e1", "f.ts", "0"],
				["e2", "g.ts", "1"],
				["e3", "f.ts", "2"],
				["e4", "f.ts", "3"],
			],
		]);
		expect(keys).toEqual(["f.ts", "g.ts", "f.ts#2", "f.ts#3"]);
	});

	test("a row keeps its #2 when the row that looks like it goes", () => {
		// Staged f.ts (e2) and unstaged f.ts (e4); collapsing Staged Changes
		// removes e2 and moves e4 up.
		const [, after] = keysOverFrames([
			[
				["e1", "Staged", "0"],
				["e2", "f.ts", "1"],
				["e3", "Changes", "2"],
				["e4", "f.ts", "3"],
			],
			[
				["e1", "Staged", "0"],
				["e3", "Changes", "1"],
				["e4", "f.ts", "2"],
			],
		]);
		expect(after).toEqual(["Staged", "Changes", "f.ts#2"]);
	});

	test("a row whose text changes in place keeps its key", () => {
		const [, streaming] = keysOverFrames([[["e1", "Hello", "0"]], [["e1", "Hello, world", "0"]]]);
		expect(streaming).toEqual(["Hello"]);
	});

	test("an element reused at another place for another item gets that item's key", () => {
		// Scrolling down one row: e1 leaves the top and comes back at the bottom for c.txt.
		const [, scrolled] = keysOverFrames([
			[
				["e1", "a.txt", "0"],
				["e2", "b.txt", "1"],
			],
			[
				["e2", "b.txt", "1"],
				["e1", "c.txt", "2"],
			],
		]);
		expect(scrolled).toEqual(["b.txt", "c.txt"]);
	});

	test("a row that comes back in a new element gets its plain key back", () => {
		const [, , back] = keysOverFrames([[["e1", "a.txt", "0"]], [["e2", "b.txt", "1"]], [["e3", "a.txt", "0"]]]);
		expect(back).toEqual(["a.txt"]);
	});

	test("rows outside a list's numbering keep their key while their element stays", () => {
		const [, renamed] = keysOverFrames([[["header", "Outline", null]], [["header", "Outline (3)", null]]]);
		expect(renamed).toEqual(["Outline"]);
	});
});
