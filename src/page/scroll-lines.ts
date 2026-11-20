/** An editor's lines as scrollLines sees them; scroll.ts gives it the real ones. */
export interface LinesView {
	/** The lines' scroll position, minus style.top, once they've stopped moving. */
	settled(): Promise<number>;
	/** Sends a wheel event with this deltaY. */
	wheel(deltaY: number): void;
	/** Whether the editor went away or switched to another file. */
	gone(): boolean;
}

/**
 * Scrolls an editor's lines by this many pixels (positive is down), a whole
 * number of lines, exactly, or to the end it reaches first.
 *
 * A wheel event moves Monaco's lines by a number of pixels proportional to
 * its deltaY, rounded away from zero, at a ratio that depends on the
 * screen and the settings (and reads with the opposite sign). So this
 * sends one event for the whole distance, measures how far it went, and
 * sends the rest at the ratio it found, a few times at most. An event that
 * moves nothing means the view is at an end, and that's where it stays.
 */
export async function scrollLines(view: LinesView, distance: number, lineHeight: number): Promise<void> {
	const sent: Sent[] = [];
	let position = await view.settled();
	for (let event = 0; event < MAX_EVENTS; event++) {
		if (view.gone()) return;
		const deltaY = event === 0 ? -distance : nextDeltaY(sent, distance, lineHeight, position);
		if (deltaY === 0) return;
		view.wheel(deltaY);
		const now = await view.settled();
		// It moved nothing: the lines are at an end.
		if (now === position) return;
		sent.push({ deltaY, raw: now - position });
		position = now;
	}
}

// Enough for the first event, the rest, a pixel or two after, and now and
// then three more to learn which shift Monaco made.
const MAX_EVENTS = 8;

/** An event sent: its deltaY, and how far style.top moved for it. */
interface Sent {
	deltaY: number;
	raw: number;
}

/**
 * The next event's deltaY, or 0 when the lines are where they should be.
 *
 * In a long file, Monaco keeps style.top small: each time the view passes
 * another 500,000px, it moves the lines back by that much rounded down to
 * whole lines, one of two numbers of lines, depending on which 500,000px
 * it is. An event of a page never moves that far, so a bigger move of
 * style.top is that shift, and a scroll meets one shift at most. Crossing
 * back undoes it, so the lines' move is exact whenever they're on the side
 * they started on. On the other side, it's one of two, a line apart, and
 * the ratio of the events that crossed nothing tells which, if they were
 * big enough. When they weren't, this goes above the shift, and on up,
 * far enough to tell: there's always room above a shift, since the top of
 * the file is 500,000px further up, while below one may be the end.
 */
function nextDeltaY(sent: Sent[], distance: number, lineHeight: number, position: number): number {
	const measured = wheelRatio(sent);
	const shifts = possibleShifts(sent, measured, lineHeight, distance);
	const ratio = measured ?? guessedRatio(sent, shifts[0] ?? 0);
	const crossings = sent.filter(({ raw }) => Math.abs(raw) > MONACO_SHIFT / 2);
	const [crossing] = crossings;
	// Down across a shift, style.top drops by about 500,000px; up, it rises.
	const across = crossings.reduce((sum, { raw }) => sum + Math.sign(raw), 0);
	// An event of this many units narrows the ratio enough that, across the
	// biggest crossing event, its two moves (a line apart) can't both fit,
	// with a pixel and a half to spare for rounding.
	const size = Math.ceil(Math.max(0, ...crossings.map(({ deltaY }) => Math.abs(deltaY))) / (lineHeight / 2 - 1.5));
	const told =
		shifts.length === 1 ||
		sent.some(({ deltaY, raw }) => Math.abs(raw) <= MONACO_SHIFT / 2 && Math.abs(deltaY) >= size);
	if (crossing && !told) {
		// Below the shift after going down across it: back up across it.
		// The shift is within a line of where style.top reads 0; two lines
		// past it, and half again for a guessed ratio, which is harmless there.
		if (across < 0) return deltaYFor(-(position + 2 * lineHeight) * 1.5, ratio.pixels);
		// Above it: on up, away from it (a synthetic event's deltaY is
		// positive going up).
		if (across > 0 || crossing.raw < 0) return size;
	}
	const rest = distance - movedWith(sent, shifts[0] ?? 0);
	// Aim with the largest ratio the events allow, so the move can't pass the rest.
	const aim = ratio.range ? -ratio.range.hi : ratio.pixels;
	return Math.abs(rest) < 0.5 ? 0 : deltaYFor(rest, aim);
}

/**
 * Pixels per unit of deltaY (negative: a synthetic event reads with the
 * opposite sign), with the range the true size lies in, lo to hi, when
 * it's measured.
 */
interface Ratio {
	pixels: number;
	range?: { lo: number; hi: number };
}

/**
 * The ratio, from the events that crossed no shift, or null before there's
 * one. Monaco rounds a move of k * |deltaY| up to a whole pixel, so an
 * event that moved m pixels says k is over (m - 1) / |deltaY| and at most
 * m / |deltaY|; together, the events narrow it. One that an end stopped
 * says less than the truth, and when the ranges don't meet, the biggest
 * event's alone stands.
 */
