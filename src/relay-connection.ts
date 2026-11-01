import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { frame, isRelayAddress, parseMessage, readMessages, type RelayAddress } from "./relay-protocol";

const COMMAND_TIMEOUT_MS = 10_000;

/** A connection to the relay, sending Chrome DevTools Protocol commands through it. */
export interface RelayClient {
	/** Resolves to the command's result. sessionId addresses a page the client attached to. */
	send<T = unknown>(method: string, params?: object, sessionId?: string): Promise<T>;
	close(): void;
}

let userDataDir: string | undefined;

/**
 * Sets the editor's user data folder, where the relay leaves the address and
 * token to reach it. Call it once, before anything else here.
 */
export function setUserDataDir(dir: string): void {
	userDataDir = dir;
}

export function getUserDataDir(): string {
	if (userDataDir === undefined) throw new Error("the user data folder isn't set yet");
	return userDataDir;
}

/** Where the relay writes { address, token }, readable only by this user. */
export function relayFilePath(): string {
	return path.join(getUserDataDir(), "beans-relay.json");
}

/** Connects to the relay that holds the editor's debug pipe (cdp-relay.ts). */
export async function connectToRelay(): Promise<RelayClient> {
	const { address, token } = readRelayFile(relayFilePath());
	const socket = await openSocket(address);
	// The relay drops any connection whose first message isn't its token.
	socket.write(`${token}\0`);

	let nextId = 0;
	const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
	readMessages(socket, (text) => {
		const message = parseMessage(text);
		const request = message?.id === undefined ? undefined : pending.get(message.id);
		if (!message || !request) return;
		pending.delete(message.id!);
		if (message.error) request.reject(new Error(message.error.message));
		else request.resolve(message.result);
	});
	socket.on("close", () => {
		for (const request of pending.values()) request.reject(new Error("the relay closed the connection"));
		pending.clear();
	});

	return {
		send<T>(method: string, params: object = {}, sessionId?: string): Promise<T> {
			return new Promise<T>((resolve, reject) => {
				const id = ++nextId;
				const timer = setTimeout(() => {
					pending.delete(id);
					reject(new Error(`no answer to ${method}`));
				}, COMMAND_TIMEOUT_MS);
				pending.set(id, {
					resolve: (value) => {
						clearTimeout(timer);
						// A CDP result has the shape its method documents; the caller names it.
						// oxlint-disable-next-line typescript/no-unsafe-type-assertion
						resolve(value as T);
					},
					reject: (error) => {
						clearTimeout(timer);
						reject(error);
					},
				});
				socket.write(frame({ id, method, params, ...(sessionId && { sessionId }) }));
			});
		},
		close() {
			socket.end();
		},
	};
}

function readRelayFile(file: string): RelayAddress {
	let parsed: unknown;
	try {
		parsed = JSON.parse(fs.readFileSync(file, "utf8"));
	} catch {
		throw new Error("it wasn't started by Beans: Relaunch with hints");
	}
	if (!isRelayAddress(parsed)) throw new Error("its relay file can't be read");
	return parsed;
}

function openSocket(address: string): Promise<net.Socket> {
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
