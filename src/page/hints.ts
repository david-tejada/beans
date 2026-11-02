const LETTERS = "abcdefghijklmnopqrstuvwxyz";

/** The hint for the row at this index among the sidebar rows: a…z, then aa, ab… */
export function letterHint(index: number): string {
	if (index < LETTERS.length) return LETTERS[index]!;
	const rest = index - LETTERS.length;
	return LETTERS[Math.floor(rest / LETTERS.length) % LETTERS.length]! + LETTERS[rest % LETTERS.length]!;
}

// The most rows stable hints remember, on screen or not: every letter hint
// up to zz.
const MEMORY_SIZE = LETTERS.length + LETTERS.length * LETTERS.length;

/**
 * Letters for the sidebar rows on screen, by row key, that stay with a row
 * while its view container (Explorer, Source Control…) stays shown, so a
 * row that scrolls away gets its letter back when it returns. A key starts
 * with its container's id and "|". memory maps each remembered key to its
 * letter, the row that left the screen longest ago first. Returns the new
 * memory, with a letter for every key in onScreen (distinct keys, in screen
 * order).
 */
export function stableLetterHints(onScreen: string[], memory: Map<string, string>): Map<string, string> {
	const shown = new Set(onScreen);
	const containers = new Set(onScreen.map(containerOf));
	// Rows off screen keep their letter while their container is shown;
	// switching a sidebar to another container forgets its letters. A letter
	// is in memory at most once, since a reused letter leaves its old row's
	// entry.
	const away = new Map([...memory].filter(([key]) => !shown.has(key) && containers.has(containerOf(key))));
	const held = new Map<string, string>();
	for (const key of onScreen) {
		const letter = memory.get(key);
		if (letter !== undefined) held.set(key, letter);
	}
	// A new row gets the lowest letter no row has, single letters before
	// pairs. Only once every letter up to zz is taken does it take the
	// letter of the row that left the screen longest ago.
	const used = new Set([...held.values(), ...away.values()]);
	for (const key of onScreen) {
		if (held.has(key)) continue;
		const letter = unusedLetter(used) ?? oldestLetter(away);
		if (letter === undefined) continue;
		held.set(key, letter);
		used.add(letter);
	}
	// The rows on screen go last, so the one that left longest ago is first.
	return new Map([...away, ...held].slice(-MEMORY_SIZE));
}

function containerOf(key: string): string {
	const end = key.indexOf("|");
	return end === -1 ? "" : key.slice(0, end);
}

/** The lowest letter, up to zz, that isn't used. */
function unusedLetter(used: Set<string>): string | undefined {
	for (let index = 0; index < MEMORY_SIZE; index++) {
		const letter = letterHint(index);
		if (!used.has(letter)) return letter;
	}
	return undefined;
}

/** Takes the letter of the row that left the screen longest ago. */
function oldestLetter(away: Map<string, string>): string | undefined {
	const [oldest] = away;
	if (oldest === undefined) return undefined;
	away.delete(oldest[0]);
	return oldest[1];
}

/** The hint for the row at this index of a quick pick: 1, 2… */
export function numberHint(index: number): string {
	return String(index + 1);
}

/** Whether a hint is a quick pick's number rather than a sidebar row's letters. */
export function isNumberHint(hint: string): boolean {
	return /^\d+$/.test(hint);
}
