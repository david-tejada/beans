import fs from "node:fs";
import path from "node:path";
import * as vscode from "vscode";
import { callPage, injectAll, type PageFiles } from "./inject";
import { createOutput } from "./output";
import { userDataDir } from "./paths";
import { relaunch, reportError, setDevelopment } from "./relaunch";
import { setUserDataDir } from "./relay-connection";
import { hintFrom, isRecord, resizeRequestFrom, scrollDirectionFrom } from "./requests";
import { isHintStyle } from "./hint-style";
import type { PageSettings, ResizeRequest } from "./shared/types";
import { registerTargetCommands } from "./target-commands";

/** What inject needs about the page: the files to run and the status bar item that carries requests. */
interface Page {
	files: PageFiles;
	channelId: string;
}

export function activate(context: vscode.ExtensionContext): void {
	context.subscriptions.push(createOutput());
	setUserDataDir(userDataDir(context.globalStorageUri.fsPath));
	const page: Page = {
		files: {
			script: path.join(context.extensionPath, "dist", "beans.js"),
			style: path.join(context.extensionPath, "media", "beans.css"),
		},
		channelId: `${context.extension.id}.channel`,
	};
	const channel = createChannel();
	context.subscriptions.push(channel);

	context.subscriptions.push(
		vscode.commands.registerCommand("beans.pick", (letters: unknown) => {
			// Letters pick a sidebar row, numbers a Command Palette row.
			const hint = hintFrom(letters);
			if (hint) send(channel, "pick", hint);
		}),
		vscode.commands.registerCommand("beans.rowPoint", rowPoint),
		vscode.commands.registerCommand("beans.toggle", () => send(channel, "toggle")),
		// direction: "up", "down", "top" or "bottom". letters: optional hint
		// of a row in the list to scroll.
		vscode.commands.registerCommand("beans.scroll", (direction: unknown, letters: unknown) => {
			const where = scrollDirectionFrom(direction);
			if (where) send(channel, "scroll", `${where}-${hintFrom(letters).replace(/[0-9]/g, "")}`);
		}),
		vscode.commands.registerCommand("beans.resize", async (request: unknown) => {
			const parsed = resizeRequestFrom(request);
			if (parsed) await resize(parsed);
			else warn("that resize request names nothing to resize");
		}),
		// { quiet: true } skips the message saying how many windows got the script.
		vscode.commands.registerCommand("beans.inject", (options: unknown) =>
			inject(page, channel, { quiet: isRecord(options) && options.quiet === true }),
		),
		vscode.commands.registerCommand("beans.relaunch", relaunch),
		// A new hint style reaches the windows through a fresh injection.
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration("beans.hintStyle")) void inject(page, channel, { quiet: true });
		}),
	);

	registerTargetCommands(context);
	const isDevelopment = context.extensionMode === vscode.ExtensionMode.Development;
	setDevelopment(isDevelopment);
	if (isDevelopment) watchPageFiles(page, channel, context);

	void inject(page, channel, { quiet: true });
}

/**
 * While developing (pnpm dev), re-injects the page script and stylesheet
 * whenever the build rewrites them, in place of running Beans: Inject.
 * Polling, since the bundler replaces the files rather than editing them.
 */
function watchPageFiles(page: Page, channel: vscode.StatusBarItem, context: vscode.ExtensionContext): void {
	let timer: NodeJS.Timeout | undefined;
	for (const file of Object.values(page.files)) {
		fs.watchFile(file, { interval: 300 }, () => {
			clearTimeout(timer);
			timer = setTimeout(() => void inject(page, channel, { quiet: true }), 300);
		});
		context.subscriptions.push({ dispose: () => fs.unwatchFile(file) });
	}
}

export function deactivate(): void {}

/**
 * Creates the status bar item that carries requests to the hint script.
 *
 * The extension host can't reach the page, but VS Code renders the item's
 * text in the page, where the script watches it. Each window has its own
 * status bar, so a request only reaches the window that got the command.
 * It's shown once the page has the rule that hides it (inject).
 */
function createChannel(): vscode.StatusBarItem {
	const channel = vscode.window.createStatusBarItem("channel", vscode.StatusBarAlignment.Left, -10000);
	channel.name = "Beans channel";
	channel.text = "beans:0:idle:";
	return channel;
}

let counter = 0;

/** Sends a request to the page. The counter makes repeated requests distinct. */
function send(channel: vscode.StatusBarItem, command: "pick" | "toggle" | "scroll", arg = ""): void {
	counter += 1;
	channel.text = `beans:${counter}:${command}:${arg}`;
}

/**
 * Returns where to right-click the row with this hint, as { x, y } fractions
 * of the focused window's width and height, for Talon to click there. Warns
 * and returns null when there's no such row.
 */
async function rowPoint(letters: unknown): Promise<{ x: number; y: number } | null> {
	const hint = hintFrom(letters);
	if (!hint) return null;
	let point;
	try {
		point = await callPage("rowPoint", hint);
	} catch (error) {
		await reportError(error);
		return null;
	}
	if (!point) vscode.window.showWarningMessage(`Beans: no row with hint ${hint.toUpperCase()}.`);
	return point ?? null;
}

/** Resizes a part or a sidebar view in the focused window, and says when it couldn't. */
async function resize(request: ResizeRequest): Promise<void> {
	let result;
	try {
		result = await callPage("resize", request);
	} catch (error) {
		await reportError(error);
		return;
	}
	// VS Code stops a sash at the sizes the views on either side allow.
	if ("problem" in result) warn(result.problem);
	else if (request.to !== undefined && Math.abs(result.after - request.to) > 1) {
		warn(`the ${result.name} stopped at ${result.after}px`);
	} else if (request.by && result.after === result.before) {
		warn(`the ${result.name} can't get any ${request.by > 0 ? "bigger" : "smaller"}`);
	}
}

function warn(message: string): void {
	vscode.window.showWarningMessage(`Beans: ${message}.`);
}

/**
 * Injects the hint script into every window, and explains what to do when
 * that fails. Resolves to whether it could.
 */
async function inject(page: Page, channel: vscode.StatusBarItem, { quiet }: { quiet: boolean }): Promise<boolean> {
	try {
		const count = await injectAll(page.files, page.channelId, settings());
		channel.show();
		if (!quiet) vscode.window.showInformationMessage(`Beans injected its script into ${count} window(s).`);
		return true;
	} catch (error) {
		await reportError(error);
		return false;
	}
}

/** The user's settings for the page (see injectAll). */
function settings(): PageSettings {
	const hintStyle = vscode.workspace.getConfiguration("beans").get<string>("hintStyle", "default");
	return { hintStyle: isHintStyle(hintStyle) ? hintStyle : "default" };
}
