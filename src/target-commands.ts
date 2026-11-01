import os from "node:os";
import path from "node:path";
import * as vscode from "vscode";
import { globToRegExp } from "./globs";
import { callPage } from "./inject";
import { isWithin, toUriPath, withHome } from "./paths";
import { reportError } from "./relaunch";
import { isRecord, targetFrom } from "./requests";
import type { ResolvedItem, Target } from "./shared/types";
import type { API as GitApi, GitExtension, Repository } from "./types/git";

/** A row the page resolved, placed in the workspace as a URI. */
interface Item extends ResolvedItem {
	uri: vscode.Uri;
}

/**
 * Registers the commands that act on the files and folders that hints
 * point at. Each takes one object: { target }, plus { destination } for
 * move and { levels } for expand. A target is
 * { items: [{ hint } | { from, to }] }, built by beans.py in beans-talon.
 */
export function registerTargetCommands(context: vscode.ExtensionContext): void {
	const commands: Record<string, (args: unknown) => Promise<void>> = {
		"beans.open": (args) => withItems(args, openItems),
		"beans.split": (args) => withItems(args, (items) => openItems(items, { viewColumn: vscode.ViewColumn.Beside })),
		"beans.delete": (args) => withItems(args, deleteItems),
		"beans.move": (args) => withItems(args, (items) => moveItems(items, destinationFrom(args))),
		"beans.copyPath": (args) => withItems(args, (items) => copyPaths(items, (uri) => uri.fsPath)),
		"beans.copyRelativePath": (args) =>
			withItems(args, (items) => copyPaths(items, (uri) => vscode.workspace.asRelativePath(uri, false))),
		"beans.expand": (args) => expandTarget(targetFrom(argument(args, "target")), levelsFrom(args)),
		"beans.collapse": async (args) => {
			await setExpanded(targetFrom(argument(args, "target")), false);
		},
		"beans.collapseParent": (args) => withItems(args, collapseParents),
		"beans.select": async (args) => {
			await withItems(args, selectItems);
		},
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

function argument(args: unknown, name: string): unknown {
	return isRecord(args) ? args[name] : undefined;
}

/** "root", a target, or null when the move names no destination. */
function destinationFrom(args: unknown): "root" | Target | null {
	const destination = argument(args, "destination");
	return destination === "root" ? "root" : targetFrom(destination);
}

function levelsFrom(args: unknown): number {
	const levels = argument(args, "levels");
	return typeof levels === "number" && levels >= 1 ? Math.floor(levels) : 1;
}

/** Resolves args.target in the focused window, and runs action on the file items, if any. */
async function withItems(args: unknown, action: (items: Item[]) => Promise<unknown>): Promise<void> {
	const items = await resolveTarget(targetFrom(argument(args, "target")));
	if (items?.length) await action(items);
}

/** Like withItems, for commands that act on a single item: the first one. */
async function withItem(args: unknown, action: (item: Item) => Promise<unknown>): Promise<void> {
	const items = await resolveTarget(targetFrom(argument(args, "target")));
	const [first] = items ?? [];
	if (!first) return;
	if (items!.length > 1) vscode.window.showInformationMessage(`Beans: only ${first.hint.toUpperCase()} is used here.`);
	await action(first);
}

/**
 * Asks the page which rows the target names, and returns them as items with
 * URIs. Warns about hints that aren't on screen or aren't files. Returns null
 * when there's no target or the page can't be reached.
 */
async function resolveTarget(target: Target | null): Promise<Item[] | null> {
	if (!target) return null;
	let result;
	try {
		result = await callPage("resolve", target);
	} catch (error) {
		await reportError(error);
		return null;
	}
	const items: Item[] = [];
	const unplaced: string[] = [];
	for (const item of result.items) {
		const uri = uriFor(item.path);
		if (uri) items.push({ ...item, uri });
		else unplaced.push(item.hint);
	}
	const problems = [];
	if (result.missing.length) problems.push(`no row with hint ${hintList(result.missing)}`);
	if (result.skipped.length) problems.push(`skipped ${hintList(result.skipped)}, not files`);
	if (unplaced.length) problems.push(`skipped ${hintList(unplaced)}, outside the workspace folders`);
	warnAbout(problems);
	return items;
}

function warnAbout(problems: string[]): void {
	if (problems.length) vscode.window.showWarningMessage(`Beans: ${problems.join("; ")}.`);
}

function hintList(hints: string[]): string {
	return hints.map((hint) => hint.toUpperCase()).join(", ");
}

/**
 * The URI of a row's hover path, in the workspace folder holding it. Returns
 * null in a remote window when the path is outside every workspace folder,
 * since a local file of that name would be the wrong one.
 */
function uriFor(fullPath: string): vscode.Uri | null {
	const folders = vscode.workspace.workspaceFolders ?? [];
	const remote = Boolean(vscode.env.remoteName);
	const resolved = fullPath.startsWith("~")
		? withHome(
				fullPath.slice(1),
				folders.map((folder) => folder.uri.path),
				remote ? null : os.homedir(),
			)
		: fullPath;
	if (!resolved) return null;
	const uriPath = toUriPath(resolved);
	const folder = folders.find((f) => isWithin(uriPath, f.uri.path));
	if (folder) return folder.uri.with({ path: uriPath });
	return remote ? null : vscode.Uri.file(resolved);
}

function parentOf(uri: vscode.Uri): vscode.Uri {
	return vscode.Uri.joinPath(uri, "..");
}

/** Opens files (pinned, not as a preview) and toggles folders open or closed. */
async function openItems(items: Item[], options: vscode.TextDocumentShowOptions = {}): Promise<void> {
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
async function deleteItems(items: Item[]): Promise<void> {
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
			const message = error instanceof Error ? error.message : String(error);
			vscode.window.showWarningMessage(`Beans couldn't delete "${path.basename(item.uri.path)}": ${message}`);
		}
	}
}

/**
 * Whether deleting this item can use the Trash. Only the local disk has one,
 * VS Code's remote servers don't, and files.enableTrash can turn it off.
 */
function hasTrash(item: Item): boolean {
	return item.uri.scheme === "file" && vscode.workspace.getConfiguration("files", item.uri).get("enableTrash", true);
}

function noTrashReason(items: Item[]): string {
	return items.some((item) => item.uri.scheme !== "file") ? "Remote files have no Trash" : "files.enableTrash is off";
}

/**
 * Moves the items into a folder: the destination's, if it's a folder hint,
 * or the folder holding it, if it's a file; "root" is the workspace folder.
 * Explorer rows go through the Explorer's own cut and paste, so language
 * servers can update imports and Cmd+Z in the Explorer undoes it.
 */
async function moveItems(items: Item[], destination: "root" | Target | null): Promise<void> {
	const folder = await destinationFolder(destination, items[0]!.uri);
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

async function destinationFolder(
	destination: "root" | Target | null,
	firstUri: vscode.Uri,
): Promise<vscode.Uri | null> {
	if (destination === null) return null;
	if (destination === "root") return vscode.workspace.getWorkspaceFolder(firstUri)?.uri ?? null;
	const [target] = (await resolveTarget(destination)) ?? [];
	if (!target) return null;
	return target.isFolder ? target.uri : parentOf(target.uri);
}

async function copyPaths(items: Item[], format: (uri: vscode.Uri) => string): Promise<void> {
	await vscode.env.clipboard.writeText(items.map((item) => format(item.uri)).join("\n"));
}

/** Expands the target's rows, and the subfolders of its Explorer folders down to this many levels. */
async function expandTarget(target: Target | null, levels: number): Promise<void> {
	const folders = await setExpanded(target, true);
	if (levels <= 1) return;
	for (const uri of folders ?? []) await expandSubfolders(uri, levels - 1);
}

/**
 * Expands or collapses the rows the target names, in any view: folders,
 * Search files, Outline symbols, view headers. The page clicks their arrows,
 * since not every row that expands is a file. Returns the URIs of the
 * Explorer folders among them, or null when the page can't be reached.
 */
async function setExpanded(target: Target | null, expanded: boolean): Promise<vscode.Uri[] | null> {
	if (!target) return null;
	let result;
	try {
		result = await callPage("setExpanded", target, expanded);
	} catch (error) {
		await reportError(error);
		return null;
	}
	if (result.missing.length) warnAbout([`no row with hint ${hintList(result.missing)}`]);
	return result.folders.map((folder) => uriFor(folder.path)).filter((uri): uri is vscode.Uri => uri !== null);
}

async function expandSubfolders(uri: vscode.Uri, levels: number): Promise<void> {
	const isHidden = hiddenByFilesExclude(uri);
	const entries = await vscode.workspace.fs.readDirectory(uri);
	for (const [name, type] of entries) {
		if (!(type & vscode.FileType.Directory)) continue;
		const child = vscode.Uri.joinPath(uri, name);
		// A hidden folder isn't in the Explorer to expand, and .git alone holds hundreds of them.
		if (isHidden(child)) continue;
		await revealThen(child, "list.expand");
		if (levels > 1) await expandSubfolders(child, levels - 1);
	}
}

/**
 * A function telling whether files.exclude hides a path from the Explorer,
 * for the setting that applies to this folder. Like the Explorer, it matches
 * the patterns against the path relative to the workspace folder.
 */
function hiddenByFilesExclude(folder: vscode.Uri): (uri: vscode.Uri) => boolean {
	const setting = vscode.workspace.getConfiguration("files", folder).get<Record<string, unknown>>("exclude") ?? {};
	// A value can also be { when }, which hides a file next to a sibling; that never hides a folder.
	const patterns = Object.entries(setting)
		.filter(([, value]) => value === true)
		.map(([glob]) => globToRegExp(glob))
		.filter((pattern): pattern is RegExp => pattern !== null);
	return (uri) => {
		const relative = vscode.workspace.asRelativePath(uri, false);
		return patterns.some((pattern) => pattern.test(relative));
	};
}

/** Collapses the folder holding each item, once per folder, but never the workspace folder itself. */
async function collapseParents(items: Item[]): Promise<void> {
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
async function selectItems(items: Item[]): Promise<boolean> {
	const wanted = items.filter((item) => item.view === "explorer").map((item) => ({ hint: item.hint, path: item.path }));
	let selected;
	try {
		await vscode.commands.executeCommand("workbench.files.action.focusFilesExplorer");
		await vscode.commands.executeCommand("list.clear");
		selected = await callPage("select", wanted);
	} catch (error) {
		await reportError(error);
		return false;
	}
	const matches = selected.length === wanted.length && wanted.every((item) => selected.includes(item.path));
	if (!matches)
		vscode.window.showWarningMessage("Beans: the Explorer's selection didn't match, so nothing was changed.");
	return matches;
}

async function revealInFinder(items: Item[]): Promise<void> {
	for (const item of items) await vscode.commands.executeCommand("revealFileInOS", item.uri);
}

async function discardItems(items: Item[]): Promise<void> {
	const names = items.map((item) => path.basename(item.uri.fsPath));
	const choice = await vscode.window.showWarningMessage(
		`Discard the changes to ${items.length === 1 ? `"${names[0]}"` : `${items.length} files`}? This can't be undone.`,
		{ modal: true, detail: names.join("\n") },
		"Discard Changes",
	);
	if (choice) await runGit(items, (repo, paths) => repo.clean(paths));
}

async function diffItems(items: Item[]): Promise<void> {
	for (const item of items.filter((i) => !i.isFolder)) await vscode.commands.executeCommand("git.openChange", item.uri);
}

/**
 * Runs a Git operation on the items' paths, grouped by repository, through
 * the Git extension's API. The built-in git.stage and git.unstage commands
 * only accept Source Control's own objects, not paths.
 */
async function runGit(items: Item[], operation: (repo: Repository, paths: string[]) => Promise<void>): Promise<void> {
	const git = await gitApi();
	if (!git) {
		vscode.window.showWarningMessage("Beans: the Git extension isn't available.");
		return;
	}
	const byRepository = new Map<Repository, string[]>();
	for (const item of items) {
		const repository = git.getRepository(item.uri);
		if (!repository) continue;
		byRepository.set(repository, [...(byRepository.get(repository) ?? []), item.uri.fsPath]);
	}
	for (const [repository, paths] of byRepository) await operation(repository, paths);
}

async function gitApi(): Promise<GitApi | null> {
	const extension = vscode.extensions.getExtension<GitExtension>("vscode.git");
	if (!extension) return null;
	const exports = extension.isActive ? extension.exports : await extension.activate();
	return exports.getAPI(1);
}

/** Selects the item in the Explorer, then runs a command that acts on the Explorer's selection. */
async function revealThen(uri: vscode.Uri, command: string): Promise<void> {
	await vscode.commands.executeCommand("revealInExplorer", uri);
	await vscode.commands.executeCommand(command);
}
