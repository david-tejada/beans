// Runs in VS Code's workbench page, injected by inject.ts, bundled into one
// script. The page enforces Trusted Types, so nothing here assigns HTML
// strings (no innerHTML); it only sets attributes and classes.
import type { WindowPoint } from "../shared/types";
import { scrollDirectionFrom } from "../requests";
import { clickRow, labelPoint } from "./click";
import { letterHint, numberHint } from "./hints";
import { resize } from "./resize";
import { findRow, nameElement, openQuickInput, sidebars, visibleRows } from "./rows";
import { scroll } from "./scroll";
import { HIDDEN_CLASS, HINT_ATTR, SELECTORS } from "./selectors";
import { resolve, select, setExpanded } from "./targets";

// The status bar item that carries requests. Its id holds the publisher,
// so inject.ts sets it.
const CHANNEL_ID = window.__beansChannelId ?? "";

start();

function start(): void {
	let scheduled = false;
	let lastRequest: string | null = null;
	const update = () => {
		scheduled = false;
		lastRequest = readChannel(lastRequest);
		labelRows();
	};
	const schedule = () => {
		if (scheduled) return;
		scheduled = true;
		requestAnimationFrame(update);
	};

	// Rows are recycled and repositioned through inline styles as lists
	// scroll, so style and class changes are what signal "relabel".
	// Mutations in the editor are ignored to keep typing cheap.
	const observer = new MutationObserver((records) => {
		if (records.some(isRelevant)) schedule();
	});
	observer.observe(document.documentElement, {
		childList: true,
		subtree: true,
		characterData: true,
		attributes: true,
		attributeFilter: ["style", "class", "aria-expanded"],
	});
	window.addEventListener("resize", schedule);

	// A newer version injected later stops this one first.
	window.__beansStop?.();
	window.__beansStop = () => {
		observer.disconnect();
		window.removeEventListener("resize", schedule);
	};
	// The extension calls these through the debug pipe (inject.ts).
	window.__beans = { resolve, setExpanded, select, resize, rowPoint };
	schedule();
	console.log("[beans] loaded");
}

function isRelevant(record: MutationRecord): boolean {
	const node = record.target instanceof Element ? record.target : record.target.parentElement;
	if (!node) return false;
	// Before the workbench has been built, any change may be a sidebar appearing.
	if (!document.querySelector(SELECTORS.parts.join(","))) return true;
	const watched = [...SELECTORS.parts, SELECTORS.quickInput, SELECTORS.statusBar].join(",");
	return Boolean(node.closest(watched)) || node === document.body;
}

/** Runs a new request from the status bar channel. Returns the request's id. */
function readChannel(lastRequest: string | null): string | null {
	const element = document.getElementById(CHANNEL_ID);
	if (!element) return lastRequest;
	const match = /beans:(\d+):(\w+):([\w-]*)/.exec(element.textContent ?? "");
	if (!match) return lastRequest;
	const [, id, command, arg] = match;
	if (id === undefined || command === undefined || arg === undefined) return lastRequest;
	// The first request seen is whatever was there when the page loaded.
	if (lastRequest !== null && id !== lastRequest) runRequest(command, arg);
	return id;
}

function runRequest(command: string, arg: string): void {
	if (command === "pick") pick(arg);
	if (command === "toggle") document.body.classList.toggle(HIDDEN_CLASS);
	if (command === "scroll") {
		const [direction, hint = ""] = arg.split("-");
		const where = scrollDirectionFrom(direction);
		if (where) scroll(where, hint);
	}
}

/**
 * Gives every row that is at least partly visible a hint. Sidebar rows get
 * letters (a…z, then aa, ab…) and an open quick pick gets numbers (1, 2…),
 * so opening the Command Palette doesn't change the sidebar hints.
 */
function labelRows(): void {
	const quickInput = openQuickInput();
	const hinted = new Set<Element>();
	const groups = [
		{ containers: sidebars(), hintFor: letterHint },
		{ containers: quickInput ? [quickInput] : [], hintFor: numberHint },
	];
	for (const { containers, hintFor } of groups) {
		visibleRows(containers).forEach((row, index) => {
			const hint = hintFor(index);
			// The row carries the hint for pick(); its name element shows it.
			for (const element of [row, nameElement(row)]) {
				if (element.getAttribute(HINT_ATTR) !== hint) element.setAttribute(HINT_ATTR, hint);
				hinted.add(element);
			}
		});
	}
	for (const element of document.querySelectorAll(`[${HINT_ATTR}]`)) {
		if (!hinted.has(element)) element.removeAttribute(HINT_ATTR);
	}
}

/** Clicks the row with this hint, as if the user clicked its label. */
function pick(hint: string): void {
	const row = findRow(hint);
	if (!row) return;
	clickRow(row);
	console.log(`[beans] picked "${hint}"`);
}

/**
 * Where to right-click the row with this hint, as fractions of the window's
 * width and height, or null when there's no such row. On macOS, VS Code
 * opens a context menu at the real cursor, not at the event's position,
 * so Talon moves the mouse there and clicks. Fractions let Talon place
 * the point in the window whatever VS Code's zoom.
 */
function rowPoint(hint: string): WindowPoint | null {
	const row = findRow(hint);
	if (!row) return null;
	const { x, y } = labelPoint(row.querySelector(SELECTORS.rowTarget) ?? row);
	// The page sits below the window's title bar when that's the native one
	// (window.titleBarStyle), so the point is taken from the window's top,
	// not the page's. The page measures in CSS pixels, which VS Code's zoom
	// shrinks, the window in the screen's; the page spans the window's
	// width, which gives the zoom.
	const zoom = window.outerWidth / window.innerWidth;
	const pageTop = window.outerHeight - window.innerHeight * zoom;
	return { x: (x * zoom) / window.outerWidth, y: (pageTop + y * zoom) / window.outerHeight };
}
