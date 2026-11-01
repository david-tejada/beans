/**
 * The CHANGELOG.md section for a version: the text under its "## <version>"
 * heading, up to the next heading. Null when the heading is missing or empty,
 * which is how CI tells a release PR it forgot its notes.
 */
export function releaseNotes(changelog: string, version: string): string | null {
	const lines = changelog.split("\n");
	const start = lines.findIndex((line) => line.trim() === `## ${version}`);
	if (start === -1) return null;
	const rest = lines.slice(start + 1);
	const end = rest.findIndex((line) => line.startsWith("## "));
	const body = (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
	return body === "" ? null : body;
}
