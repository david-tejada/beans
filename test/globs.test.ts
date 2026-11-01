import { describe, expect, test } from "vite-plus/test";
import { globToRegExp } from "../src/globs";

const matches = (glob: string, path: string) => globToRegExp(glob)?.test(path) ?? null;

describe("globToRegExp", () => {
	test("** spans folders", () => {
		expect(matches("**/node_modules", "a/b/node_modules")).toBe(true);
		expect(matches("**/node_modules", "node_modules")).toBe(true);
		expect(matches("**/node_modules", "a/node_modules/x")).toBe(false);
	});

	test("* and ? stay within one segment", () => {
		expect(matches("*.log", "a.log")).toBe(true);
		expect(matches("*.log", "dir/a.log")).toBe(false);
		expect(matches("a?c", "abc")).toBe(true);
		expect(matches("a?c", "a/c")).toBe(false);
	});

	test("{a,b} is either", () => {
		expect(matches("**/.{git,hg}", ".git")).toBe(true);
		expect(matches("**/.{git,hg}", "x/.hg")).toBe(true);
		expect(matches("**/.{git,hg}", ".svn")).toBe(false);
	});

	test("other characters are literal", () => {
		expect(matches("a.b", "axb")).toBe(false);
		expect(matches("a(b)", "a(b)")).toBe(true);
	});
});
