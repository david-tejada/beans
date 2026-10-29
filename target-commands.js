const os = require("os");
const path = require("path");
const vscode = require("vscode");
const { callPage } = require("./inject");
const { reportError } = require("./relaunch");

/**
 * Registers the commands that act on the files and folders that hints
 * point at. Each takes one object: { target }, plus { destination } for
 * move and { levels } for expand. A target is
 * { items: [{ hint } | { from, to }] }, built by beans.py in the beans-talon repo.
 */
function registerTargetCommands(context) {
	const commands = {
		"beans.open": (args) => withItems(args, openItems),
		"beans.split": (args) => withItems(args, (items) => openItems(items, { viewColumn: vscode.ViewColumn.Beside })),
		"beans.delete": (args) => withItems(args, deleteItems),
		"beans.move": (args) => withItems(args, (items) => moveItems(items, args.destination)),
		"beans.copyPath": (args) => withItems(args, (items) => copyPaths(items, (uri) => uri.fsPath)),
		"beans.copyRelativePath": (args) =>
			withItems(args, (items) => copyPaths(items, (uri) => vscode.workspace.asRelativePath(uri, false))),
		"beans.expand": (args) => withItems(args, (items) => expandItems(items, args.levels ?? 1)),
		"beans.collapse": (args) => withItems(args, collapseItems),
		"beans.collapseParent": (args) => withItems(args, collapseParents),
		"beans.select": (args) => withItems(args, selectItems),
		"beans.revealInFinder": (args) => withItems(args, revealInFinder),
		"beans.stage": (args) => withItems(args, (items) => runGit(items, (repo, paths) => repo.add(paths))),
		"beans.unstage": (args) => withItems(args, (items) => runGit(items, (repo, paths) => repo.revert(paths))),
		"beans.discard": (args) => withItems(args, discardItems),
		"beans.diff": (args) => withItems(args, diffItems),
		"beans.rename": (args) => withItem(args, (item) => revealThen(item.uri, "renameFile")),
		"beans.newFile": (args) => withItem(args, (item) => revealThen(item.uri, "explorer.newFile")),
		"beans.newFolder": (args) => withItem(args, (item) => revealThen(item.uri, "explorer.newFolder")),
		"beans.findInFolder": (args) =>
			withItem(args, (item) => revealThen(item.isFolder ? item.uri : parentOf(item.uri), "filesExplorer.findInFolder")),
	};
	for (const [id, run] of Object.entries(commands)) {
		context.subscriptions.push(vscode.commands.registerCommand(id, run));
	}
}

/** Resolves args.target in the focused window, and runs action on the file items, if any. */
async function withItems(args, action) {
	const items = await resolveTarget(args?.target);
	if (items?.length) await action(items);
}

/** Like withItems, for commands that act on a single item: the first one. */
async function withItem(args, action) {
	const items = await resolveTarget(args?.target);
	if (!items?.length) return;
	if (items.length > 1) vscode.window.showInformationMessage(`Beans: only ${items[0].hint.toUpperCase()} is used here.`);
	await action(items[0]);
}

/**
 * Asks the page which rows the target names, and returns them as
 * { hint, uri, isFolder, view }. Warns about hints that aren't on screen or
 * aren't files. Returns null when the page can't be reached.
 */
async function resolveTarget(target) {
	if (!target?.items?.length) return null;
	let result;
	try {
		result = await callPage("resolve", target);
	} catch (error) {
		await reportError(error);
		return null;
	}
	const items = result.items.map((item) => ({ ...item, uri: uriFor(item.path) }));
	const unplaced = items.filter((item) => !item.uri).map((item) => item.hint);
	const problems = [];
	if (result.missing.length) problems.push(`no row with hint ${hintList(result.missing)}`);
	if (result.skipped.length) problems.push(`skipped ${hintList(result.skipped)}, not files`);
	if (unplaced.length) problems.push(`skipped ${hintList(unplaced)}, outside the workspace folders`);
	if (problems.length) vscode.window.showWarningMessage(`Beans: ${problems.join("; ")}.`);
	return items.filter((item) => item.uri);
}

