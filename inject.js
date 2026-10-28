const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { connectToRelay } = require("./relay-connection");

/** An exception thrown by the page's own code, as opposed to a failure to reach it. */
class PageError extends Error {}

/** Thrown when the focused window doesn't have the hint script, so there's nothing to call. */
class NotInjectedError extends Error {}

// What a page without the hint script answers in place of a call.
const NOT_INJECTED = "beans:not-injected";

/**
 * Runs media/beans.js and media/beans.css in every VS Code window, through
 * the Chrome DevTools Protocol on VS Code's debug pipe, which the relay holds
 * (cdp-relay.js). Windows that already run this version are left alone.
 * channelId is the DOM id of the status bar item that carries requests.
 * Returns how many windows were injected. A window that fails is skipped,
 * unless every window fails.
 */
async function injectAll(mediaDir, channelId) {
	const expression = injectionScript(mediaDir, channelId);
	return withRelay(async (relay) => {
		const pages = await workbenchPages(relay);
		const results = await Promise.allSettled(pages.map((page) => evaluate(relay, page, expression)));
		const failed = results.filter((result) => result.status === "rejected");
		if (failed.length > 0 && failed.length === pages.length) throw failed[0].reason;
		return results.filter((result) => result.value === true).length;
	});
}

/**
 * Calls a function of the hint script (window.__beans in media/beans.js) in
 * the VS Code window that has focus, the one a Talon command was spoken to,
 * and resolves to its value. Throws NotInjectedError when that window has no
 * script, for example because it was still being built when Beans injected
 * on startup, so callers can put that right instead of doing nothing.
 */
async function callPage(name, ...args) {
	const call = `window.__beans.${name}(${args.map((arg) => JSON.stringify(arg)).join(", ")})`;
	const value = await evaluateInFocusedWindow(`window.__beans ? ${call} : ${JSON.stringify(NOT_INJECTED)}`);
	if (value === NOT_INJECTED) throw new NotInjectedError("this window didn't have the hint script");
	return value;
}

/** Evaluates an expression in the focused window and resolves to its value. */
async function evaluateInFocusedWindow(expression) {
	return withRelay(async (relay) => {
		const pages = await workbenchPages(relay);
		// A window that doesn't answer counts as not focused.
		const focused = await Promise.allSettled(pages.map((page) => evaluate(relay, page, "document.hasFocus()")));
		const page = pages.length === 1 ? pages[0] : pages[focused.findIndex((result) => result.value === true)];
		if (!page) throw new Error("no focused VS Code window");
		return evaluate(relay, page, expression);
	});
}

/** Connects to the relay for the length of one action. */
async function withRelay(action) {
	const relay = await connectToRelay();
	try {
		return await action(relay);
	} finally {
		relay.close();
	}
}

// Editor windows are pages served from vscode-file://, which forks of VS
// Code keep.
async function workbenchPages(relay) {
	const { targetInfos } = await relay.send("Target.getTargets");
	return targetInfos.filter((target) => target.type === "page" && target.url.startsWith("vscode-file://"));
}

// The version is a hash of the files, so editing them and running
// "Beans: Inject" again replaces the old copy in every window. The channel's
// id holds the publisher, so the script and the rule hiding the channel get
// it from here.
function injectionScript(mediaDir, channelId) {
	const js = fs.readFileSync(path.join(mediaDir, "beans.js"), "utf8");
	const css = fs.readFileSync(path.join(mediaDir, "beans.css"), "utf8");
	const version = crypto.createHash("sha256").update(js).update(css).update(channelId).digest("hex").slice(0, 12);
	return `(() => {
		// Other editor windows, such as the Process Explorer, have no workbench.
		if (!document.querySelector(".monaco-workbench")) return false;
		if (window.__beansVersion === ${JSON.stringify(version)}) return false;
		window.__beansChannelId = ${JSON.stringify(channelId)};
		document.getElementById("beans-style")?.remove();
		const style = document.createElement("style");
		style.id = "beans-style";
		const hideChannel = "#" + CSS.escape(window.__beansChannelId) + " { display: none !important; }";
		style.textContent = ${JSON.stringify(css)} + " " + hideChannel;
		document.head.append(style);
		${js}
		// Marked last, so a script that throws is tried again by the next inject.
		window.__beansVersion = ${JSON.stringify(version)};
		return true;
	})()`;
}

/**
 * Evaluates an expression in one page and resolves to its value. The pipe
 * reaches the whole browser, so it attaches to the page for one evaluation.
 */
async function evaluate(relay, page, expression) {
	const { sessionId } = await relay.send("Target.attachToTarget", { targetId: page.targetId, flatten: true });
	try {
		const { result, exceptionDetails } = await relay.send(
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

module.exports = { injectAll, callPage, PageError, NotInjectedError };
