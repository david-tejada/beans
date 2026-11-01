// Runs as plain Node, started by relaunch.ts (or scripts/dev.ts) with a
// RelayJob as its argument. Waits for the editor's main process to exit,
// starts the editor again with a debug pipe, and relays Chrome DevTools
// Protocol messages between that pipe and Beans in each window. Exits when
// the editor does.
import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { frame, isRelayAddress, isToken, parseMessage, readMessages, type RelayAddress } from "./relay-protocol";
import { isRecord } from "./shared/guards";

/** What the relay is asked to do. Without pid it starts the editor at once, for development. */
export interface RelayJob {
	/** The editor process to wait for before starting the new one. */
	pid?: number;
	command: string;
	args: string[];
	/** Where to write the relay's address and token. */
	relayFile: string;
}

main();

function main(): void {
	const job = parseJob(process.argv[2]);
	// Errors go in a log next to the relay file, since the relay has no terminal.
	const logFile = path.join(path.dirname(job.relayFile), "beans-relay.log");
	const log = (error: unknown) => appendLog(logFile, error);
	// When the relay dies, the pipe closes and the editor quits with it, so an
	// error anywhere here is logged and the relay goes on holding the pipe.
	process.on("uncaughtException", log);
	const start = () => startEditorWithRelay(job, log);
	if (job.pid === undefined) start();
	else whenExited(job.pid, start);
}

function parseJob(text: string | undefined): RelayJob {
	const value: unknown = text === undefined ? undefined : JSON.parse(text);
	if (!isRelayJob(value)) throw new Error("cdp-relay needs a job: { pid?, command, args, relayFile } as JSON");
	return value;
}

function isRelayJob(value: unknown): value is RelayJob {
	return (
		isRecord(value) &&
		(value.pid === undefined || typeof value.pid === "number") &&
		typeof value.command === "string" &&
		Array.isArray(value.args) &&
		value.args.every((arg) => typeof arg === "string") &&
		typeof value.relayFile === "string"
	);
}

/**
 * Calls then once the process is gone. Gives up after two minutes, for
 * example when the quit was canceled.
 */
function whenExited(pid: number, then: () => void): void {
	const deadline = Date.now() + 2 * 60 * 1000;
	const timer = setInterval(() => {
		if (isRunning(pid)) {
			if (Date.now() > deadline) process.exit();
			return;
		}
		clearInterval(timer);
		then();
	}, 500);
}

// Signal 0 checks that the process exists without touching it. EPERM means
// it exists but belongs to someone else.
function isRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return isRecord(error) && error.code === "EPERM";
	}
}

/**
 * Starts the editor with --remote-debugging-pipe, then lets Beans reach that
 * pipe through a local socket guarded by a token, which it writes to
 * relayFile. Only this user can read relayFile, so only this user's programs
 * can connect.
 */