function hintList(hints) {
	return hints.map((hint) => hint.toUpperCase()).join(", ");
}

/**
 * The URI of a row's hover path, in the workspace folder holding it. Returns
 * null in a remote window when the path is outside every workspace folder,
 * since a local file of that name would be the wrong one.
 */
function uriFor(fullPath) {
	const folders = vscode.workspace.workspaceFolders ?? [];
	const resolved = fullPath.startsWith("~") ? withHome(fullPath.slice(1), folders) : fullPath;
	if (!resolved) return null;
	const uriPath = toUriPath(resolved);
	const folder = folders.find((f) => isWithin(uriPath, f.uri.path));
	if (folder) return folder.uri.with({ path: uriPath });
	return vscode.env.remoteName ? null : vscode.Uri.file(resolved);
}

/**
 * A path in the form of a URI's path: "/" between segments and a leading "/",
 * so "C:\me\a.js" becomes "/C:/me/a.js". The hover writes a path the way the
 * OS holding the file does, which in a remote window isn't this one, so it
 * can't be compared to a folder's fsPath, which uses this OS's separator.
 */
function toUriPath(fullPath) {
	return /^[a-zA-Z]:[\\/]/.test(fullPath) ? `/${fullPath.replace(/\\/g, "/")}` : fullPath;
}

/**
 * Puts the home folder in front of the rest of a "~" path. In a remote
 * window that's the remote home, which Beans can't read, so it's worked out
 * from a workspace folder whose path ends with the start of rest: with rest
 * "/proj/a.js" and the folder "/home/me/proj", it's "/home/me". Returns null
 * when no folder fits.
 */
