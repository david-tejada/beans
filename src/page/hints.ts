const LETTERS = "abcdefghijklmnopqrstuvwxyz";

/** The hint for the row at this index among the sidebar rows: a…z, then aa, ab… */
export function letterHint(index: number): string {
	if (index < LETTERS.length) return LETTERS[index]!;
	const rest = index - LETTERS.length;
	return LETTERS[Math.floor(rest / LETTERS.length) % LETTERS.length]! + LETTERS[rest % LETTERS.length]!;
}

/** The hint for the row at this index of a quick pick: 1, 2… */
export function numberHint(index: number): string {
	return String(index + 1);
}

/** Whether a hint is a quick pick's number rather than a sidebar row's letters. */
export function isNumberHint(hint: string): boolean {
	return /^\d+$/.test(hint);
}
