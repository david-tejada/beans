import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import * as vscode from "vscode";
import { currentEditor } from "./editor";
import { NotInjectedError, PageError } from "./inject";
import { log, logError } from "./output";
import { getUserDataDir, relayFilePath } from "./relay-connection";
import { DETACH } from "./relay-protocol";
import type { RelayJob } from "./cdp-relay";
import type { Editor } from "./shared/types";

const run = promisify(execFile);

// While developing, pnpm dev holds the pipe and would start an editor
// without the development flags, so the fix for an unreachable page is to
// run it again, not to relaunch.
let isDevelopment = false;
const DEV_MESSAGE = "Beans can't reach this window's debug pipe. Stop pnpm dev and run it again; it holds the pipe.";

/** Tells relaunch that this is a development host (pnpm dev); extension.ts calls it on activation. */
export function setDevelopment(value: boolean): void {
	isDevelopment = value;
}

// The pid of the relay the last relaunch started, while it still waits for
// the editor to quit. Canceling the quit at the unsaved-changes dialog leaves
// it waiting for up to two minutes, after which it exits and the pid is
// forgotten; once the editor does quit, this extension host is gone with it,
// so a pid held here is always a relay that's still waiting.
let waitingRelay: number | null = null;
let forgetRelay: NodeJS.Timeout | undefined;

/**
 * Quits the editor and starts it again with a debug pipe, so Beans can
 * inject its script. The editor can't start itself after it has quit, so the
 * relay (cdp-relay.ts), a process that outlives it, starts it and then holds
 * the pipe for as long as the editor runs.
 */
export async function relaunch(): Promise<void> {
	if (isDevelopment) {
		vscode.window.showWarningMessage(DEV_MESSAGE);
		return;
	}
	const editor = currentEditor();
	// Two waiting relays would both start an editor when this one quits, and
	// the loser's cleanup can remove the winner's relay file.
	stopWaitingRelay();
	try {
		const job = await relayJob(editor);
		waitingRelay = await startRelay(job);
		// A little before the relay's own two minutes run out, so the pid is
		// never killed after it could belong to another process.
		forgetRelay = setTimeout(() => (waitingRelay = null), 110 * 1000);
		log(`relay started for ${job.command}`);
	} catch (error) {
		logError("starting the relay", error);
		const message = error instanceof Error ? error.message : String(error);
		vscode.window.showErrorMessage(`Beans couldn't start its relay (${message}), so ${vscode.env.appName} stays open.`);
		return;
	}
	try {
		await vscode.commands.executeCommand(QUIT_COMMANDS[editor]);
	} catch (error) {
		// The relay still waits, so quitting by hand finishes the relaunch.
		logError("quitting the editor", error);
		vscode.window.showErrorMessage(
			`Beans couldn't quit ${vscode.env.appName}. Quit it yourself within two minutes, and Beans starts it again with hints.`,
		);
	}
}

// Theia has no quit command, but closing its last window quits it.
const QUIT_COMMANDS: Record<Editor, string> = { vscode: "workbench.action.quit", theia: "close.window" };

/**
 * What the relay needs to start the editor again: the main process to wait
 * for, the program, and its flags.
 */
async function relayJob(editor: Editor): Promise<RelayJob> {
	// The main process is the one that has to exit before the editor can
	// start again with new flags. VS Code's extension host is its child.
	// Theia's plugin host is a child of its backend, a child of the main
	// process.
	const pid = editor === "theia" ? await parentOf(process.ppid) : process.ppid;
	// VS Code gets its data folder passed on, so one started with
	// --user-data-dir comes back with it and looks for the relay file where
	// this one was written. Theia keeps its relay file in its configuration
	// folder, which the flag doesn't move.
	const userDataFlag = editor === "vscode" ? [`--user-data-dir=${getUserDataDir()}`] : [];
	return {
		pid,
		command: await editorProgram(pid),
		args: ["--remote-debugging-pipe", ...userDataFlag],
		relayFile: relayFilePath(),
	};
}

/** The id of a process's parent. */
async function parentOf(pid: number): Promise<number> {
	const { stdout } =
		process.platform === "win32"
			? await run("powershell.exe", [
					"-NoProfile",
					"-Command",
					`(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").ParentProcessId`,
				])
			: await run("ps", ["-o", "ppid=", "-p", String(pid)]);
	const parent = Number(stdout.trim());
	if (!Number.isInteger(parent) || parent <= 0) throw new Error(`no parent found for process ${pid}`);
	return parent;
}

