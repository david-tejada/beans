import { describe, expect, test } from "vite-plus/test";
import { scrollLines, type LinesView } from "../src/page/scroll-lines";

// A Monaco editor's scrolling, as VS Code 1.90.2's and 1.144.1's bundles
// do it. A wheel event moves the scroll position by
// ceilAwayFromZero(50 * sensitivity * wheelDeltaY / 120) pixels, where
// wheelDeltaY is the event's deltaY cut to a whole number and, as it reads
// for a synthetic event, the opposite of a real wheel's; 1.90 also divides
// by the screen's pixel ratio. The position is a whole number of pixels,
// between 0 and the end. style.top is minus the position, plus Monaco's
// shift: past each 500,000px of the top line's offset, the multiple of
// 500,000 rounded down to whole lines.
interface FakeEditor extends LinesView {
	top: number;
	events: number;
}

function fakeEditor({ top, end, lineHeight, ratio }: { top: number; end: number; lineHeight: number; ratio: number }) {
	const shift = (position: number) => {
		const lineTop = Math.floor(position / lineHeight) * lineHeight;
		return Math.floor((Math.floor(lineTop / SHIFT) * SHIFT) / lineHeight) * lineHeight;
	};
	const editor: FakeEditor = {
		top,
		events: 0,
		settled: () => Promise.resolve(editor.top - shift(editor.top)),
		wheel(deltaY) {
			editor.events += 1;
			const pixels = ratio * Math.trunc(-deltaY);
			const move = pixels < 0 ? Math.floor(pixels) : Math.ceil(pixels);
			editor.top = Math.min(end, Math.max(0, editor.top + move));
		},
		gone: () => false,
	};
	return editor;
}

const SHIFT = 500_000;
const LINE_HEIGHTS = [16, 18, 19, 20, 22, 25];
const PAGE_LINES = [5, 9, 23, 39, 60];
// Pixels per unit of wheelDeltaY: editor.mouseWheelScrollSensitivity 0.25,
// 0.5, 1 (the default), 2 and 3, and VS Code 1.90 at a pixel ratio of 2.
const RATIOS = {
	"0.25": 50 / 480,
	"0.5": 50 / 240,
	"1": 50 / 120,
	"2": 100 / 120,
	"3": 150 / 120,
	"1.90 Retina": 50 / 240,
};

async function scrollFrom(top: number, end: number, lineHeight: number, ratio: number, distance: number) {
	const editor = fakeEditor({ top, end, lineHeight, ratio });
	await scrollLines(editor, distance, lineHeight);
	return editor;
}

// Starts around the first five shifts: from more than a page before to
// more than a page after, so that the first event, the second or neither
// crosses, on the line grid and off it.
function startsAroundShifts(lineHeight: number, distance: number): number[] {
	const starts: number[] = [];
	for (let multiple = 1; multiple <= 5; multiple++) {
		const crossing = Math.ceil((multiple * SHIFT) / lineHeight) * lineHeight;
		for (let offset = -distance * 2; offset <= distance * 2; offset += Math.ceil(distance / 7)) {
			starts.push(crossing + offset, crossing + offset + 7);
		}
	}
	return starts;
}

describe("scrollLines", () => {
	test("lands exactly a page away, in whole lines, across Monaco's shifts", async () => {
		const misses: string[] = [];
		let runs = 0;
		for (const lineHeight of LINE_HEIGHTS) {
			for (const lines of PAGE_LINES) {
				for (const [name, ratio] of Object.entries(RATIOS)) {
					for (const direction of [1, -1]) {
						const distance = direction * lines * lineHeight;
						for (const top of [3_000, 3_007, ...startsAroundShifts(lineHeight, Math.abs(distance))]) {
							const editor = await scrollFrom(top, 1e9, lineHeight, ratio, distance);
							runs += 1;
							const off = editor.top - (top + distance);
							// A ratio over 1 moves at least 2px an event, so the last pixel can't be had.
							const allowed = ratio > 1 ? 1 : 0;
							if (Math.abs(off) > allowed)
								misses.push(`${lineHeight}px lines, ${lines} lines, ${name}: ${top} by ${distance} is ${off} off`);
						}
					}
				}
			}
		}
		expect(runs).toBeGreaterThan(30_000);
		expect(misses.slice(0, 40)).toEqual([]);
	});

	test("stops at the end it reaches first", async () => {
		const misses = await endMisses((page, lineHeight) => [
			page * 3,
			page * 3 + 7,
			// A view that can scroll less than a page.
			page - lineHeight,
			// Well past a shift.
			Math.ceil((2 * SHIFT) / lineHeight) * lineHeight + page * 2 + 5,
		]);
		expect(
			misses
				.filter(({ off }) => off !== 0)
				.map(({ what }) => what)
				.slice(0, 20),
		).toEqual([]);
	});

	// A scroll that crosses a shift and stops at an end can't always tell
	// whether it moved its last line or an end stopped it a line short:
	// both leave style.top the same. It stops within a line of the end.
	test("stops within a line of an end just past a shift", async () => {
		const misses = await endMisses((_page, lineHeight) =>
			[1, 2].flatMap((multiple) => {
				const crossing = Math.ceil((multiple * SHIFT) / lineHeight) * lineHeight;
				return [crossing, crossing + 5, crossing + lineHeight + 3];
			}),
		);
		const worst = misses.reduce((most, miss) =>
			miss.off / miss.lineHeight > most.off / most.lineHeight ? miss : most,
		);
		expect(worst.off < worst.lineHeight ? "" : worst.what).toBe("");
	});
});

interface EndMiss {
	what: string;
	off: number;
	lineHeight: number;
}

// Scrolls a page down towards each end and up from it, and up towards the
// top, from on the end to a page and a half away, and says how far off each landed: 0 where it
// should, at the end or, short of one, a page away (give or take the
// pixel a ratio over 1 can't have).
async function endMisses(ends: (page: number, lineHeight: number) => number[]): Promise<EndMiss[]> {
	const misses: EndMiss[] = [];
	for (const lineHeight of LINE_HEIGHTS) {
		for (const lines of PAGE_LINES) {
			for (const [name, ratio] of Object.entries(RATIOS)) {
				const page = lines * lineHeight;
				for (const end of ends(page, lineHeight)) {
					// Starts from on the end to a page and a half from it.
					for (let before = 0; before <= page * 1.5; before += Math.ceil(page / 9)) {
						for (const [top, distance] of [
							[Math.max(0, end - before), page],
							[Math.max(0, end - before), -page],
							[Math.min(end, before), -page],
						] as const) {
							const editor = await scrollFrom(top, end, lineHeight, ratio, distance);
							const want = Math.min(end, Math.max(0, top + distance));
							const allowed = want === 0 || want === end || ratio <= 1 ? 0 : 1;
							const off = Math.abs(editor.top - want);
							misses.push({
								what: `${lineHeight}px, ${lines} lines, ${name}: ${top} by ${distance} to ${editor.top}, not ${want} (end ${end})`,
								off: off > allowed ? off : 0,
								lineHeight,
							});
						}
					}
				}
			}
		}
	}
	return misses;
}

describe("scrollLines, when the editor changes", () => {
	test("stops when the editor goes away or switches files", async () => {
		const editor = fakeEditor({ top: 3_000, end: 1e9, lineHeight: 18, ratio: 50 / 120 });
		let events = 0;
		const view: LinesView = {
			settled: () => editor.settled(),
			wheel: (deltaY) => {
				events += 1;
				editor.wheel(deltaY);
			},
			gone: () => events >= 1,
		};
		await scrollLines(view, 702, 18);
		expect(events).toBe(1);
	});
});
