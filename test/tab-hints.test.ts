import { describe, expect, test } from "vite-plus/test";
import { tabBase, tabHints, type TabMemory } from "../src/page/tab-hints";

// A frame of open tabs, in strip order: [element, split, path]. Elements are
// plain strings here; VS Code reuses them, so one can show another file.
type Frame = [string, number, string][];

// Runs tabHints over frames, from an empty memory, and returns each frame's
// hints as "path@split=letters", in strip order.
function hintsOverFrames(frames: Frame[]): string[][] {
	let memory: TabMemory<string> = { letters: new Map(), tabs: new Map() };
	return frames.map((frame) => {
		const result = tabHints(
			frame.map(([tab, group, path]) => ({ tab, group, path, name: null, label: "" })),
			memory,
		);
		memory = result.memory;
		return frame.map(([tab, group, path]) => `${path}@${group}=${result.hints.get(tab)}`);
	});
}

describe("tabHints", () => {
	test("letters the tabs in strip order", () => {
		const [hints] = hintsOverFrames([
			[
				["t1", 1, "/a.ts"],
				["t2", 1, "/b.ts"],
				["t3", 1, "/c.ts"],
			],
		]);
		expect(hints).toEqual(["/a.ts@1=a", "/b.ts@1=b", "/c.ts@1=c"]);
	});

	test("closing a tab leaves the others their letters, though VS Code moves them into other elements", () => {
		// Closing a.ts: t1 now shows b.ts and t2 shows c.ts.
		const [, after] = hintsOverFrames([
			[
				["t1", 1, "/a.ts"],
				["t2", 1, "/b.ts"],
				["t3", 1, "/c.ts"],
			],
			[
				["t1", 1, "/b.ts"],
				["t2", 1, "/c.ts"],
			],
		]);
		expect(after).toEqual(["/b.ts@1=b", "/c.ts@1=c"]);
	});

	test("a closed tab's letter goes to the next tab that opens", () => {
		const [, , reopened] = hintsOverFrames([
			[
				["t1", 1, "/a.ts"],
				["t2", 1, "/b.ts"],
			],
			[["t1", 1, "/b.ts"]],
			[
				["t1", 1, "/b.ts"],
				["t2", 1, "/d.ts"],
			],
		]);
		expect(reopened).toEqual(["/b.ts@1=b", "/d.ts@1=a"]);
	});

	test("a tab opened before the others doesn't move their letters", () => {
		const [, after] = hintsOverFrames([
			[
				["t1", 1, "/a.ts"],
				["t2", 1, "/b.ts"],
			],
			[
				["t1", 1, "/z.ts"],
				["t2", 1, "/a.ts"],
				["t3", 1, "/b.ts"],
			],
		]);
		expect(after).toEqual(["/z.ts@1=c", "/a.ts@1=a", "/b.ts@1=b"]);
	});

	test("the same file in two splits has two letters", () => {
		const [hints] = hintsOverFrames([
			[
				["t1", 1, "/a.ts"],
				["t2", 2, "/a.ts"],
			],
		]);
		expect(hints).toEqual(["/a.ts@1=a", "/a.ts@2=b"]);
	});

	test("past z, tabs get two letters", () => {
		const frame: Frame = Array.from({ length: 28 }, (_, index) => [`t${index}`, 1, `/f${index}.ts`]);
		const [hints] = hintsOverFrames([frame]);
		expect(hints?.slice(25)).toEqual(["/f25.ts@1=z", "/f26.ts@1=aa", "/f27.ts@1=ab"]);
	});
});

describe("tabBase", () => {
	test("is the split and the path, else the name, else the label", () => {
		expect(tabBase({ group: 2, path: "/a/b.ts", name: "b.ts", label: "b.ts" })).toBe("2|/a/b.ts");
		expect(tabBase({ group: 2, path: null, name: "b.ts", label: "b.ts" })).toBe("2|b.ts");
		expect(tabBase({ group: 1, path: "", name: null, label: "Settings" })).toBe("1|Settings");
	});
});
