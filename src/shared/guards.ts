// Narrowing for values that arrive as JSON: from Talon, the relay file, a
// process argument. Both sides of Beans use these in place of `as`.

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
