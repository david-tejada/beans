const fs = require("fs");
const net = require("net");
const path = require("path");

const COMMAND_TIMEOUT_MS = 10_000;

let userDataDir;

/**
 * Sets the editor's user data folder, where the relay leaves the address and
 * token to reach it. Call it once, before anything else here.
 */
function setUserDataDir(dir) {
	userDataDir = dir;
}

/**
 * Connects to the relay that holds the editor's debug pipe (cdp-relay.js).
 * Returns a client that sends Chrome DevTools Protocol commands through it:
 * send(method, params, sessionId) resolves to the command's result.
 */
async function connectToRelay() {
	const { address, token } = readRelayFile();
	const socket = await openSocket(address);
	// The relay drops any connection whose first message isn't its token.
	socket.write(token + "\0");

	let nextId = 0;
	const pending = new Map();
	readMessages(socket, (text) => {
		const message = JSON.parse(text);
		const request = pending.get(message.id);
		if (!request) return;
		pending.delete(message.id);
		if (message.error) request.reject(new Error(message.error.message));
		else request.resolve(message.result);
	});
	socket.on("close", () => {
		for (const request of pending.values()) request.reject(new Error("the relay closed the connection"));
		pending.clear();
	});

	return {
		send(method, params = {}, sessionId) {
			return new Promise((resolve, reject) => {
				const id = ++nextId;
				const timer = setTimeout(() => {
					pending.delete(id);
					reject(new Error(`no answer to ${method}`));
				}, COMMAND_TIMEOUT_MS);
				const settle = (fn) => (value) => {
					clearTimeout(timer);
					fn(value);
				};
				pending.set(id, { resolve: settle(resolve), reject: settle(reject) });
				socket.write(JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) }) + "\0");
			});
		},
		close() {
			socket.end();
		},
	};
}

function getUserDataDir() {
	return userDataDir;
}

/** Where the relay writes { address, token }, readable only by this user. */
function relayFilePath() {
	return path.join(userDataDir, "beans-relay.json");
}

function readRelayFile() {
	try {
		return JSON.parse(fs.readFileSync(relayFilePath(), "utf8"));
	} catch {
		throw new Error("it wasn't started by Beans: Relaunch with hints");
	}
}

function openSocket(address) {
	return new Promise((resolve, reject) => {
		const socket = net.connect(address);
		socket.once("connect", () => {
			// Later errors end in "close", which rejects what's pending.
			socket.on("error", () => {});
			resolve(socket);
		});
		socket.once("error", (error) => reject(new Error("the relay isn't running", { cause: error })));
	});
}

/**
 * Calls onMessage with the text of each message on a stream. Messages end in
 * "\0", the framing Chromium uses on its debug pipe.
 */
function readMessages(stream, onMessage) {
	let buffer = "";
	stream.setEncoding("utf8");
	stream.on("data", (chunk) => {
		buffer += chunk;
		let end;
		while ((end = buffer.indexOf("\0")) >= 0) {
			const text = buffer.slice(0, end);
			buffer = buffer.slice(end + 1);
			onMessage(text);
		}
	});
}

module.exports = { setUserDataDir, getUserDataDir, connectToRelay, relayFilePath, readMessages };
