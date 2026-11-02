import { describe, expect, test } from "vite-plus/test";
import { isWithin, toUriPath, userDataDir, withHome } from "../src/paths";

describe("userDataDir", () => {
	test("goes up from the extension's global storage folder", () => {
		expect(userDataDir("/Users/me/Library/Application Support/Code/User/globalStorage/david-tejada.beans")).toBe(
			"/Users/me/Library/Application Support/Code",
		);
	});

	test("also in a profile", () => {
		expect(userDataDir("/data/User/profiles/abc123/globalStorage/david-tejada.beans")).toBe("/data");
	});

	test("in Theia, gives the configuration folder holding globalStorage", () => {
		expect(userDataDir("/Users/me/.theia-ide/globalStorage/david-tejada.beans")).toBe("/Users/me/.theia-ide");
	});

	test("in Theia, isn't fooled by an account folder named User", () => {
		expect(userDataDir("/Users/User/.theia-ide/globalStorage/david-tejada.beans")).toBe("/Users/User/.theia-ide");
	});

	test("gives the root when there's no globalStorage folder", () => {
		expect(userDataDir("/nowhere")).toBe("/");
	});
});

describe("toUriPath", () => {
	test("turns a Windows path into a URI path", () => {
		expect(toUriPath("C:\\me\\a.js")).toBe("/C:/me/a.js");
		expect(toUriPath("d:/proj/x")).toBe("/d:/proj/x");
	});

	test("leaves a POSIX path alone", () => {
		expect(toUriPath("/home/me/a.js")).toBe("/home/me/a.js");
	});
});

describe("withHome", () => {
	test("uses the local home folder when there is one", () => {
		expect(withHome("/proj/a.js", [], "/Users/me")).toBe("/Users/me/proj/a.js");
	});

	test("works the remote home out from a workspace folder", () => {
		expect(withHome("/proj/src/a.js", ["/home/me/proj"], null)).toBe("/home/me/proj/src/a.js");
		expect(withHome("/proj/src/a.js", ["/srv/other", "/home/me/proj/src"], null)).toBe("/home/me/proj/src/a.js");
	});

	test("is null when no folder matches the start of the path", () => {
		expect(withHome("/proj/a.js", ["/home/me/elsewhere"], null)).toBeNull();
		expect(withHome("/a.js", ["/home/me"], null)).toBeNull();
	});
});

describe("isWithin", () => {
	test("matches the folder itself and paths inside it, on whole segments", () => {
		expect(isWithin("/a/foo", "/a/foo")).toBe(true);
		expect(isWithin("/a/foo/b.js", "/a/foo")).toBe(true);
		expect(isWithin("/a/foo/b.js", "/a/foo/")).toBe(true);
		expect(isWithin("/a/foo", "/a/fo")).toBe(false);
	});

	test("ignores case for Windows paths only", () => {
		expect(isWithin("/C:/Me/A.js", "/c:/me")).toBe(true);
		expect(isWithin("/Home/me/a.js", "/home/me")).toBe(false);
	});
});
