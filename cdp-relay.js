// Runs as plain Node, started by relaunch.js with { pid, command, args,
// relayFile } as its argument. Waits for the editor's main process to exit,
// starts the editor again with a debug pipe, and relays Chrome DevTools
// Protocol messages between that pipe and Beans in each window. Exits when
// the editor does.
const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { readMessages } = require("./relay-connection");

const job = JSON.parse(process.argv[2]);
// Errors go in a log next to the relay file, since the relay has no terminal.
const LOG_FILE = path.join(path.dirname(job.relayFile), "beans-relay.log");

// When the relay dies, the pipe closes and the editor quits with it, so an
// error anywhere here is logged and the relay goes on holding the pipe.
process.on("uncaughtException", (error) => log(error));
whenExited(job.pid, () => startEditorWithRelay(job));

/**
 * Calls then once the process is gone. Gives up after two minutes, for
 * example when the quit was canceled.
 */
function whenExited(pid, then) {
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
function isRunning(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error.code === "EPERM";
	}
}

/**
 * Starts the editor with --remote-debugging-pipe, then lets Beans reach that
 * pipe through a local socket guarded by a token, which it writes to
 * relayFile. Only this user can read relayFile, so only this user's programs
 * can connect.
 */
function startEditorWithRelay({ command, args, relayFile }) {
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
	editor.once("spawn", () => holdPipe(editor, relayFile));
}

/** Serves the editor's pipe to Beans until the editor exits, then cleans up and exits. */
function holdPipe(editor, relayFile) {
	const toEditor = editor.stdio[3];
	const fromEditor = editor.stdio[4];
	// The pipes break when the editor goes; its "exit" takes it from there.
	toEditor.on("error", () => {});
	fromEditor.on("error", () => {});

	const token = crypto.randomBytes(32).toString("hex");
	const { address, socketDir } = listenAddress();
	const relay = createRelay(toEditor, fromEditor, token);
	const server = net.createServer(relay.addClient);
	// Without the socket Beans can't connect, but the editor still runs.
	server.on("error", (error) => log(error));
	server.listen(address, () => writeRelayFile(relayFile, { address, token }));

	editor.on("exit", () => {
		try {
			removeRelayFile(relayFile, token);
			if (socketDir) fs.rmSync(socketDir, { recursive: true, force: true });
		} finally {
			process.exit();
		}
	});
}

/**
 * A fresh socket address. On macOS and Linux, a socket file in a new folder
 * only this user can open (mkdtemp makes it mode 0700), kept short because
 * socket paths are limited to about 103 characters. On Windows, a named pipe,
 * which the token protects instead.
 */
function listenAddress() {
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
function createRelay(toEditor, fromEditor, token) {
	let nextId = 0;
	const pending = new Map();

	readMessages(fromEditor, (text) => {
		const message = parseMessage(text);
		const request = message && pending.get(message.id);
		if (!request) return;
		pending.delete(message.id);
		if (!request.socket.destroyed) request.socket.write(JSON.stringify({ ...message, id: request.id }) + "\0");
	});

	function addClient(socket) {
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
			toEditor.write(JSON.stringify({ ...message, id }) + "\0");
		});
	}

	return { addClient };
}

/** The message as an object, or null when the text isn't JSON. */
function parseMessage(text) {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

// timingSafeEqual takes as long whatever the text, so timing doesn't reveal
// how much of a guess was right.
function isToken(text, token) {
	const given = Buffer.from(text);
	const expected = Buffer.from(token);
	return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

// Removing the file first makes sure the new one is created with mode 0600.
function writeRelayFile(relayFile, contents) {
	fs.rmSync(relayFile, { force: true });
	fs.writeFileSync(relayFile, JSON.stringify(contents), { mode: 0o600 });
}

// A relay started by a later relaunch may already have written its own file
// by the time this editor exits, so only the file with this token is removed.
function removeRelayFile(relayFile, token) {
	try {
		if (JSON.parse(fs.readFileSync(relayFile, "utf8")).token === token) fs.rmSync(relayFile);
	} catch {}
}

/** Appends an error to the relay's log, which only this user can read. Never throws. */
function log(error) {
	try {
		fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${error?.stack ?? error}\n`, { mode: 0o600 });
	} catch {}
}
