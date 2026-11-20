import { describe, expect, test } from "vite-plus/test";
import {
	hintFrom,
	resizeRequestFrom,
	scrollChannelText,
	scrollDirectionFrom,
	scrollPlaceFrom,
	scrollRequestFrom,
	targetFrom,
} from "../src/requests";

describe("hintFrom", () => {
	test("keeps letters and digits, lower case", () => {
		expect(hintFrom("AB")).toBe("ab");
		expect(hintFrom(" a-b 3 ")).toBe("ab3");
		expect(hintFrom(12)).toBe("12");
	});

	test("is empty for nothing", () => {
		expect(hintFrom(undefined)).toBe("");
		expect(hintFrom(null)).toBe("");
		expect(hintFrom("--")).toBe("");
	});
});

describe("scrollDirectionFrom", () => {
	test("accepts the four directions and nothing else", () => {
		expect(scrollDirectionFrom("up")).toBe("up");
		expect(scrollDirectionFrom("bottom")).toBe("bottom");
		expect(scrollDirectionFrom("sideways")).toBeNull();
		expect(scrollDirectionFrom(undefined)).toBeNull();
	});
});

describe("scrollPlaceFrom", () => {
	test("is the document when nothing is named", () => {
		expect(scrollPlaceFrom("")).toBe("document");
		expect(scrollPlaceFrom(undefined)).toBe("document");
		expect(scrollPlaceFrom(null)).toBe("document");
		expect(scrollPlaceFrom("document")).toBe("document");
	});

	test("accepts the splits and the sidebar", () => {
		expect(scrollPlaceFrom("left")).toBe("left");
		expect(scrollPlaceFrom("right")).toBe("right");
		expect(scrollPlaceFrom("bar")).toBe("bar");
	});

	test("is null for anything else", () => {
		expect(scrollPlaceFrom("side")).toBeNull();
		expect(scrollPlaceFrom("up")).toBeNull();
		expect(scrollPlaceFrom(2)).toBeNull();
	});
});

describe("scrollChannelText and scrollRequestFrom", () => {
	test("carry a scroll from the host to the page", () => {
		const requests = [
			{ direction: "down", hint: "", place: "document" },
			{ direction: "up", hint: "", place: "left" },
			{ direction: "bottom", hint: "", place: "right" },
			{ direction: "top", hint: "", place: "bar" },
			{ direction: "up", hint: "ab", place: "document" },
		] as const;
		for (const request of requests) {
			expect(scrollRequestFrom(scrollChannelText(request))).toEqual(request);
		}
	});

	test("keep only a hint's letters", () => {
		expect(scrollChannelText({ direction: "down", hint: "A-b3", place: "document" })).toBe("down-ab-document");
	});

	test("read text from before the place was added as the document", () => {
		expect(scrollRequestFrom("down-ab")).toEqual({ direction: "down", hint: "ab", place: "document" });
	});

	test("is null for text that isn't a scroll", () => {
		expect(scrollRequestFrom("sideways--document")).toBeNull();
		expect(scrollRequestFrom("down--middle")).toBeNull();
	});
});

describe("targetFrom", () => {
	test("keeps hints and ranges", () => {
		expect(targetFrom({ items: [{ hint: "a" }, { from: "b", to: "d" }] })).toEqual({
			items: [{ hint: "a" }, { from: "b", to: "d" }],
		});
	});

	test('keeps "this", on its own and as a range\'s end', () => {
		expect(targetFrom({ items: [{ hint: "this" }, { from: "this", to: "d" }] })).toEqual({
			items: [{ hint: "this" }, { from: "this", to: "d" }],
		});
	});

	test("drops items that aren't hints or ranges", () => {
		expect(targetFrom({ items: [{ hint: "a" }, { from: "b" }, 3] })).toEqual({ items: [{ hint: "a" }] });
	});

	test("is null without usable items", () => {
		expect(targetFrom({ items: [] })).toBeNull();
		expect(targetFrom({ items: [{}] })).toBeNull();
		expect(targetFrom("a")).toBeNull();
		expect(targetFrom(undefined)).toBeNull();
	});
});

describe("resizeRequestFrom", () => {
	test("accepts a part or a hint as the target", () => {
		expect(resizeRequestFrom({ target: "sidebar", by: 2 })).toEqual({ target: "sidebar", by: 2 });
		expect(resizeRequestFrom({ target: { hint: "a" }, to: 300 })).toEqual({ target: { hint: "a" }, to: 300 });
		expect(resizeRequestFrom({ target: "panel", max: true })).toEqual({ target: "panel", max: true });
	});

	test('accepts "this" as the hint', () => {
		expect(resizeRequestFrom({ target: { hint: "this" }, by: -1 })).toEqual({ target: { hint: "this" }, by: -1 });
	});

	test("leaves out amounts of the wrong type", () => {
		expect(resizeRequestFrom({ target: "panel", by: "2", max: "yes" })).toEqual({ target: "panel" });
	});

	test("is null without a target", () => {
		expect(resizeRequestFrom({ target: "editor" })).toBeNull();
		expect(resizeRequestFrom({ target: { hints: "a" } })).toBeNull();
		expect(resizeRequestFrom(null)).toBeNull();
	});
});
