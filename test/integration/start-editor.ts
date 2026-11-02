import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { downloadAndUnzipVSCode, SilentReporter } from "@vscode/test-electron";
import { connectToRelay, relayFilePath, setUserDataDir, type RelayClient } from "../../src/relay-connection";
import type { Editor as EditorKind } from "../../src/shared/types";
import { theiaProgram } from "./theia-program";

const ROOT = path.resolve(import.meta.dirname, "../..");
const WAIT_MS = 60_000;
const POLL_MS = 200;

/** The editor the integration test runs in: $BEANS_TEST_EDITOR, "theia" or "vscode" (the default). */
export const EDITOR_KIND: EditorKind = process.env.BEANS_TEST_EDITOR === "theia" ? "theia" : "vscode";

/** A key for Input.dispatchKeyEvent: what the page's keydown sees. */
export interface Key {
	key: string;
	code: string;
	keyCode: number;
	ctrl?: boolean;
	alt?: boolean;
	shift?: boolean;
	/** Cmd on macOS. */
	meta?: boolean;
	/** Keys that type a character send it too, so inputs take it. */
	text?: string;
}

export const KEYS = {
	F1: { key: "F1", code: "F1", keyCode: 112 },
	Enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
	Escape: { key: "Escape", code: "Escape", keyCode: 27 },
} satisfies Record<string, Key>;

/** A keybinding to a command, with the arguments a Talon command would pass. */
export interface Keybinding {
	/** In VS Code's form, like "ctrl+alt+9"; Theia reads the same. */
	key: string;
	command: string;
	args?: unknown;
}

/** An editor running this checkout, reached through Beans's own relay, like the extension reaches it. */
export interface Editor {
	/** Runs an expression in the workbench page and returns its value; a promise is awaited. */
	evaluate<T>(expression: string): Promise<T>;
	/** Polls an expression in the page until it is truthy, and returns that value. */
	waitFor<T>(expression: string, what: string, timeoutMs?: number): Promise<T>;
	/** Presses a key in the window, as a user would. */
	press(key: Key): Promise<void>;
	/** Types text into whatever has the focus. */
	type(text: string): Promise<void>;
	/** Replaces the profile's keybindings; the editor picks them up on its own. */
	setKeybindings(bindings: Keybinding[]): void;
	/** Quits the editor and removes its temporary profile. */
	close(): Promise<void>;
}

/**
 * Starts EDITOR_KIND on the workspace with Beans from this checkout, through
 * the relay's start-now mode, and waits for the hints to appear in the
 * Explorer. The editor is downloaded: see the setups below for which version.
 */
export async function startEditor(workspace: string): Promise<Editor> {
	const setup = SETUPS[EDITOR_KIND];
	// The real path: on macOS the temporary folder is behind a symlink, and
	// Theia doesn't see changes to its keymaps under one.
	const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "beans-test-")));
	const launch = await setup.prepare(home, workspace);
	setUserDataDir(launch.dataDir);
	const relayFile = relayFilePath();

	const job = { command: launch.command, args: launch.args, relayFile };
	const relay = spawn(process.execPath, [path.join(ROOT, "dist", "cdp-relay.js"), JSON.stringify(job)], {
		stdio: ["ignore", "ignore", "inherit"],
		env: { ...process.env, ...launch.env },
	});
	const relayExited = new Promise<void>((resolve) => relay.once("exit", () => resolve()));
	// A test runner that dies mid-way (a timed-out hook) would leave the editor behind.
	const killRelay = () => relay.kill("SIGTERM");
	process.once("exit", killRelay);
	let client: RelayClient | undefined;
	const stop = async () => {
		// Browser.close quits the editor; the relay sees it exit, cleans up and
		// exits too. If that doesn't happen, the relay is killed, which closes
		// the pipe under the editor.
		await client?.send("Browser.close").catch(() => {});
		const killer = setTimeout(killRelay, 10_000);
		await relayExited;
		clearTimeout(killer);
		process.off("exit", killRelay);
		client?.close();
		// The editor may still be writing its profile for a moment after the kill path.
		fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
	};
	// The relay's log, for when it or the editor didn't start.
	const relayLog = () => {
		const log = path.join(launch.dataDir, "beans-relay.log");
		return fs.existsSync(log) ? `\n${fs.readFileSync(log, "utf8")}` : "";
	};

	try {
		// connectToRelay fails until the relay has written its file in full.
		client = await Promise.race([
			until(() => connectToRelay(), "the relay to start"),
			relayExited.then(() => {
				throw new Error(`the relay exited before it answered${relayLog()}`);
			}),
		]);
		const sessionId = await attachToWorkbench(client, setup.isWorkbench);
		const editor = makeEditor(client, sessionId, launch.setKeybindings, stop);
		await setup.ready(editor);
		return editor;
	} catch (error) {
		const log = relayLog();
		await stop();
		throw log ? new Error(`${error instanceof Error ? error.message : String(error)}${log}`, { cause: error }) : error;
	}
}

