// What crosses between the extension host and the hint script in the page.
// Both sides import these; nothing here runs.

/** The editor Beans runs in: VS Code or one of its forks, or Eclipse Theia, whose page is built differently. */
export type Editor = "vscode" | "theia";

/** One spoken item: a hint, or a range of rows from one hint to another, both included. */
export type TargetItem = { hint: string } | { from: string; to: string };

/** Hints and ranges joined with "and", built by beans.py in beans-talon. */
export interface Target {
	items: TargetItem[];
}

/** The sidebar view a row is in, by the class of its pane. */
export type View = "explorer" | "openEditors" | "scm" | "search" | "other";

/** A file row the page found for a target. path is the row's hover path, as the OS holding the file writes it. */
export interface ResolvedItem {
	hint: string;
	path: string;
	isFolder: boolean;
	/** Whether a folder is open; false for a file. */
	isExpanded: boolean;
	view: View;
}

export interface ResolveResult {
	items: ResolvedItem[];
	/** Hints of rows that aren't files. */
	skipped: string[];
	/** Hints that aren't on screen. */
	missing: string[];
}

export interface SetExpandedResult {
	/** The Explorer folders among the rows, for expanding deeper. */
	folders: { hint: string; path: string }[];
	missing: string[];
}

export type ResizePart = "sidebar" | "secondary" | "panel";

/** A part of the window, or the sidebar view holding the row with this hint. */
export type ResizeTarget = ResizePart | { hint: string };

/** { target, by } in steps (negative to shrink), { target, to } in pixels, or { target, max }. */
export interface ResizeRequest {
	target: ResizeTarget;
	by?: number;
	to?: number;
	max?: boolean;
}

export type ResizeResult = { name: string; before: number; after: number } | { problem: string };

/** A point as fractions of the window's width and height. */
export interface WindowPoint {
	x: number;
	y: number;
}

/** The functions the hint script exposes as window.__beans, which inject.ts calls over the debug pipe. */
export interface PageApi {
	resolve(target: Target): ResolveResult;
	setExpanded(target: Target, expanded: boolean): SetExpandedResult;
	/**
	 * Adds these Explorer rows to the selection and returns the paths selected
	 * afterwards, once they and the paths in alsoSelected show as selected.
	 */
	select(items: { hint: string; path: string }[], alsoSelected?: string[]): Promise<string[]>;
	resize(request: ResizeRequest): Promise<ResizeResult>;
	rowPoint(hint: string): WindowPoint | null;
}

export type HintSpacing = "compact" | "default" | "comfortable";

/** The user's settings the page needs. */
export interface PageSettings {
	hintSpacing: HintSpacing;
}
