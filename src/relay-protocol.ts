import crypto from "node:crypto";
import { isRecord } from "./shared/guards";

// How the relay and its clients talk: JSON messages, each ended by "\0",
// the framing Chromium uses on its debug pipe, so the relay can pass them
// through. Shared by cdp-relay.ts and relay-connection.ts.

/** A message from the editor's debug pipe: a reply to a command, or an event (no id). */
export interface CdpMessage {
	id?: number;
	sessionId?: string;
	method?: string;
	result?: unknown;
	error?: { message: string };
}

/** What the relay writes for its clients: where to connect and what to say first. */
export interface RelayAddress {
	address: string;
	token: string;
}

export function isRelayAddress(value: unknown): value is RelayAddress {
	return isRecord(value) && typeof value.address === "string" && typeof value.token === "string";
}

/** Frames a message for the pipe or a socket. */
export function frame(message: object): string {
	return `${JSON.stringify(message)}\0`;
}

/** Calls onMessage with the text of each message on a stream. */
export function readMessages(stream: NodeJS.ReadableStream, onMessage: (text: string) => void): void {
	let buffer = "";
	stream.setEncoding("utf8");
	stream.on("data", (chunk: string | Buffer) => {
		buffer += chunk.toString();
		let end;
		while ((end = buffer.indexOf("\0")) >= 0) {
			const text = buffer.slice(0, end);
			buffer = buffer.slice(end + 1);
			onMessage(text);
		}
	});
}

/** The message as an object, or null when the text isn't a JSON object. */
export function parseMessage(text: string): CdpMessage | null {
	try {
		const value: unknown = JSON.parse(text);
		// Every field of a message is optional, so any object is one.
		return isRecord(value) ? value : null;
	} catch {
		return null;
	}
}

/** Whether a client's first message is the relay's token, in time that doesn't depend on how much of it is right. */
export function isToken(text: string, token: string): boolean {
	const given = Buffer.from(text);
	const expected = Buffer.from(token);
	return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

/** The flag relaunch.ts passes so the relay starts its real copy under no parent (cdp-relay.ts). */
export const DETACH = "--detach";