function wheelRatio(sent: Sent[]): Ratio | null {
	const singles = sent.filter(({ raw }) => Math.abs(raw) <= MONACO_SHIFT / 2);
	if (!singles.length) return null;
	const ranges = singles.map(({ deltaY, raw }) => ({
		lo: (Math.abs(raw) - 1) / Math.abs(deltaY),
		hi: Math.abs(raw) / Math.abs(deltaY),
		units: Math.abs(deltaY),
	}));
	let range = {
		lo: Math.max(...ranges.map(({ lo }) => lo)),
		hi: Math.min(...ranges.map(({ hi }) => hi)),
	};
	if (range.lo >= range.hi) {
		// An end only shortens a move, so an event whose ratio is too low for
		// another's was stopped by one.
		const kept = ranges.filter(({ hi }) => hi >= range.lo);
		range = { lo: Math.max(...kept.map(({ lo }) => lo)), hi: Math.min(...kept.map(({ hi }) => hi)) };
	}
	return { pixels: -(range.lo + range.hi) / 2, range };
}

// Before an event that crossed nothing, the first event's move with the
// likelier shift gives a guess.
function guessedRatio(sent: Sent[], shift: number): Ratio {
	const [first] = sent;
	const pixels = first ? moveOf(first.raw, shift) / first.deltaY : 0;
	return { pixels: pixels < 0 ? pixels : -1 };
}

/**
 * The shifts the lines may have crossed, in whole lines, likelier first:
 * none when they're on the side they started on, else the one the
 * crossing events' moves allow, or both when they allow both.
 */
function possibleShifts(sent: Sent[], ratio: Ratio | null, lineHeight: number, distance: number): number[] {
	if (sent.every(({ raw }) => Math.abs(raw) <= MONACO_SHIFT / 2)) return [0];
	const lines = Math.floor(MONACO_SHIFT / lineHeight);
	const [fewer, more] = [lines * lineHeight, (lines + 1) * lineHeight];
	const both = MONACO_SHIFT - fewer <= more - MONACO_SHIFT ? [fewer, more] : [more, fewer];
	// A synthetic wheel event moves the lines against its deltaY, never with it.
	const shifts = both.filter((shift) =>
		sent.every(({ deltaY, raw }) => Math.sign(moveOf(raw, shift)) !== Math.sign(deltaY)),
	);
	if (shifts.length === 1) return shifts;
	const range = ratio?.range;
	if (!range || shifts.length === 0) return both;
	// An event going back the way the scroll came can't have met an end,
	// so it tells first; one going on may have, and its shorter move could
	// pass for the other shift's.
	const back = sent.filter(({ deltaY }) => Math.sign(deltaY) === Math.sign(distance));
	const on = sent.filter(({ deltaY }) => Math.sign(deltaY) !== Math.sign(distance));
	for (const { deltaY, raw } of [...back, ...on]) {
		if (Math.abs(raw) <= MONACO_SHIFT / 2) continue;
		// The event moved as far as the ratio says, or less where an end
		// stopped it, but never more.
		// Monaco's float arithmetic can round an exact whole number of pixels up one more.
		const most = Math.ceil(range.hi * Math.abs(deltaY)) + 1;
		const least = Math.ceil(range.lo * Math.abs(deltaY));
		const possible = shifts.filter((shift) => Math.abs(moveOf(raw, shift)) <= most);
		const fits = possible.filter((shift) => Math.abs(moveOf(raw, shift)) >= least);
		if (fits.length === 1) return fits;
		if (fits.length === 0 && possible.length === 1) return possible;
	}
	return shifts;
}

function movedWith(sent: Sent[], shift: number): number {
	return sent.reduce((total, { raw }) => total + moveOf(raw, shift), 0);
}

// How far an event moved the lines, if a shift it crossed was this big.
function moveOf(raw: number, shift: number): number {
	return Math.abs(raw) <= MONACO_SHIFT / 2 ? raw : raw - Math.sign(raw) * shift;
}

/**
 * The deltaY that moves the lines this far at this ratio. Monaco rounds a
 * move away from zero, so this aims below the rest by up to one unit's
 * move, which the rounding makes up. When one unit already moves further
 * than the rest, as at a ratio over 1, it's 0: closer can't be had.
 */
function deltaYFor(rest: number, ratio: number): number {
	const units = Math.floor(Math.abs(rest / ratio) + 1e-9);
	if (units === 0) return 0;
	return Math.sign(rest / ratio) * units;
}

const MONACO_SHIFT = 500_000;

/** A reading of the lines' scroll position, and when it was taken, in ms. */
export interface Reading {
	time: number;
	position: number;
}

/**
 * Whether the lines have stopped moving, from a reading before the first
 * frame and one each frame since, after a wheel event sent at wheelTime.
 * Two frames without a change, before any. After a change, a frame
 * without one, as when Monaco moves the lines whole on the next frame.
 * But a move that shows over more than one frame, or starts late, is
 * Monaco smoothing it: over 135ms, easing out and cutting each frame to a
 * whole pixel, so near the end a frame often reads the same as the last
 * one. Then it's done once 150ms have passed since the event.
 */
export function linesSettled(readings: Reading[], wheelTime: number): boolean {
	const changes: number[] = [];
	for (let index = 1; index < readings.length; index++) {
		if (readings[index]?.position !== readings[index - 1]?.position) changes.push(index);
	}
	const last = readings.length - 1;
	const [first] = changes;
	if (first === undefined) return last >= 2;
	if (changes.at(-1) === last) return false;
	const smoothed = changes.length > 1 || first > 1;
	return !smoothed || (readings[last]?.time ?? 0) >= wheelTime + SMOOTHING_MS;
}

// Monaco smooths a wheel over 135ms; a little more, for the last frame.
const SMOOTHING_MS = 150;
