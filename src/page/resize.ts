import type { ResizePart, ResizeRequest, ResizeResult, ResizeTarget } from "../shared/types";
import { clickRow, nextFrame } from "./click";
import { sidebarRowWithHint } from "./rows";
import { EDITOR, SELECTORS } from "./selectors";

type Axis = "width" | "height";

// How far one resize step moves, in pixels: heights move two rows.
const RESIZE_STEPS: Record<Axis, number> = { width: 60, height: 44 };
const PART_NAMES: Record<ResizePart, string> = { sidebar: "sidebar", secondary: "secondary sidebar", panel: "panel" };

/**
 * Resizes a part or a sidebar view by dragging its sash, VS Code's
 * draggable divider. Resolves to { name, before, after } in pixels, or
 * { problem }.
 */
export async function resize({ target, by = 0, to, max }: ResizeRequest): Promise<ResizeResult> {
	if (EDITOR === "theia") return { problem: "resizing doesn't work in Theia yet; drag the divider with the mouse" };
	const found = await resizeTarget(target);
	if ("problem" in found) return found;
	const { element, axis, name } = found;
	const size = () => Math.round(element.getBoundingClientRect()[axis]);
	const before = size();
	const sashes = edgeSashes(element, axis);
	const [first] = sashes;
	if (!first) return { problem: `the ${name} can't be resized here` };
	if (max) {
		// Each sash only takes room from its own side, so a view in the
		// middle grows by pushing both of them away.
		for (const sign of [1, -1]) {
			const sash = edgeSashes(element, axis).find((edge) => edge.sign === sign);
			if (sash) await dragSash(sash, sign * Math.max(window.innerWidth, window.innerHeight));
		}
	} else {
		const change = (to ?? before + by * RESIZE_STEPS[axis]) - before;
		// Dragging the right or bottom edge out grows it; the left or top edge, in.
		await dragSash(first, first.sign * change);
	}
	return { name, before, after: size() };
}

type ResizeFound = { element: HTMLElement; axis: Axis; name: string } | { problem: string };

/**
 * The element a resize target names, with the axis it resizes along and
 * a name for messages. A collapsed view is expanded first, since it's
 * only a header and can't be resized.
 */
async function resizeTarget(target: ResizeTarget): Promise<ResizeFound> {
	if (typeof target === "string") {
		const name = PART_NAMES[target];
		const element = document.querySelector<HTMLElement>(SELECTORS.resizable[target]);
		if (!element || element.offsetParent === null) return { problem: `the ${name} isn't open` };
		// The panel can sit at the bottom or top of the window, or on a side.
		const isRow = target === "panel" && (element.classList.contains("bottom") || element.classList.contains("top"));
		return { element, axis: isRow ? "height" : "width", name };
	}
	const row = sidebarRowWithHint(target.hint);
	if (!row) return { problem: `no row with hint ${target.hint.toUpperCase()}` };
	const pane = row.closest<HTMLElement>(SELECTORS.pane);
	const name = pane?.querySelector(SELECTORS.paneTitle)?.textContent || "view";
	const element = row.closest<HTMLElement>(SELECTORS.splitViewView);
	if (!element) return { problem: `the ${name} view can't be resized here` };
	if (pane && !pane.classList.contains("expanded")) {
		const header = pane.querySelector<HTMLElement>(SELECTORS.paneHeader);
		if (header) clickRow(header);
		// VS Code turns on the view's sashes a few frames after it expands.
		for (let frame = 0; frame < 30 && !edgeSashes(element, "height").length; frame++) await nextFrame();
	}
	return { element, axis: "height", name: `${name} view` };
}

/** A sash on an element's edge. sign is 1 on the right or bottom edge and -1 on the left or top one. */
interface EdgeSash {
	sash: HTMLElement;
	axis: Axis;
	sign: 1 | -1;
}

/**
 * The sashes on this element's two edges along the axis, the one on the
 * right or bottom first. Disabled sashes, such as those next to collapsed
 * views, are left out.
 */
function edgeSashes(element: HTMLElement, axis: Axis): EdgeSash[] {
	const box = element.getBoundingClientRect();
	const isWidth = axis === "width";
	const [start, end] = isWidth ? [box.left, box.right] : [box.top, box.bottom];
	const edges: EdgeSash[] = [];
	// A width changes at a vertical divider, a height at a horizontal one.
	for (const sash of document.querySelectorAll<HTMLElement>(
		`${SELECTORS.sash}.${isWidth ? "vertical" : "horizontal"}`,
	)) {
		if (sash.classList.contains("disabled") || sash.offsetParent === null || sash.closest(SELECTORS.editor)) continue;
		const rect = sash.getBoundingClientRect();
		// The sash must run along the element, not just line up with its edge.
		const overlap = isWidth
			? Math.min(rect.bottom, box.bottom) - Math.max(rect.top, box.top)
			: Math.min(rect.right, box.right) - Math.max(rect.left, box.left);
		if (overlap < 10) continue;
		// A sash is a few pixels thick, centered on the line between two views.
		const center = isWidth ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
		const sign = Math.abs(center - end) <= 4 ? 1 : Math.abs(center - start) <= 4 ? -1 : 0;
		if (sign && !edges.some((edge) => edge.sign === sign)) edges.push({ sash, axis, sign });
	}
	return edges.toSorted((a, b) => b.sign - a.sign);
}

/**
 * Drags a sash this many pixels along its axis, like a mouse would, and
 * resolves once VS Code has laid out the new sizes.
 */
async function dragSash({ sash, axis }: EdgeSash, distance: number): Promise<void> {
	const rect = sash.getBoundingClientRect();
	const x = rect.left + rect.width / 2;
	const y = rect.top + rect.height / 2;
	const [dx, dy] = axis === "width" ? [distance, 0] : [0, distance];
	// The sash listens for mouse events: synthetic pointer events don't move it.
	const mouse = (type: "mousedown" | "mousemove" | "mouseup", target: HTMLElement, fraction: number) =>
		target.dispatchEvent(
			new MouseEvent(type, {
				bubbles: true,
				cancelable: true,
				view: window,
				button: 0,
				buttons: type === "mouseup" ? 0 : 1,
				clientX: x + dx * fraction,
				clientY: y + dy * fraction,
			}),
		);
	mouse("mousedown", sash, 0);
	for (let step = 1; step <= 4; step++) {
		mouse("mousemove", sash, step / 4);
		await nextFrame();
	}
	mouse("mouseup", sash, 1);
	await nextFrame();
}
