import { describe, expect, it } from "vite-plus/test";
import { releaseNotes } from "../scripts/changelog.mts";

const changelog = `# Changelog

## Unreleased

- Something not out yet.

## 0.3.0

- Hints on more rows.
- A fix.

## 0.2.0

- The \`beans.hintStyle\` setting.

## 0.1.0

The first release.
`;

describe("releaseNotes", () => {
	it("returns the section under the version's heading, trimmed", () => {
		expect(releaseNotes(changelog, "0.3.0")).toBe("- Hints on more rows.\n- A fix.");
	});

	it("reads the last section to the end of the file", () => {
		expect(releaseNotes(changelog, "0.1.0")).toBe("The first release.");
	});

	it("does not match a longer version that starts the same", () => {
		expect(releaseNotes(changelog, "0.3")).toBeNull();
	});

	it("is null when the version has no heading", () => {
		expect(releaseNotes(changelog, "0.4.0")).toBeNull();
	});

	it("is null when the heading has nothing under it", () => {
		expect(releaseNotes("## 0.4.0\n\n## 0.3.0\n\n- A fix.\n", "0.4.0")).toBeNull();
	});
});