/** How to start one editor, find its window and know Beans is running in it. */
interface Setup {
	/** Makes a fresh profile in home, with Beans from this checkout, and says how to start the editor. */
	prepare(home: string, workspace: string): Promise<Launch>;
	isWorkbench: (url: string) => boolean;
	/** Waits until the Explorer shows with hints, opening it if the editor doesn't. */
	ready(editor: Editor): Promise<void>;
}

interface Launch {
	command: string;
	args: string[];
	env?: Record<string, string>;
	/** Where Beans and the relay look for the relay file: the folder setUserDataDir takes. */
	dataDir: string;
	setKeybindings: (bindings: Keybinding[]) => void;
}

const SETUPS: Record<EditorKind, Setup> = {
	// VS Code stable, or $VSCODE_VERSION, cached in .vscode-test/.
	vscode: {
		async prepare(home, workspace) {
			const program = await downloadAndUnzipVSCode({
				version: process.env.VSCODE_VERSION ?? "stable",
				reporter: new SilentReporter(),
			});
			const userDataDir = path.join(home, "user-data");
			fs.mkdirSync(path.join(userDataDir, "User"), { recursive: true });
			return {
				command: program,
				args: [
					"--remote-debugging-pipe",
					`--user-data-dir=${userDataDir}`,
					`--extensions-dir=${path.join(home, "extensions")}`,
					`--extensionDevelopmentPath=${ROOT}`,
					"--disable-workspace-trust",
					"--disable-updates",
					"--skip-welcome",
					"--skip-release-notes",
					"--no-cached-data",
					// Electron's sandbox doesn't work on the CI runners (microsoft/vscode#84238).
					...(process.platform === "linux" ? ["--no-sandbox", "--disable-gpu-sandbox"] : []),
					workspace,
				],
				dataDir: userDataDir,
				setKeybindings(bindings) {
					writeJson(path.join(userDataDir, "User", "keybindings.json"), bindings);
				},
			};
		},
		isWorkbench: (url) => url.startsWith("vscode-file://"),
		async ready(editor) {
			await editor.waitFor(
				`typeof window.__beans === "object" && document.querySelectorAll(".monaco-list-row[data-beans-hint]").length > 0`,
				"Beans to hint the Explorer",
			);
		},
	},
	// Theia IDE: see theia-program.ts for which. Its configuration folder,
	// THEIA_CONFIG_DIR, holds its settings, its plugins and the relay file,
	// so a temporary one keeps the run apart from the user's Theia. Beans is
	// a plugin there, linked to this checkout.
	theia: {
		async prepare(home, workspace) {
			const program = await theiaProgram();
			const configDir = path.join(home, "theia");
			fs.mkdirSync(path.join(configDir, "plugins"), { recursive: true });
			fs.symlinkSync(ROOT, path.join(configDir, "plugins", "beans"), "junction");
			writeJson(path.join(configDir, "settings.json"), {
				"security.workspace.trust.enabled": false,
				"workbench.startupEditor": "none",
			});
			return {
				command: program,
				args: [
					"--remote-debugging-pipe",
					`--user-data-dir=${path.join(home, "user-data")}`,
					...(process.platform === "linux" ? ["--no-sandbox", "--disable-gpu-sandbox"] : []),
					workspace,
				],
				env: { THEIA_CONFIG_DIR: configDir },
				dataDir: configDir,
				setKeybindings(bindings) {
					writeJson(
						path.join(configDir, "keymaps.json"),
						bindings.map(({ key, command, args }) => ({ keybinding: key, command, args })),
					);
				},
			};
		},
		// The frontend's page; the splash screen Theia shows while starting is a page too.
		isWorkbench: (url) => /\/lib\/frontend\/index\.html(?:[?#]|$)/.test(url),
		async ready(editor) {
			await editor.waitFor(`typeof window.__beans === "object"`, "Beans to load in Theia");
			// The left side panel stays collapsed until a view opens in it, so
			// press Show Explorer until it shows. Theia ignores keys for a
			// moment after the page loads.
			const mac = process.platform === "darwin";
			const showExplorer = { key: "E", code: "KeyE", keyCode: 69, shift: true, ctrl: !mac, meta: mac };
			const explorerShown = `!!document.querySelector("#theia-left-side-panel:not(.lm-mod-hidden) #files .theia-TreeNode")`;
			await until(async () => {
				if (await editor.evaluate<boolean>(explorerShown)) return true;
				await editor.press(showExplorer);
				return editor.waitFor<boolean>(explorerShown, "the Explorer", 2000).catch(() => false);
			}, "the Explorer to show");
			await editor.waitFor(
				`document.querySelectorAll("#files .theia-TreeNode[data-beans-hint]").length > 0`,
				"Beans to hint the Explorer",
			);
		},
	},
};

function writeJson(file: string, value: unknown): void {
	fs.writeFileSync(file, JSON.stringify(value, null, "\t"));
}

/** The workbench page's session, once the window exists. */
async function attachToWorkbench(client: RelayClient, isWorkbench: (url: string) => boolean): Promise<string> {
	interface TargetInfo {
		targetId: string;
		type: string;
		url: string;
	}
	const targetId = await until(async () => {
		const { targetInfos } = await client.send<{ targetInfos: TargetInfo[] }>("Target.getTargets");
		return targetInfos.find((target) => target.type === "page" && isWorkbench(target.url))?.targetId;
	}, "the editor's window");
	const { sessionId } = await client.send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
	return sessionId;
}

function makeEditor(
	client: RelayClient,
	sessionId: string,
	setKeybindings: (bindings: Keybinding[]) => void,
	stop: () => Promise<void>,
): Editor {
	interface Evaluation {
		result: { value?: unknown };
		exceptionDetails?: { text: string; exception?: { description?: string } };
	}
	const editor: Editor = {
		async evaluate<T>(expression: string): Promise<T> {
			const { result, exceptionDetails } = await client.send<Evaluation>(
				"Runtime.evaluate",
				{ expression, returnByValue: true, awaitPromise: true },
				sessionId,
			);
			if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
			// The caller names the shape of what its expression returns.
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion
			return result.value as T;
		},
		waitFor<T>(expression: string, what: string, timeoutMs = WAIT_MS): Promise<T> {
			return until(() => editor.evaluate<T>(expression), what, timeoutMs);
		},
		async press(key: Key): Promise<void> {
			const modifiers = (key.alt ? 1 : 0) | (key.ctrl ? 2 : 0) | (key.meta ? 4 : 0) | (key.shift ? 8 : 0);
			const event = {
				key: key.key,
				code: key.code,
				windowsVirtualKeyCode: key.keyCode,
				nativeVirtualKeyCode: key.keyCode,
				modifiers,
			};
			const type = key.text === undefined ? "rawKeyDown" : "keyDown";
			await client.send("Input.dispatchKeyEvent", { type, ...event, text: key.text }, sessionId);
			await client.send("Input.dispatchKeyEvent", { type: "keyUp", ...event }, sessionId);
		},
		async type(text: string): Promise<void> {
			await client.send("Input.insertText", { text }, sessionId);
		},
		setKeybindings,
		async close(): Promise<void> {
			await stop();
		},
	};
	return editor;
}

/** Polls until the check returns a truthy value, and returns it. Fails after the timeout, naming what it waited for. */
async function until<T>(check: () => T | Promise<T>, what: string, timeoutMs = WAIT_MS): Promise<NonNullable<T>> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		let value: T | undefined;
		try {
			value = await check();
		} catch {
			// Not ready yet: a relay file half written, a page not loaded.
		}
		if (value) return value;
		if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
		await new Promise((resolve) => setTimeout(resolve, POLL_MS));
	}
}