function startEditorWithRelay({ command, args, relayFile }: RelayJob, log: (error: unknown) => void): void {
	const env = { ...process.env };
	delete env.ELECTRON_RUN_AS_NODE;
	// Chromium reads the pipe's commands from the 4th stream and writes
	// replies to the 5th.
	const editor = spawn(command, args, { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"], env });
	// With no editor there's no pipe to hold, so the relay has nothing to do.
	editor.once("error", (error) => {
		log(error);
		process.exit(1);
	});
	// The socket and relay file only make sense once the editor is running.
	editor.once("spawn", () => holdPipe(editor, relayFile, log));
}

/** Serves the editor's pipe to Beans until the editor exits, then cleans up and exits. */
function holdPipe(editor: ChildProcess, relayFile: string, log: (error: unknown) => void): void {
	const toEditor = editor.stdio[3];
	const fromEditor = editor.stdio[4];
	if (!(toEditor instanceof Writable) || !(fromEditor instanceof Readable)) {
		log(new Error("the editor was started without its pipe"));
		process.exit(1);
	}
	// The pipes break when the editor goes; its "exit" takes it from there.
	toEditor.on("error", () => {});
	fromEditor.on("error", () => {});

	const token = crypto.randomBytes(32).toString("hex");
	const { address, socketDir } = listenAddress();
	const relay = createRelay(toEditor, fromEditor, token, log);
	const server = net.createServer(relay.addClient);
	// Without the socket Beans can't connect, but the editor still runs.
	server.on("error", log);
	server.listen(address, () => writeRelayFile(relayFile, { address, token }));

	const cleanUp = () => {
		try {
			removeRelayFile(relayFile, token);
			if (socketDir) fs.rmSync(socketDir, { recursive: true, force: true });
		} finally {
			process.exit();
		}
	};
	editor.on("exit", cleanUp);
	// Nothing signals a detached relay, but `pnpm dev` kills its relay when it
	// stops; exiting closes the pipe and the editor with it.
	process.on("SIGTERM", cleanUp);
	process.on("SIGINT", cleanUp);
}

/**
 * A fresh socket address. On macOS and Linux, a socket file in a new folder
 * only this user can open (mkdtemp makes it mode 0700), kept short because
 * socket paths are limited to about 103 characters. On Windows, a named pipe,
 * which the token protects instead.
 */
function listenAddress(): { address: string; socketDir?: string } {
	const name = crypto.randomBytes(8).toString("hex");
	if (process.platform === "win32") return { address: `\\\\.\\pipe\\beans-${name}` };
	const socketDir = fs.mkdtempSync(path.join(os.tmpdir(), "beans-"));
	return { address: path.join(socketDir, "relay.sock"), socketDir };
}

/**
 * Passes messages from every client to the editor's pipe, and each reply back
 * to the client that asked. Clients pick their own message ids, so the relay
 * renumbers them on the way in and restores them on the way out. Events
 * (messages without an id) are dropped, since Beans doesn't use them.
 */
function createRelay(
	toEditor: Writable,
	fromEditor: Readable,
	token: string,
	log: (error: unknown) => void,
): { addClient: (socket: net.Socket) => void } {
	let nextId = 0;
	const pending = new Map<number, { socket: net.Socket; id: number | undefined }>();

	readMessages(fromEditor, (text) => {
		const message = parseMessage(text);
		const request = message?.id === undefined ? undefined : pending.get(message.id);
		if (!message || !request) return;
		pending.delete(message.id!);
		if (!request.socket.destroyed) request.socket.write(frame({ ...message, id: request.id }));
	});

	function addClient(socket: net.Socket): void {
		let trusted = false;
		socket.on("error", () => {});
		readMessages(socket, (text) => {
			if (!trusted) {
				trusted = isToken(text, token);
				if (!trusted) socket.destroy();
				return;
			}
			const message = parseMessage(text);
			// A client that doesn't speak JSON is dropped, like one without the token.
			if (!message) {
				log(new Error("a client sent a message that isn't JSON"));
				socket.destroy();
				return;
			}
			const id = ++nextId;
			pending.set(id, { socket, id: message.id });
			toEditor.write(frame({ ...message, id }));
		});
	}

	return { addClient };
}

// Removing the file first makes sure the new one is created with mode 0600.
function writeRelayFile(relayFile: string, contents: RelayAddress): void {
	fs.rmSync(relayFile, { force: true });
	fs.writeFileSync(relayFile, JSON.stringify(contents), { mode: 0o600 });
}

// A relay started by a later relaunch may already have written its own file
// by the time this editor exits, so only the file with this token is removed.
function removeRelayFile(relayFile: string, token: string): void {
	try {
		const contents: unknown = JSON.parse(fs.readFileSync(relayFile, "utf8"));
		if (isRelayAddress(contents) && contents.token === token) fs.rmSync(relayFile);
	} catch {}
}

/** Appends an error to the relay's log, which only this user can read. Never throws. */
function appendLog(logFile: string, error: unknown): void {
	try {
		const text = error instanceof Error ? (error.stack ?? error.message) : String(error);
		fs.appendFileSync(logFile, `${new Date().toISOString()} ${text}\n`, { mode: 0o600 });
	} catch {}
}
