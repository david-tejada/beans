import { SELECTORS } from "./selectors";

/**
 * Clicks a row's label like a mouse would, which on a view header expands
 * or collapses the view. With addToSelection, adds it to the selection:
 * Cmd+click on macOS, Ctrl+click on Windows and Linux.
 */
export function clickRow(row: HTMLElement, options?: { addToSelection?: boolean }): void {
	clickElement(row.querySelector<HTMLElement>(SELECTORS.rowTarget) ?? row, options);
}

/** Clicks an element near the start of its label, like a mouse would. */
export function clickElement(target: HTMLElement, { addToSelection = false }: { addToSelection?: boolean } = {}): void {
	// VS Code tells macOS apart the same way.
	const isMac = navigator.userAgent.includes("Macintosh");
	const { x, y } = labelPoint(target);
	const init: MouseEventInit = {
		bubbles: true,
		cancelable: true,
		view: window,
		button: 0,
		detail: 1,
		metaKey: addToSelection && isMac,
		ctrlKey: addToSelection && !isMac,
		clientX: x,
		clientY: y,
	};
	target.dispatchEvent(new PointerEvent("pointerdown", { ...init, pointerType: "mouse", isPrimary: true }));
	target.dispatchEvent(new MouseEvent("mousedown", { ...init, buttons: 1 }));
	target.dispatchEvent(new PointerEvent("pointerup", { ...init, pointerType: "mouse", isPrimary: true }));
	target.dispatchEvent(new MouseEvent("mouseup", init));
	target.dispatchEvent(new MouseEvent("click", init));
}

/** A point on an element's label, near its start, in page coordinates. */
export function labelPoint(target: Element): { x: number; y: number } {
	const rect = target.getBoundingClientRect();
	return { x: rect.left + Math.min(rect.width / 2, 40), y: rect.top + rect.height / 2 };
}

export function nextFrame(): Promise<void> {
	return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
