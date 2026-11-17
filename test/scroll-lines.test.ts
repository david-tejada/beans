import { describe, expect, test } from "vite-plus/test";
import { linesSettled, scrollLines, type LinesView } from "../src/page/scroll-lines";

// A Monaco editor's scrolling, as VS Code 1.90.2's and 1.144.1's bundles
// do it. A wheel event moves the scroll position by
// ceilAwayFromZero(50 * ((wheelDeltaY / 120) * sensitivity)) pixels, in
// that order, since the float rounding of another order can differ by a
// pixel, where wheelDeltaY is the event's deltaY cut to a whole number and,
// as it reads for a synthetic event, the opposite of a real wheel's; 1.90
// also divides by the screen's pixel ratio. The position is a whole number
// of pixels, between 0 and the end. style.top is minus the position, plus
// Monaco's shift: past each 500,000px of the top line's offset, the
// multiple of 500,000 rounded down to whole lines.
interface FakeEditor extends LinesView {
	top: number;
	events: number;
}

/** editor.mouseWheelScrollSensitivity, and the screen's pixel ratio where VS Code 1.90 divides by it. */
interface Wheel {
	sensitivity: number;
	pixelRatio: number;
}

function fakeEditor({ top, end, lineHeight, wheel }: { top: number; end: number; lineHeight: number; wheel: Wheel }) {
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
			const pixels = -(50 * ((Math.trunc(deltaY) / (120 * wheel.pixelRatio)) * wheel.sensitivity));
			const move = pixels < 0 ? Math.floor(pixels) : Math.ceil(pixels);
			editor.top = Math.min(end, Math.max(0, editor.top + move));
		},
		gone: () => false,
	};
	return editor;
}

const SHIFT = 500_000;
const LINE_HEIGHTS = [16, 18, 19, 20, 22, 25];
const PAGE_LINES = [1, 2, 3, 5, 9, 23, 39, 60];
// Sensitivities from 0.1 to 5 (1 is the default), and VS Code 1.90 at the
// pixel ratios of a Mac's screen and common Windows scales.
const WHEELS: Record<string, Wheel> = {
	"0.1": { sensitivity: 0.1, pixelRatio: 1 },
	"0.25": { sensitivity: 0.25, pixelRatio: 1 },
	"0.5": { sensitivity: 0.5, pixelRatio: 1 },
	"1": { sensitivity: 1, pixelRatio: 1 },
	"2": { sensitivity: 2, pixelRatio: 1 },
	"3": { sensitivity: 3, pixelRatio: 1 },
	"4": { sensitivity: 4, pixelRatio: 1 },
	"5": { sensitivity: 5, pixelRatio: 1 },
	"1.90 at 2x": { sensitivity: 1, pixelRatio: 2 },
	"1.90 at 1.25x": { sensitivity: 1, pixelRatio: 1.25 },
	"1.90 at 1.5x": { sensitivity: 1, pixelRatio: 1.5 },
};

// As the README says: from a sensitivity of 2.4 (times the pixel ratio, on
// 1.90), where a unit of wheelDeltaY moves a pixel or more, every event
// moves at least two pixels, so a scroll can land a pixel off; from 4.8,
// where every event moves at least three, two. At 0.1 or less, a scroll
// can run out of events a pixel short.
function allowance({ sensitivity, pixelRatio }: Wheel): number {
	const ratio = sensitivity / pixelRatio;
	return ratio >= 4.8 ? 2 : ratio >= 2.4 || ratio <= 0.1 ? 1 : 0;
}

