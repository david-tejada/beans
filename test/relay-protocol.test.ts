import { PassThrough } from "node:stream";
import { describe, expect, test } from "vite-plus/test";
import { frame, isToken, parseMessage, readMessages } from "../src/relay-protocol";

describe("readMessages", () => {
	test("splits a stream on \\0, across chunks", () => {
		const stream = new PassThrough();
		const seen: string[] = [];
		readMessages(stream, (text) => seen.push(text));
		stream.write('{"id":1}\0{"id');
		stream.write('":2}\0');
		stream.write("partial");
		expect(seen).toEqual(['{"id":1}', '{"id":2}']);
		stream.write("\0");
		expect(seen).toEqual(['{"id":1}', '{"id":2}', "partial"]);
	});

	test("reads back what frame wrote", () => {
		const stream = new PassThrough();
		const seen: unknown[] = [];
		readMessages(stream, (text) => seen.push(parseMessage(text)));
		stream.write(frame({ id: 7, method: "Target.getTargets" }));
		expect(seen).toEqual([{ id: 7, method: "Target.getTargets" }]);
	});
});

describe("parseMessage", () => {
	test("is null for anything that isn't a JSON object", () => {
		expect(parseMessage("not json")).toBeNull();
		expect(parseMessage("42")).toBeNull();
		expect(parseMessage("null")).toBeNull();
	});
});

describe("isToken", () => {
	test("only the exact token passes", () => {
		expect(isToken("abc123", "abc123")).toBe(true);
		expect(isToken("abc124", "abc123")).toBe(false);
		expect(isToken("abc12", "abc123")).toBe(false);
		expect(isToken("", "abc123")).toBe(false);
	});
});
