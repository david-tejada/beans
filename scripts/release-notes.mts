// Prints the CHANGELOG.md section for the version in package.json: the body
// of the GitHub release, and CI's check that a version bump brings its notes.
// Fails when the section is missing.
//
//   node scripts/release-notes.mts > notes.md

import fs from "node:fs";
import { releaseNotes } from "./changelog.mts";

const manifest: unknown = JSON.parse(fs.readFileSync("package.json", "utf8"));
const version =
	typeof manifest === "object" && manifest !== null && "version" in manifest ? manifest.version : undefined;
if (typeof version !== "string") throw new Error("package.json has no version");
const notes = releaseNotes(fs.readFileSync("CHANGELOG.md", "utf8"), version);
if (notes === null) {
	console.error(`CHANGELOG.md has no "## ${version}" section. Move the Unreleased entries under that heading.`);
	process.exit(1);
}
console.log(notes);