async function scrollFrom(top: number, end: number, lineHeight: number, wheel: Wheel, distance: number) {
	const editor = fakeEditor({ top, end, lineHeight, wheel });
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
				for (const [name, wheel] of Object.entries(WHEELS)) {
					for (const direction of [1, -1]) {
						const distance = direction * lines * lineHeight;
						for (const top of [3_000, 3_007, ...startsAroundShifts(lineHeight, Math.abs(distance))]) {
							const editor = await scrollFrom(top, 1e9, lineHeight, wheel, distance);
							runs += 1;
							const off = editor.top - (top + distance);
							if (Math.abs(off) > allowance(wheel))
								misses.push(`${lineHeight}px lines, ${lines} lines, ${name}: ${top} by ${distance} is ${off} off`);
						}
					}
				}
			}
		}
		expect(runs).toBeGreaterThan(100_000);
		expect(misses.slice(0, 40)).toEqual([]);
	});

	test("lands exactly where Monaco's float rounding adds a pixel to a move", async () => {
		// The second event, of 264 units, comes to 220.00000000000003px, which
		// Monaco rounds up to 221.
		const editor = await scrollFrom(1_998_703, 1e9, 22, { sensitivity: 2, pixelRatio: 1 }, 1_320);
		expect(editor.top).toBe(1_998_703 + 1_320);
	});

	test("lands a page from an end that stopped an event, at a high sensitivity", async () => {
		const wheel = { sensitivity: 5, pixelRatio: 1 };
		expect((await scrollFrom(1_811, 2_779, 12, wheel, 924)).top).toBe(2_735);
		expect((await scrollFrom(968, 2_779, 12, wheel, -924)).top).toBe(44);
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
// top, from on the end to a page and a half away, and says how far off
// each landed: 0 where it should, at the end or, short of one, a page away
// (give or take the allowance).
async function endMisses(ends: (page: number, lineHeight: number) => number[]): Promise<EndMiss[]> {
	const misses: EndMiss[] = [];
	for (const lineHeight of LINE_HEIGHTS) {
		for (const lines of PAGE_LINES) {
			for (const [name, wheel] of Object.entries(WHEELS)) {
				const page = lines * lineHeight;
				for (const end of ends(page, lineHeight)) {
					// Starts from on the end to a page and a half from it.
					for (let before = 0; before <= page * 1.5; before += Math.ceil(page / 9)) {
						for (const [top, distance] of [
							[Math.max(0, end - before), page],
							[Math.max(0, end - before), -page],
							[Math.min(end, before), -page],
						] as const) {
							const editor = await scrollFrom(top, end, lineHeight, wheel, distance);
							const want = Math.min(end, Math.max(0, top + distance));
							const allowed = want === 0 || want === end ? 0 : allowance(wheel);
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
		const editor = fakeEditor({ top: 3_000, end: 1e9, lineHeight: 18, wheel: { sensitivity: 1, pixelRatio: 1 } });
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

// Readings a frame apart, from a wheel event at time 0.
const frames = (hz: number, positions: number[]) =>
	positions.map((position, index) => ({ time: (index * 1000) / hz, position }));

describe("linesSettled", () => {
	test("settles a frame after a move that arrives whole", () => {
		expect(linesSettled(frames(60, [0, 702]), 0)).toBe(false);
		expect(linesSettled(frames(60, [0, 702, 702]), 0)).toBe(true);
	});

	test("settles after two frames without a move", () => {
		expect(linesSettled(frames(60, [0, 0]), 0)).toBe(false);
		expect(linesSettled(frames(60, [0, 0, 0]), 0)).toBe(true);
	});

	test("waits out a smoothed move's slow ending", () => {
		// Monaco's ease-out at 120Hz, cut to whole pixels: 89 twice, then 90.
		const smoothed = [0, 22, 41, 56, 68, 77, 83, 87, 89, 89];
		expect(linesSettled(frames(120, smoothed), 0)).toBe(false);
		expect(linesSettled(frames(120, [...smoothed, ...Array.from({ length: 10 }, () => 90)]), 0)).toBe(true);
	});

	test("waits out a move that starts a frame late", () => {
		expect(linesSettled(frames(60, [0, 0, 702, 702]), 0)).toBe(false);
		expect(linesSettled(frames(60, [0, 0, 702, 702, 702, 702, 702, 702, 702, 702, 702]), 0)).toBe(true);
	});
});
