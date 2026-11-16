import { describe, expect, test } from "vite-plus/test";
import { selectionMayRunPast, type ListFacts, type RowFacts } from "../src/page/selection-may-run-past";

// A list of rendered rows from a string, top to bottom: "." a row, "s" a
// selected row, and "h" a selected row that's rendered but hidden.
function rows(pattern: string): RowFacts[] {
	return pattern.split("").map((c) => ({ selected: c !== ".", shown: c !== "h" }));
}

function list(pattern: string, facts: Partial<ListFacts> = {}): ListFacts {
	return { rows: rows(pattern), single: false, multiple: true, moreAbove: true, moreBelow: true, ...facts };
}

describe("selectionMayRunPast", () => {
	test("is true for a selected row at the bottom edge with rows below", () => {
		// A Shift range that ends there, or select-all with the focus there:
		// the DOM can't tell them apart.
		expect(selectionMayRunPast(list("...sssss"))).toBe(true);
	});

	test("is true for a selected row at the top edge with rows above", () => {
		expect(selectionMayRunPast(list("sssss..."))).toBe(true);
	});

	test("is true for select-all in a list scrolled to the top", () => {
		expect(selectionMayRunPast(list("ssssssss", { moreAbove: false }))).toBe(true);
	});

	test("is false at an edge with nothing beyond it", () => {
		expect(selectionMayRunPast(list("..ssssss", { moreBelow: false }))).toBe(false);
		expect(selectionMayRunPast(list("ssssss..", { moreAbove: false }))).toBe(false);
	});

	test("is false for a selection in the middle of the list", () => {
		expect(selectionMayRunPast(list("..ssss.."))).toBe(false);
	});

	test("is false when the list says one row is selected, even at an edge", () => {
		expect(selectionMayRunPast(list(".......s", { single: true, multiple: false }))).toBe(false);
	});

	test("is true when the list says several rows are selected and one shows", () => {
		expect(selectionMayRunPast(list("...s....", { moreAbove: false, moreBelow: false }))).toBe(true);
	});

	test("is true when a selected row is rendered but hidden", () => {
		expect(selectionMayRunPast(list("h.sss...", { multiple: false }))).toBe(true);
	});
});
