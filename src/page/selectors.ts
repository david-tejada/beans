import type { Editor, ResizePart, View } from "../shared/types";

/** The editor whose page this is; inject.ts sets it before the script runs. */
export const EDITOR: Editor = window.__beansEditor ?? "vscode";

// A selector that matches nothing.
const NONE = ":not(*)";

// Every VS Code class name this script depends on, in one place, since they
// can change between releases.
const VSCODE = {
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
	// What a sidebar shows, such as Explorer or Source Control; its id names
	// it, like "workbench.view.explorer".
	viewContainer: ".composite[id]",
	// A list row's place in its list, which the row itself carries.
	listIndex: "[data-index]",
	// The arrow in front of a tree row that can expand. VS Code says whether
	// a row is collapsed in aria-expanded, so it has no collapsedClass.
	twistie: ".monaco-tl-twistie",
	collapsedClass: "",
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
	skip: [".monaco-tl-contents > .scm-input", ".monaco-tl-contents > .button-container"] as string[],
	// The view a row is in, by the class of its pane body.
	views: {
		explorer: ".explorer-folders-view",
		openEditors: ".open-editors",
		scm: ".scm-view",
		search: ".search-view",
	} satisfies Record<Exclude<View, "other">, string>,
	// File rows keep the item's full path in this attribute of this element,
	// for the hover, followed by " • " and decorations such as "Modified".
	pathLabel: ".monaco-icon-label[aria-label]",
	pathAttribute: "aria-label",
	// A row the user selected, leaving out sticky scroll copies of rows.
	selectedRow: ".monaco-list-row.selected:not(.monaco-tree-sticky-row)",
	// A list that scrolls natively, with scrollTop; VS Code's lists don't.
	nativeScroller: NONE,
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

// Eclipse Theia's own classes and ids. Theia builds its sidebars from its
// own tree widgets, but its quick picks, such as the Command Palette, are
// VS Code's, so those keep VS Code's classes. NONE stands for what Theia
// doesn't have, or Beans doesn't use there yet: resizing.
const THEIA: typeof VSCODE = {
	// The left and right side panels, hidden while collapsed.
	parts: ["#theia-left-side-panel", "#theia-right-side-panel"],
	quickInput: ".quick-input-widget",
	// A tree node, a commit in Source Control's graph or a file it changed,
	// or a quick pick row. Code that adds to a selector wraps this one in
	// :is(), since it's a list.
	row: ".theia-TreeNode, .scm-history-graph-row, .scm-history-change-row, .monaco-list-row",
	// A view's header in a view container, like "Open Editors", and its name.
	paneHeader: ".theia-view-container-part-header",
	paneTitle: ".theia-view-container-part-header .label",
	list: ".theia-TreeContainer, .scm-history-graph-list, .monaco-list",
	listRows: ".monaco-list-rows",
	stickyRows: NONE,
	stickyRow: NONE,
	rowTarget: ".theia-TreeNodeContent, .monaco-tl-contents",
	// What a side panel shows, such as Explorer or Source Control; its id
	// names it, like "explorer-view-container".
	viewContainer: ".lm-DockPanel-widget[id]",
	// A tree node's place in a virtualized tree, which the node's wrapper
	// carries. Trees that aren't virtualized, like Open Editors, have none.
	listIndex: "[data-index]",
	// The chevron of a tree node or view header that can expand, and the
	// class it has while collapsed.
	twistie: ".theia-ExpansionToggle",
	collapsedClass: "theia-mod-collapsed",
	actionItemClass: "action-item",
	// The name inside a tree node's segment, where the segment holds more
	// (an extension's card, a breakpoint's checkbox, a change's icon), else
	// the segment itself, as with Explorer files; then a commit's message
	// and the files it changed, a Search file's name and path, and quick
	// pick labels.
	names: [
		".theia-TreeNodeSegmentGrow .name",
		".theia-TreeNodeSegmentGrow",
		".scm-history-subject",
		".scm-history-change-name",
		".result-head-info",
		".monaco-icon-name-container",
		".monaco-highlighted-label",
	],
	skip: [],
	// The views' widgets, by id.
	views: {
		explorer: "#files",
		openEditors: "#theia-open-editors-widget",
		scm: "#scm-view",
		search: "#search-in-workspace",
	},
	// File nodes (Explorer, Open Editors), Search's file rows and Source
	// Control's changes show their full path as a tooltip.
	pathLabel: ".theia-FileStatNode[title], .result-head-info[title], .scmItem[title]",
	pathAttribute: "title",
	selectedRow: ".theia-TreeNode.theia-mod-selected",
	// The scrolling element of a tree, from the react-virtuoso list Theia
	// uses. In Source Control's graph, it's the list itself.
	nativeScroller: "[data-virtuoso-scroller]",
	resizable: {
		sidebar: "#theia-left-side-panel",
		secondary: "#theia-right-side-panel",
		panel: "#theia-bottom-content-panel",
	},
	sash: NONE,
	pane: ".theia-view-container-part",
	splitViewView: NONE,
	editor: ".monaco-editor",
	statusBar: "#theia-statusBar",
};

export const SELECTORS = EDITOR === "theia" ? THEIA : VSCODE;

/** The views SELECTORS.views knows, for finding which one a row is in. */
export const VIEW_NAMES = ["explorer", "openEditors", "scm", "search"] as const satisfies readonly Exclude<
	View,
	"other"
>[];

/** The attribute a hinted row and its name element carry; beans.css draws it. */
export const HINT_ATTR = "data-beans-hint";

/** On body while the hints are toggled off. */
export const HIDDEN_CLASS = "beans-hidden";
