const path = require("path");
const vscode = require("vscode");
const { injectAll, callPage } = require("./inject");
const { setUserDataDir } = require("./relay-connection");
const { registerTargetCommands } = require("./target-commands");
const { relaunch, reportError } = require("./relaunch");

function activate(context) {
	setUserDataDir(userDataDir(context.globalStorageUri.fsPath));
	const page = { mediaDir: path.join(context.extensionPath, "media"), channelId: `${context.extension.id}.channel` };
	const channel = createChannel();
	context.subscriptions.push(channel);

	context.subscriptions.push(
		vscode.commands.registerCommand("beans.pick", (letters) => {
			// Letters pick a sidebar row, numbers a Command Palette row.
			const hint = String(letters ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
			if (hint) send(channel, "pick", hint);
		}),
		vscode.commands.registerCommand("beans.rowPoint", rowPoint),
		vscode.commands.registerCommand("beans.toggle", () => send(channel, "toggle")),
		// direction: "up", "down", "top" or "bottom". letters: optional hint
		// of a row in the list to scroll.
		vscode.commands.registerCommand("beans.scroll", (direction, letters) => {
			const hint = String(letters ?? "").toLowerCase().replace(/[^a-z]/g, "");
			if (["up", "down", "top", "bottom"].includes(direction)) send(channel, "scroll", `${direction}-${hint}`);
		}),
		// request: { target, by } in steps, { target, to } in pixels, or
		// { target, max: true }. See resize() in media/beans.js.
		vscode.commands.registerCommand("beans.resize", resize),
		// { quiet: true } skips the message saying how many windows got the script.
		vscode.commands.registerCommand("beans.inject", (options) => inject(page, channel, { quiet: Boolean(options?.quiet) })),
		vscode.commands.registerCommand("beans.relaunch", relaunch),
		// A new hint style reaches the windows through a fresh injection.
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration("beans.hintStyle")) inject(page, channel, { quiet: true });
		}),
	);

	registerTargetCommands(context);

	inject(page, channel, { quiet: true });
}

function deactivate() {}

/**
 * The editor's user data folder, from the extension's global storage folder:
 * <user data>/User/globalStorage/<extension id>, or
 * <user data>/User/profiles/<profile>/globalStorage/<extension id> in a profile.
 */
function userDataDir(globalStoragePath) {
	let dir = globalStoragePath;
	while (path.basename(dir) !== "User" && path.dirname(dir) !== dir) dir = path.dirname(dir);
	return path.dirname(dir);
}

/**
 * Creates the status bar item that carries requests to media/beans.js.
 *
 * The extension host can't reach the page, but VS Code renders the item's
 * text in the page, where the script watches it. Each window has its own
 * status bar, so a request only reaches the window that got the command.
 * It's shown once the page has the rule that hides it (inject).
 */
function createChannel() {
	const channel = vscode.window.createStatusBarItem("channel", vscode.StatusBarAlignment.Left, -10000);
	channel.name = "Beans channel";
	channel.text = "beans:0:idle:";
	return channel;
}

let counter = 0;

/** Sends a request to the page. The counter makes repeated requests distinct. */
function send(channel, command, arg = "") {
	counter += 1;
	channel.text = `beans:${counter}:${command}:${arg}`;
}

/**
 * Returns where to right-click the row with this hint, as { x, y } fractions
 * of the focused window's width and height, for Talon to click there. Warns
 * and returns null when there's no such row.
 */
async function rowPoint(letters) {
	const hint = String(letters ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
	if (!hint) return null;
	let point;
	try {
		point = await callPage("rowPoint", hint);
	} catch (error) {
		await reportError(error);
		return null;
	}
	if (!point) vscode.window.showWarningMessage(`Beans: no row with hint ${hint.toUpperCase()}.`);
	return point ?? null;
}

/** Resizes a part or a sidebar view in the focused window, and says when it couldn't. */
async function resize(request) {
	let result;
	try {
		result = await callPage("resize", request);
	} catch (error) {
		await reportError(error);
		return;
	}
	const warn = (message) => vscode.window.showWarningMessage(`Beans: ${message}.`);
	// VS Code stops a sash at the sizes the views on either side allow.
	if (result.problem) warn(result.problem);
	else if (request.to && Math.abs(result.after - request.to) > 1) warn(`the ${result.name} stopped at ${result.after}px`);
	else if (request.by && result.after === result.before)
		warn(`the ${result.name} can't get any ${request.by > 0 ? "bigger" : "smaller"}`);
}

/**
 * Injects the hint script into every window, and explains what to do when
 * that fails. Resolves to whether it could.
 */
async function inject({ mediaDir, channelId }, channel, { quiet }) {
	try {
		const count = await injectAll(mediaDir, channelId, settings());
		channel.show();
		if (!quiet) vscode.window.showInformationMessage(`Beans injected its script into ${count} window(s).`);
		return true;
	} catch (error) {
		await reportError(error);
		return false;
	}
}

/** The user's settings for the page (see injectAll). */
function settings() {
	return { hintStyle: vscode.workspace.getConfiguration("beans").get("hintStyle", "default") };
}

module.exports = { activate, deactivate };
