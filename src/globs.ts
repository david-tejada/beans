/**
 * The RegExp for a files.exclude glob, or null for one that can't be read.
 * "**" spans folders, "*" and "?" stay within one, "{a,b}" is either. Other
 * glob features aren't needed for folder names and are matched literally.
 */
export function globToRegExp(glob: string): RegExp | null {
	try {
		return new RegExp(`^${globSource(glob)}$`);
	} catch {
		return null;
	}
}

function globSource(glob: string): string {
	return glob.replace(/\*\*\/|\*\*|\*|\?|\{[^}]*\}|[^*?{]+/g, (token) => {
		if (token === "**/") return "(?:.*/)?";
		if (token === "**") return ".*";
		if (token === "*") return "[^/]*";
		if (token === "?") return "[^/]";
		if (token.startsWith("{")) return `(?:${token.slice(1, -1).split(",").map(globSource).join("|")})`;
		return token.replace(/[.+^$()|[\]\\]/g, "\\$&");
	});
}
