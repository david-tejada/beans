const { execFileSync, spawn } = require("child_process");
const path = require("path");
const vscode = require("vscode");
const { PageError, NotInjectedError } = require("./inject");
const { getUserDataDir, relayFilePath } = require("./relay-connection");

// The relay the last relaunch started, while it still waits for the editor
// to quit. Canceling the quit at the unsaved-changes dialog leaves it waiting
// for up to two minutes; once the editor does quit, this extension host is
// gone with it, so a relay held here is always one that's still waiting.
let waitingRelay = null;

/**
 * Quits the editor and starts it again with a debug pipe, so Beans can
 * inject its script. The editor can't start itself after it has quit, so the
 * relay (cdp-relay.js), a process that outlives it, starts it and then holds
 * the pipe for as long as the editor runs.
 */
async function relaunch() {
	// The extension host's parent is the editor's main process, the one that
	// has to exit before the editor can start again with new flags. The data
	// folder is passed on so an editor started with --user-data-dir comes back
	// with it, and looks for the relay file where this one was written.
	const job = JSON.stringify({
		pid: process.ppid,
		command: editorProgram(),
		args: ["--remote-debugging-pipe", `--user-data-dir=${getUserDataDir()}`],
		relayFile: relayFilePath(),
	});
	// Two waiting relays would both start an editor when this one quits, and
	// the loser's cleanup can remove the winner's relay file.
	waitingRelay?.kill();
	try {
		waitingRelay = await startRelay(job);
	} catch (error) {
		vscode.window.showErrorMessage(`Beans couldn't start its relay (${error.message}), so ${vscode.env.appName} stays open.`);
		return;
	}
	await vscode.commands.executeCommand("workbench.action.quit");
}

/** Starts the relay with this job, detached so it outlives the editor, and resolves once it's running. */
function startRelay(job) {
	// process.execPath is the editor's own Electron, which runs plain Node
	// with ELECTRON_RUN_AS_NODE, as it does for language servers.
	const relay = spawn(process.execPath, [path.join(__dirname, "cdp-relay.js"), job], {
		detached: true,
		stdio: "ignore",
		env: { ...editorFreeEnv(), ELECTRON_RUN_AS_NODE: "1" },
	});
	relay.on("exit", () => {
		if (waitingRelay === relay) waitingRelay = null;
	});
	return new Promise((resolve, reject) => {
		relay.once("spawn", () => {
			// Once it runs, this process no longer needs to wait for it.
			relay.unref();
			resolve(relay);
		});
		relay.once("error", reject);
	});
}

/**
 * The editor's main program. The relay starts it directly, since that's the
 * only way to hand it the pipe; macOS's `open` can't.
 */
function editorProgram() {
	// The extension host runs in a helper app inside the editor's bundle, so
	// ask the main process for its program, such as
	// /Applications/Visual Studio Code.app/Contents/MacOS/Code.
	if (process.platform === "darwin") {
		return execFileSync("ps", ["-o", "comm=", "-p", String(process.ppid)], { encoding: "utf8" }).trim();
	}
	// On Windows and Linux every Electron process runs the main program, such
	// as Code.exe or codium.
	return process.execPath;
}

/**
 * This process's environment without the variables the editor sets for its
 * child processes. Inherited, they'd make the new editor run as plain Node or
 * try to join the old instance.
 */
function editorFreeEnv() {
	return Object.fromEntries(
		Object.entries(process.env).filter(
			// VSCODE_PORTABLE is the user's own: it points portable installs at their data folder.
			([name]) => name === "VSCODE_PORTABLE" || !(name.startsWith("VSCODE_") || name.startsWith("ELECTRON_")),
		),
	);
}

/**
 * Reports a failed request to the page. A window without the hint script
 * gets it injected, a bug in the script is shown as an error, and anything
 * else means the page can't be reached.
 */
async function reportError(error) {
	if (error instanceof NotInjectedError) await injectAndAskAgain(error);
	else if (error instanceof PageError) vscode.window.showErrorMessage(`Beans: ${error.message}`);
	else await warnUnreachable(error);
}

/**
 * Injects the hint script, which the focused window was missing, and asks
 * for the command again. Injecting is the whole fix, and a voice user can't
 * easily click a button offering it.
 */
async function injectAndAskAgain(error) {
	// beans.inject reports its own failure, so there's nothing to add then.
	if (await vscode.commands.executeCommand("beans.inject", { quiet: true })) {
		vscode.window.showWarningMessage(`Beans: ${error.message}, so it's injected now. Say the command again.`);
	}
}

/** Explains that the page can't be reached, and offers to relaunch. */
async function warnUnreachable(error) {
	const choice = await vscode.window.showWarningMessage(
		`Beans can't reach ${vscode.env.appName} (${error.message}). Relaunch it with Beans to see the hints.`,
		"Relaunch with hints",
	);
	if (choice) await relaunch();
}

module.exports = { relaunch, reportError };
