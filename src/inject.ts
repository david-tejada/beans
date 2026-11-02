import crypto from "node:crypto";
import fs from "node:fs";
import { connectToRelay, type RelayClient } from "./relay-connection";
import { hintSpacingRule } from "./hint-spacing";
import { log } from "./output";
import type { PageApi, PageSettings } from "./shared/types";

/** An exception thrown by the page's own code, as opposed to a failure to reach it. */
export class PageError extends Error {}

/** Thrown when the focused window doesn't have the hint script, so there's nothing to call. */
export class NotInjectedError extends Error {}

/** The built hint script and its stylesheet. */
export interface PageFiles {
	script: string;
	style: string;
}

// What a page without the hint script answers in place of a call.
const NOT_INJECTED = "beans:not-injected";

/** A page the debug pipe can reach, as Target.getTargets lists it. */
interface PageTarget {
	targetId: string;
	type: string;
	url: string;
}

/**
 * Runs the hint script and its styles in every VS Code window, through the
 * Chrome DevTools Protocol on VS Code's debug pipe, which the relay holds
 * (cdp-relay.ts). Windows that already run this version are left alone.
 * channelId is the DOM id of the status bar item that carries requests.
 * Returns how many windows were injected. A window that fails is skipped,
 * unless every window fails.
 */
export async function injectAll(files: PageFiles, channelId: string, settings: PageSettings): Promise<number> {
	const expression = injectionScript(files, channelId, settings);
	return withRelay(async (relay) => {
		const pages = await workbenchPages(relay);
		const results = await Promise.allSettled(pages.map((page) => evaluate(relay, page, expression)));
		const failed = results.filter((result) => result.status === "rejected");
		if (failed.length > 0 && failed.length === pages.length) throw failed[0]!.reason;
		const count = results.filter((result) => result.status === "fulfilled" && result.value === true).length;
		log(`injected ${count} of ${pages.length} window(s)${failed.length ? `, ${failed.length} failed` : ""}`);
		return count;
	});
}

/**
 * Calls a function of the hint script (window.__beans) in the VS Code window
 * that has focus, the one a Talon command was spoken to, and resolves to its
 * value. Throws NotInjectedError when that window has no script, for example
 * because it was still being built when Beans injected on startup, so callers
 * can put that right instead of doing nothing.
 */
export async function callPage<Name extends keyof PageApi>(
	name: Name,
	...args: Parameters<PageApi[Name]>
): Promise<Awaited<ReturnType<PageApi[Name]>>> {
	const call = `window.__beans.${name}(${args.map((arg) => JSON.stringify(arg)).join(", ")})`;
	const value = await evaluateInFocusedWindow(`window.__beans ? ${call} : ${JSON.stringify(NOT_INJECTED)}`);
	if (value === NOT_INJECTED) throw new NotInjectedError("this window didn't have the hint script");
	// The page is Beans's own code, so its answer is trusted to have the declared shape.
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion
	return value as Awaited<ReturnType<PageApi[Name]>>;
}

async function evaluateInFocusedWindow(expression: string): Promise<unknown> {
	return withRelay(async (relay) => {
		const pages = await workbenchPages(relay);
		// A window that doesn't answer counts as not focused.
		const focused = await Promise.allSettled(pages.map((page) => evaluate(relay, page, "document.hasFocus()")));
		const page =
			pages.length === 1
				? pages[0]
				: pages[focused.findIndex((result) => result.status === "fulfilled" && result.value === true)];
		if (!page) throw new Error("no focused VS Code window");
		return evaluate(relay, page, expression);
	});
}

/** Connects to the relay for the length of one action. */
async function withRelay<T>(action: (relay: RelayClient) => Promise<T>): Promise<T> {
	const relay = await connectToRelay();
	try {
		return await action(relay);
	} finally {
		relay.close();
	}
}

// Editor windows are pages served from vscode-file://, which forks of VS
// Code keep.
async function workbenchPages(relay: RelayClient): Promise<PageTarget[]> {
	const { targetInfos } = await relay.send<{ targetInfos: PageTarget[] }>("Target.getTargets");
	return targetInfos.filter((target) => target.type === "page" && target.url.startsWith("vscode-file://"));
}

// The version is a hash of the files and the settings, so editing the files
// and running "Beans: Inject" again, or changing a setting, replaces the old
// copy in every window. The channel's id holds the publisher, so the script
// and the rule hiding the channel get it from here.
function injectionScript(files: PageFiles, channelId: string, settings: PageSettings): string {
	const js = fs.readFileSync(files.script, "utf8");
	const css = fs.readFileSync(files.style, "utf8");
	const settingsRule = hintSpacingRule(settings.hintSpacing);
	const version = crypto
		.createHash("sha256")
		.update(js)
		.update(css)
		.update(channelId)
		.update(settingsRule)
		.digest("hex")
		.slice(0, 12);
	return `(() => {
		// Other editor windows, such as the Process Explorer, have no workbench.
		if (!document.querySelector(".monaco-workbench")) return false;
		if (window.__beansVersion === ${JSON.stringify(version)}) return false;
		window.__beansChannelId = ${JSON.stringify(channelId)};
		document.getElementById("beans-style")?.remove();
		const style = document.createElement("style");
		style.id = "beans-style";
		const hideChannel = "#" + CSS.escape(window.__beansChannelId) + " { display: none !important; }";
		style.textContent = ${JSON.stringify(css)} + " " + hideChannel + " " + ${JSON.stringify(settingsRule)};
		document.head.append(style);
		${js}
		// Marked last, so a script that throws is tried again by the next inject.
		window.__beansVersion = ${JSON.stringify(version)};
		return true;
	})()`;
}

interface EvaluateResult {
	result: { value?: unknown };
	exceptionDetails?: { text: string; exception?: { description?: string } };
}

/**
 * Evaluates an expression in one page and resolves to its value. The pipe
 * reaches the whole browser, so it attaches to the page for one evaluation.
 */
async function evaluate(relay: RelayClient, page: PageTarget, expression: string): Promise<unknown> {
	const { sessionId } = await relay.send<{ sessionId: string }>("Target.attachToTarget", {
		targetId: page.targetId,
		flatten: true,
	});
	try {
		const { result, exceptionDetails } = await relay.send<EvaluateResult>(
			"Runtime.evaluate",
			{ expression, returnByValue: true, awaitPromise: true },
			sessionId,
		);
		if (exceptionDetails) throw new PageError(exceptionDetails.exception?.description ?? exceptionDetails.text);
		return result.value;
	} finally {
		await relay.send("Target.detachFromTarget", { sessionId });
	}
}
