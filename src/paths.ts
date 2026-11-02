import path from "node:path";

// Path arithmetic for the rows' hover paths, with no VS Code in it, so it
// can be tested on its own. target-commands.ts turns the results into URIs.

/**
 * The editor's user data folder, from the extension's global storage folder:
 * <user data>/User/globalStorage/<extension id>, or
 * <user data>/User/profiles/<profile>/globalStorage/<extension id> in a profile.
 * Theia has no User folder: its global storage is in its configuration
 * folder, <config>/globalStorage/<extension id>, so that's the one returned.
 */
export function userDataDir(globalStoragePath: string): string {
	const globalStorage = ancestorNamed(globalStoragePath, "globalStorage");
	if (globalStorage === undefined) return path.parse(globalStoragePath).root;
	// The User folder is right above globalStorage, or three above in a
	// profile. Looking for "User" from the top instead would stop at a
	// Windows account named User, C:\Users\User.
	const parent = path.dirname(globalStorage);
	if (path.basename(parent) === "User") return path.dirname(parent);
	const profiles = path.dirname(parent);
	const user = path.dirname(profiles);
	if (path.basename(profiles) === "profiles" && path.basename(user) === "User") return path.dirname(user);
	return parent;
}

/** The nearest folder of this name among dir and the folders above it. */
function ancestorNamed(dir: string, name: string): string | undefined {
	for (let current = dir; path.dirname(current) !== current; current = path.dirname(current)) {
		if (path.basename(current) === name) return current;
	}
	return undefined;
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