function stopWaitingRelay(): void {
	clearTimeout(forgetRelay);
	if (waitingRelay === null) return;
	try {
		process.kill(waitingRelay);
	} catch {
		// It had already exited.
	}
	waitingRelay = null;
}

/**
 * Starts the relay with this job, detached so it outlives the editor, and
 * resolves to its pid once it's running. The relay starts its real copy
 * itself (DETACH in cdp-relay.ts), so that copy isn't this process's child.
 */
async function startRelay(job: RelayJob): Promise<number> {
	// process.execPath is the editor's own Electron, which runs plain Node
	// with ELECTRON_RUN_AS_NODE, as it does for language servers.
	const { stdout } = await run(process.execPath, [path.join(__dirname, "cdp-relay.js"), JSON.stringify(job), DETACH], {
		env: { ...editorFreeEnv(), ELECTRON_RUN_AS_NODE: "1" },
		timeout: 10_000,
	});
	const pid = Number(stdout);
	if (!Number.isInteger(pid) || pid <= 0) throw new Error("the relay didn't start");
	return pid;
}

/**
 * The program of the editor's main process, pid. The relay starts it
 * directly, since that's the only way to hand it the pipe; macOS's `open`
 * can't.
 */
async function editorProgram(pid: number): Promise<string> {
	// The extension host runs in a helper app inside the editor's bundle, so
	// ask the main process for its program, such as
	// /Applications/Visual Studio Code.app/Contents/MacOS/Code.
	if (process.platform === "darwin") {
		const { stdout } = await run("ps", ["-o", "comm=", "-p", String(pid)]);
		return stdout.trim();
	}
	// An AppImage on Linux runs from a folder that's gone once it quits,
	// so it's started again from the AppImage file.
	if (process.env.APPIMAGE) return process.env.APPIMAGE;
	// On Windows and Linux every Electron process runs the main program, such
	// as Code.exe or codium.
	return process.execPath;
}

/**
 * This process's environment without the variables the editor sets for its
 * child processes. Inherited, they'd make the new editor run as plain Node or
 * try to join the old instance, and NODE_CHANNEL_FD, which Theia's plugin
 * host has, would make the relay look for an IPC channel it doesn't have.
 */
function editorFreeEnv(): NodeJS.ProcessEnv {
	return Object.fromEntries(
		Object.entries(process.env).filter(
			// VSCODE_PORTABLE is the user's own: it points portable installs at their data folder.
			([name]) =>
				name === "VSCODE_PORTABLE" ||
				!(
					name.startsWith("VSCODE_") ||
					name.startsWith("ELECTRON_") ||
					name.startsWith("NODE_CHANNEL_") ||
					name === "THEIA_PARENT_PID"
				),
		),
	);
}

/**
 * Reports a failed request to the page. A window without the hint script
 * gets it injected, a bug in the script is shown as an error, and anything
 * else means the page can't be reached.
 */
export async function reportError(error: unknown): Promise<void> {
	logError("request to the page", error);
	if (error instanceof NotInjectedError) await injectAndAskAgain(error);
	else if (error instanceof PageError) vscode.window.showErrorMessage(`Beans: ${error.message}`);
	else await warnUnreachable(error);
}

/**
 * Injects the hint script, which the focused window was missing, and asks
 * for the command again. Injecting is the whole fix, and a voice user can't
 * easily click a button offering it.
 */
async function injectAndAskAgain(error: NotInjectedError): Promise<void> {
	// beans.inject reports its own failure, so there's nothing to add then.
	if (await vscode.commands.executeCommand<boolean>("beans.inject", { quiet: true })) {
		vscode.window.showWarningMessage(`Beans: ${error.message}, so it's injected now. Say the command again.`);
	}
}

/** Explains that the page can't be reached, and offers to relaunch. */
async function warnUnreachable(error: unknown): Promise<void> {
	const message = error instanceof Error ? error.message : String(error);
	if (isDevelopment) {
		vscode.window.showWarningMessage(`${DEV_MESSAGE} (${message})`);
		return;
	}
	const choice = await vscode.window.showWarningMessage(
		`Beans can't reach ${vscode.env.appName} (${message}). Relaunch it with Beans to see the hints.`,
		"Relaunch with hints",
	);
	if (choice) await relaunch();
}
