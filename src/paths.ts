import path from "node:path";

// Path arithmetic for the rows' hover paths, with no VS Code in it, so it
// can be tested on its own. target-commands.ts turns the results into URIs.

/**
 * The editor's user data folder, from the extension's global storage folder:
 * <user data>/User/globalStorage/<extension id>, or
 * <user data>/User/profiles/<profile>/globalStorage/<extension id> in a profile.
 */
export function userDataDir(globalStoragePath: string): string {
	let dir = globalStoragePath;
	while (path.basename(dir) !== "User" && path.dirname(dir) !== dir) dir = path.dirname(dir);
	return path.dirname(dir);
}

/**
 * A path in the form of a URI's path: "/" between segments and a leading "/",
 * so "C:\me\a.js" becomes "/C:/me/a.js". The hover writes a path the way the
 * OS holding the file does, which in a remote window isn't this one, so it
 * can't be compared to a folder's fsPath, which uses this OS's separator.
 */
export function toUriPath(fullPath: string): string {
	return /^[a-zA-Z]:[\\/]/.test(fullPath) ? `/${fullPath.replace(/\\/g, "/")}` : fullPath;
}

/**
 * Puts the home folder in front of the rest of a "~" path. Locally that's
 * homedir. In a remote window, which Beans can't read, the remote home is
 * worked out from a workspace folder whose path ends with the start of rest:
 * with rest "/proj/a.js" and the folder "/home/me/proj", it's "/home/me".
 * Returns null when no folder fits.
 */
export function withHome(rest: string, folderPaths: string[], homedir: string | null): string | null {
	if (homedir !== null) return path.join(homedir, rest);
	const segments = rest.split("/");
	for (const folderPath of folderPaths) {
		// The longest start of rest that the folder's path ends with.
		for (let count = segments.length; count > 1; count--) {
			const start = segments.slice(0, count).join("/");
			if (folderPath.endsWith(start)) return folderPath.slice(0, -start.length) + rest;
		}
	}
	return null;
}

/**
 * Whether a URI path is the folder or inside it, on whole path segments:
 * /a/foo isn't in /a/fo. Windows paths are compared without case, as Windows
 * does: the hover writes the drive letter in upper case whatever case the
 * folder's URI has.
 */
export function isWithin(uriPath: string, folderPath: string): boolean {
	const ignoreCase = isWindowsPath(folderPath);
	const [candidate, folder] = ignoreCase ? [uriPath.toLowerCase(), folderPath.toLowerCase()] : [uriPath, folderPath];
	const base = folder.endsWith("/") ? folder.slice(0, -1) : folder;
	return candidate === base || candidate.startsWith(`${base}/`);
}

function isWindowsPath(uriPath: string): boolean {
	return /^\/[a-zA-Z]:(\/|$)/.test(uriPath);
}