function withHome(rest, folders) {
	if (!vscode.env.remoteName) return path.join(os.homedir(), rest);
	const segments = rest.split("/");
	for (const folder of folders) {
		const folderPath = folder.uri.path;
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
function isWithin(uriPath, folderPath) {
	const ignoreCase = isWindowsPath(folderPath);
	const [candidate, folder] = ignoreCase ? [uriPath.toLowerCase(), folderPath.toLowerCase()] : [uriPath, folderPath];
	const base = folder.endsWith("/") ? folder.slice(0, -1) : folder;
	return candidate === base || candidate.startsWith(`${base}/`);
}

function isWindowsPath(uriPath) {
	return /^\/[a-zA-Z]:(\/|$)/.test(uriPath);
}

function parentOf(uri) {
	return vscode.Uri.joinPath(uri, "..");
}

/** Opens files (pinned, not as a preview) and toggles folders open or closed. */
async function openItems(items, options = {}) {
	for (const item of items) {
		if (item.isFolder) await revealThen(item.uri, "list.toggleExpand");
		else await vscode.commands.executeCommand("vscode.open", item.uri, { preview: false, ...options });
	}
}

/**
 * Moves the items to the Trash. Explorer rows go through the Explorer's own
 * delete, with its confirmation, so Cmd+Z in the Explorer brings them back.
 * Rows from other views are deleted after Beans asks, and where there's no
 * Trash the question says the delete is for good.
 */
async function deleteItems(items) {
	if (items.every((item) => item.view === "explorer")) {
		if (await selectItems(items)) await vscode.commands.executeCommand("moveFileToTrash");
		return;
	}
	const useTrash = items.every(hasTrash);
	const names = items.map((item) => path.basename(item.uri.path));
	const what = items.length === 1 ? `"${names[0]}"` : `${items.length} items`;
	const choice = await vscode.window.showWarningMessage(
		useTrash ? `Move ${what} to the Trash?` : `Delete ${what} for good? ${noTrashReason(items)}.`,
		{ modal: true, detail: names.join("\n") },
		useTrash ? "Move to Trash" : "Delete",
	);
	if (!choice) return;
	for (const item of items) {
		try {
			// Asking for the Trash where there is none fails instead of deleting.
			await vscode.workspace.fs.delete(item.uri, { recursive: true, useTrash });
		} catch (error) {
			vscode.window.showWarningMessage(`Beans couldn't delete "${path.basename(item.uri.path)}": ${error.message}`);
		}
	}
}

/**
 * Whether deleting this item can use the Trash. Only the local disk has one,
 * VS Code's remote servers don't, and files.enableTrash can turn it off.
 */
function hasTrash(item) {
	return item.uri.scheme === "file" && vscode.workspace.getConfiguration("files", item.uri).get("enableTrash", true);
}

function noTrashReason(items) {
	return items.some((item) => item.uri.scheme !== "file") ? "Remote files have no Trash" : "files.enableTrash is off";
}

/**
 * Moves the items into a folder: the destination's, if it's a folder hint,
 * or the folder holding it, if it's a file; "root" is the workspace folder.
 * Explorer rows go through the Explorer's own cut and paste, so language
 * servers can update imports and Cmd+Z in the Explorer undoes it.
 */
async function moveItems(items, destination) {
	const folder = await destinationFolder(destination, items[0].uri);
	if (!folder) return;
	const toMove = items.filter((item) => parentOf(item.uri).toString() !== folder.toString());
	if (toMove.length === 0) return;
	// The workspace folder isn't a row the Explorer can select and paste into.
	const isRoot = vscode.workspace.getWorkspaceFolder(folder)?.uri.toString() === folder.toString();
	if (!isRoot && toMove.every((item) => item.view === "explorer")) {
		if (!(await selectItems(toMove))) return;
		await vscode.commands.executeCommand("filesExplorer.cut");
		await revealThen(folder, "filesExplorer.paste");
		return;
	}
	const edit = new vscode.WorkspaceEdit();
	for (const item of toMove) {
		edit.renameFile(item.uri, vscode.Uri.joinPath(folder, path.basename(item.uri.path)), { overwrite: false });
	}
	if (!(await vscode.workspace.applyEdit(edit))) {
		vscode.window.showWarningMessage("Beans couldn't move everything. Is there already a file with that name?");
	}
}

async function destinationFolder(destination, firstUri) {
	if (destination === "root") return vscode.workspace.getWorkspaceFolder(firstUri)?.uri ?? null;
	const [target] = (await resolveTarget(destination)) ?? [];
	if (!target) return null;
	return target.isFolder ? target.uri : parentOf(target.uri);
}

async function copyPaths(items, format) {
	await vscode.env.clipboard.writeText(items.map((item) => format(item.uri)).join("\n"));
}

/** Expands folders, and their subfolders down to this many levels. */
async function expandItems(items, levels) {
	for (const item of items.filter((i) => i.isFolder)) await expandFolder(item.uri, levels);
}

async function expandFolder(uri, levels) {
	await revealThen(uri, "list.expand");
	if (levels <= 1) return;
	const isHidden = hiddenByFilesExclude(uri);
	const entries = await vscode.workspace.fs.readDirectory(uri);
	for (const [name, type] of entries) {
		if (!(type & vscode.FileType.Directory)) continue;
		const child = vscode.Uri.joinPath(uri, name);
		// A hidden folder isn't in the Explorer to expand, and .git alone holds hundreds of them.
		if (!isHidden(child)) await expandFolder(child, levels - 1);
	}
}

/**
 * A function telling whether files.exclude hides a path from the Explorer,
 * for the setting that applies to this folder. Like the Explorer, it matches
 * the patterns against the path relative to the workspace folder.
 */
function hiddenByFilesExclude(folder) {
	const setting = vscode.workspace.getConfiguration("files", folder).get("exclude") ?? {};
	// A value can also be { when }, which hides a file next to a sibling; that never hides a folder.
	const patterns = Object.entries(setting)
		.filter(([, value]) => value === true)
		.map(([glob]) => globToRegExp(glob))
		.filter(Boolean);
	return (uri) => {
		const relative = vscode.workspace.asRelativePath(uri, false);
		return patterns.some((pattern) => pattern.test(relative));
	};
}

/**
 * The RegExp for a files.exclude glob, or null for one that can't be read.
 * "**" spans folders, "*" and "?" stay within one, "{a,b}" is either. Other
 * glob features aren't needed for folder names and are matched literally.
 */
function globToRegExp(glob) {
	try {
		return new RegExp(`^${globSource(glob)}$`);
	} catch {
		return null;
	}
}

function globSource(glob) {
	return glob.replace(/\*\*\/|\*\*|\*|\?|\{[^}]*\}|[^*?{]+/g, (token) => {
		if (token === "**/") return "(?:.*/)?";
		if (token === "**") return ".*";
		if (token === "*") return "[^/]*";
		if (token === "?") return "[^/]";
		if (token.startsWith("{")) return `(?:${token.slice(1, -1).split(",").map(globSource).join("|")})`;
		return token.replace(/[.+^$()|[\]\\]/g, "\\$&");
	});
}

async function collapseItems(items) {
	for (const item of items.filter((i) => i.isFolder)) await revealThen(item.uri, "list.collapse");
}

/** Collapses the folder holding each item, once per folder, but never the workspace folder itself. */
async function collapseParents(items) {
	const parents = new Map(items.map((item) => [parentOf(item.uri).toString(), parentOf(item.uri)]));
	for (const parent of parents.values()) {
		const root = vscode.workspace.getWorkspaceFolder(parent)?.uri;
		if (root && root.toString() !== parent.toString()) await revealThen(parent, "list.collapse");
	}
}

/**
 * Makes the items the Explorer's selection. The page Cmd+clicks the rows
 * (Ctrl+click on Windows and Linux), which keeps the hints in place, after
 * the old selection is cleared. Returns whether the Explorer ended up with
 * exactly these items selected: delete and move act on the selection, so
 * they stop when it's anything else, such as after the tree changed.
 */
async function selectItems(items) {
	const wanted = items.filter((item) => item.view === "explorer").map(({ hint, path }) => ({ hint, path }));
	let selected;
	try {
		await vscode.commands.executeCommand("workbench.files.action.focusFilesExplorer");
		await vscode.commands.executeCommand("list.clear");
		selected = await callPage("select", wanted);
	} catch (error) {
		await reportError(error);
		return false;
	}
	const matches = selected?.length === wanted.length && wanted.every((item) => selected.includes(item.path));
	if (!matches) vscode.window.showWarningMessage("Beans: the Explorer's selection didn't match, so nothing was changed.");
	return matches;
}

async function revealInFinder(items) {
	for (const item of items) await vscode.commands.executeCommand("revealFileInOS", item.uri);
}

async function discardItems(items) {
	const names = items.map((item) => path.basename(item.uri.fsPath));
	const choice = await vscode.window.showWarningMessage(
		`Discard the changes to ${items.length === 1 ? `"${names[0]}"` : `${items.length} files`}? This can't be undone.`,
		{ modal: true, detail: names.join("\n") },
		"Discard Changes",
	);
	if (choice) await runGit(items, (repo, paths) => repo.clean(paths));
}

async function diffItems(items) {
	for (const item of items.filter((i) => !i.isFolder)) await vscode.commands.executeCommand("git.openChange", item.uri);
}

/**
 * Runs a Git operation on the items' paths, grouped by repository, through
 * the Git extension's API. The built-in git.stage and git.unstage commands
 * only accept Source Control's own objects, not paths.
 */
async function runGit(items, operation) {
	const extension = vscode.extensions.getExtension("vscode.git");
	const git = (extension?.isActive ? extension.exports : await extension?.activate())?.getAPI(1);
	if (!git) {
		vscode.window.showWarningMessage("Beans: the Git extension isn't available.");
		return;
	}
	const byRepository = new Map();
	for (const item of items) {
		const repository = git.getRepository(item.uri);
		if (!repository) continue;
		byRepository.set(repository, [...(byRepository.get(repository) ?? []), item.uri.fsPath]);
	}
	for (const [repository, paths] of byRepository) await operation(repository, paths);
}

/** Selects the item in the Explorer, then runs a command that acts on the Explorer's selection. */
async function revealThen(uri, command) {
	await vscode.commands.executeCommand("revealInExplorer", uri);
	await vscode.commands.executeCommand(command);
}

module.exports = { registerTargetCommands };
