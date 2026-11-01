import * as vscode from "vscode";

// The "Beans" Output Channel: what happened, for a bug report. Toasts stay
// for what the user has to act on.

let channel: vscode.OutputChannel | undefined;

/** Creates the channel; activate() does it once. */
export function createOutput(): vscode.OutputChannel {
	channel ??= vscode.window.createOutputChannel("Beans");
	return channel;
}

export function log(message: string): void {
	channel?.appendLine(`${new Date().toISOString()} ${message}`);
}

export function logError(context: string, error: unknown): void {
	log(`${context}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
}
