import { describe, expect, test } from "vite-plus/test";
import { selectionMayRunPast, type ListFacts, type RowFacts } from "../src/page/selection-may-run-past";

// A list of rendered rows from a string, top to bottom: "." a row, "s" a
// selected row, "f" the focused row, "F" the focused row selected, and
// "h" a selected row that's rendered but hidden.
function rows(pattern: string): RowFacts[] {
	return pattern.split("").map((c) => ({
		selected: "sFh".includes(c),
		shown: c !== "h",
		focused: "fF".includes(c),
	}));
}

function list(pattern: string, facts: Partial<ListFacts> = {}): ListFacts {
	return { rows: rows(pattern), single: false, multiple: true, moreAbove: true, moreBelow: true, ...facts };
}

describe("selectionMayRunPast", () => {
	test("is false when a Shift range ends at the focused row on the bottom edge", () => {
		expect(selectionMayRunPast(list("...ssssF"))).toBe(false);
	});

	test("is false when a Shift range ends at the focused row on the top edge", () => {
		expect(selectionMayRunPast(list("Fsss...."))).toBe(false);
	});

	test("is true when a Shift range scrolled its start off the top", () => {
		expect(selectionMayRunPast(list("ssssF..."))).toBe(true);
	});

	test("is true for select-all, which leaves the focus where it was", () => {
		expect(selectionMayRunPast(list("sssFssss", { moreAbove: false }))).toBe(true);
	});

	test("is true when the focus went to a row Cmd+clicked beyond the edge", () => {
		// The focused row is past the bottom, not rendered.
		expect(selectionMayRunPast(list("..ssssss"))).toBe(true);
	});

	test("is false at an edge with nothing beyond it", () => {
		expect(selectionMayRunPast(list("..ssssss", { moreBelow: false }))).toBe(false);
	});

	test("is false for a selection in the middle of the list", () => {
		expect(selectionMayRunPast(list("..sssF.."))).toBe(false);
	});

	test("is false when the list says one row is selected, even at an edge", () => {
		expect(selectionMayRunPast(list(".......s", { single: true, multiple: false }))).toBe(false);
	});

	test("is true when the list says several rows are selected and one shows", () => {
		expect(selectionMayRunPast(list("...s....", { moreAbove: false, moreBelow: false }))).toBe(true);
	});

	test("is true when a selected row is rendered but hidden", () => {
		expect(selectionMayRunPast(list("h.ssF...", { multiple: false }))).toBe(true);
	});
});
