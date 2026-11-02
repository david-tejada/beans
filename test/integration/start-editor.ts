import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { downloadAndUnzipVSCode, SilentReporter } from "@vscode/test-electron";
import { connectToRelay, relayFilePath, setUserDataDir, type RelayClient } from "../../src/relay-connection";

const ROOT = path.resolve(import.meta.dirname, "../..");
const WAIT_MS = 60_000;
const POLL_MS = 200;

/** A key for Input.dispatchKeyEvent: what the page's keydown sees. */
export interface Key {
	key: string;
	code: string;
	keyCode: number;
	ctrl?: boolean;
	alt?: boolean;
	shift?: boolean;
	/** Keys that type a character send it too, so inputs take it. */
	text?: string;
}

export const KEYS = {
	F1: { key: "F1", code: "F1", keyCode: 112 },
	Enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
	Escape: { key: "Escape", code: "Escape", keyCode: 27 },
} satisfies Record<string, Key>;

/** A VS Code running this checkout, reached through Beans's own relay, like the extension reaches it. */
export interface Editor {
	/** Runs an expression in the workbench page and returns its value; a promise is awaited. */
	evaluate<T>(expression: string): Promise<T>;
	/** Polls an expression in the page until it is truthy, and returns that value. */
	waitFor<T>(expression: string, what: string, timeoutMs?: number): Promise<T>;
	/** Presses a key in the window, as a user would. */
	press(key: Key): Promise<void>;
	/** Types text into whatever has the focus. */
	type(text: string): Promise<void>;
	/** Replaces the profile's keybindings.json; VS Code picks it up on its own. */
	setKeybindings(bindings: object[]): void;
	/** Quits the editor and removes its temporary profile. */
	close(): Promise<void>;
}

/**
 * Downloads VS Code (stable, or $VSCODE_VERSION; cached in .vscode-test/),
 * starts it on the workspace with Beans from this checkout through the
 * relay's start-now mode, and waits for the hints to appear.
 */
export async function startEditor(workspace: string): Promise<Editor> {
	const program = await downloadAndUnzipVSCode({
		version: process.env.VSCODE_VERSION ?? "stable",
		reporter: new SilentReporter(),
	});
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "beans-test-"));
	const userDataDir = path.join(home, "user-data");
	fs.mkdirSync(path.join(userDataDir, "User"), { recursive: true });
	setUserDataDir(userDataDir);
	const relayFile = relayFilePath();

	const job = {
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
		relayFile,
	};
	const relay = spawn(process.execPath, [path.join(ROOT, "dist", "cdp-relay.js"), JSON.stringify(job)], {
		stdio: ["ignore", "ignore", "inherit"],
	});
	const relayExited = new Promise<void>((resolve) => relay.once("exit", () => resolve()));
	// A test runner that dies mid-way (a timed-out hook) would leave VS Code behind.
	const killRelay = () => relay.kill("SIGTERM");
	process.once("exit", killRelay);
	let client: RelayClient | undefined;
	const stop = async () => {
		// Browser.close quits VS Code; the relay sees it exit, cleans up and
		// exits too. If that doesn't happen, the relay is killed, which closes
		// the pipe under VS Code.
		await client?.send("Browser.close").catch(() => {});
		const killer = setTimeout(killRelay, 10_000);
		await relayExited;
		clearTimeout(killer);
		process.off("exit", killRelay);
		client?.close();
		// VS Code may still be writing its profile for a moment after the kill path.
		fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
	};
	// The relay's log, for when it or VS Code didn't start.
	const relayLog = () => {
		const log = path.join(userDataDir, "beans-relay.log");
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
		const sessionId = await attachToWorkbench(client);
		const editor = makeEditor(client, sessionId, userDataDir, stop);
		await editor.waitFor(
			`typeof window.__beans === "object" && document.querySelectorAll(".monaco-list-row[data-beans-hint]").length > 0`,
			"Beans to hint the Explorer",
		);
		return editor;
	} catch (error) {
		const log = relayLog();
		await stop();
		throw log ? new Error(`${error instanceof Error ? error.message : String(error)}${log}`, { cause: error }) : error;
	}
}

/** The workbench page's session, once the window exists. */
async function attachToWorkbench(client: RelayClient): Promise<string> {
	interface TargetInfo {
		targetId: string;
		type: string;
		url: string;
	}
	const targetId = await until(async () => {
		const { targetInfos } = await client.send<{ targetInfos: TargetInfo[] }>("Target.getTargets");
		return targetInfos.find((target) => target.type === "page" && target.url.startsWith("vscode-file://"))?.targetId;
	}, "the VS Code window");
	const { sessionId } = await client.send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
	return sessionId;
}

function makeEditor(client: RelayClient, sessionId: string, userDataDir: string, stop: () => Promise<void>): Editor {
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
			const modifiers = (key.alt ? 1 : 0) | (key.ctrl ? 2 : 0) | (key.shift ? 8 : 0);
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
		setKeybindings(bindings: object[]): void {
			fs.writeFileSync(path.join(userDataDir, "User", "keybindings.json"), JSON.stringify(bindings, null, "\t"));
		},
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
