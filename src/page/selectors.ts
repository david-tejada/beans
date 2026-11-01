import type { ResizePart, View } from "../shared/types";

// Every VS Code class name this script depends on, in one place, since they
// can change between releases.
export const SELECTORS = {
	parts: [".part.sidebar", ".part.auxiliarybar"],
	// The Command Palette and every other quick pick.
	quickInput: ".quick-input-widget",
	row: ".monaco-list-row",
	// A view's collapsible header, like "Outline" or "Timeline", and its name.
	paneHeader: ".pane-header",
	paneTitle: ".pane-header .title",
	list: ".monaco-list",
	listRows: ".monaco-list-rows",
	// Sticky scroll: the folders a tree is scrolled into, pinned over its top
	// rows, each a copy of the row it stands for.
	stickyRows: ".monaco-tree-sticky-container",
	stickyRow: ".monaco-tree-sticky-row",
	rowTarget: ".monaco-tl-contents",
	// The arrow in front of a tree row that can expand.
	twistie: ".monaco-tl-twistie",
	// A toolbar button's class. A click on one inside a sticky scroll row
	// leaves the tree's scroll, focus and selection alone.
	actionItemClass: "action-item",
	// Where a row's name is, in order of preference: file and symbol
	// labels (Explorer, Search files, Outline, SCM), then Extensions and
	// SCM group headers, then plain highlighted text.
	names: [
		".monaco-icon-name-container",
		".extension-list-item .name",
		".resource-group > .name",
		".monaco-highlighted-label",
	],
	// Rows that aren't items: the SCM commit message box and its button.
	skip: [".monaco-tl-contents > .scm-input", ".monaco-tl-contents > .button-container"],
	// The view a row is in, by the class of its pane body.
	views: {
		explorer: ".explorer-folders-view",
		openEditors: ".open-editors",
		scm: ".scm-view",
		search: ".search-view",
	} satisfies Record<Exclude<View, "other">, string>,
	// File rows keep the item's full path here, for the hover.
	pathLabel: ".monaco-icon-label[aria-label]",
	// The parts that resize commands can target, by the name they're called with.
	resizable: {
		sidebar: ".part.sidebar",
		secondary: ".part.auxiliarybar",
		panel: ".part.panel",
	} satisfies Record<ResizePart, string>,
	// A draggable divider. It also has a class for its direction,
	// "vertical" or "horizontal", and "disabled" when it can't move.
	sash: ".monaco-sash",
	// A sidebar view: its own collapsible section, holding its header.
	pane: ".pane",
	// The box a split view sizes, one per view; sashes sit on its edges.
	splitViewView: ".split-view-view",
	// Editors draw their own sashes (the find widget's, for one).
	editor: ".monaco-editor",
	// The status bar, watched for requests.
	statusBar: ".part.statusbar",
};

/** The views SELECTORS.views knows, for finding which one a row is in. */
export const VIEW_NAMES = ["explorer", "openEditors", "scm", "search"] as const satisfies readonly Exclude<
	View,
	"other"
>[];

/** The attribute a hinted row and its name element carry; beans.css draws it. */
export const HINT_ATTR = "data-beans-hint";

/** On body while the hints are toggled off. */
export const HIDDEN_CLASS = "beans-hidden";
