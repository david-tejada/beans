// Runs in VS Code's workbench page, injected by inject.js. The page enforces
// Trusted Types, so this file never assigns HTML strings (no innerHTML); it
// only sets attributes and classes.
(() => {
	// Every VS Code class name this script depends on, in one place, since
	// they can change between releases.
	const SELECTORS = {
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
		},
		// File rows keep the item's full path here, for the hover.
		pathLabel: ".monaco-icon-label[aria-label]",
		// The parts that resize commands can target, by the name they're called with.
		resizable: {
			sidebar: ".part.sidebar",
			secondary: ".part.auxiliarybar",
			panel: ".part.panel",
		},
		// A draggable divider. It also has a class for its direction,
		// "vertical" or "horizontal", and "disabled" when it can't move.
		sash: ".monaco-sash",
		// A sidebar view: its own collapsible section, holding its header.
		pane: ".pane",
		// The box a split view sizes, one per view; sashes sit on its edges.
		splitViewView: ".split-view-view",
		// Editors draw their own sashes (the find widget's, for one).
		editor: ".monaco-editor",
	};
	// The status bar item that carries requests. Its id holds the publisher,
	// so inject.js sets it.
	const CHANNEL_ID = window.__beansChannelId;
	const HINT_ATTR = "data-beans-hint";
	const HIDDEN_CLASS = "beans-hidden";
	// How far one resize step moves, in pixels: heights move two rows.
	const RESIZE_STEPS = { width: 60, height: 44 };
	const PART_NAMES = { sidebar: "sidebar", secondary: "secondary sidebar", panel: "panel" };

	start();

	function start() {
		let scheduled = false;
		let lastRequest = null;
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
		// The extension calls these through the debug port (inject.js).
		window.__beans = { resolve, select, resize, rowPoint };
		schedule();
		console.log("[beans] loaded");
	}

	function isRelevant(record) {
		const node = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;
		if (!node) return false;
		// Before the workbench has been built, any change may be a sidebar appearing.
		if (!document.querySelector(SELECTORS.parts.join(","))) return true;
		const watched = [...SELECTORS.parts, SELECTORS.quickInput, ".part.statusbar"].join(",");
		return Boolean(node.closest(watched)) || node === document.body;
	}

	/** Runs a new request from the status bar channel. Returns the request's id. */
	function readChannel(lastRequest) {
		const element = document.getElementById(CHANNEL_ID);
		if (!element) return lastRequest;
		const match = /beans:(\d+):(\w+):([\w-]*)/.exec(element.textContent);
		if (!match) return lastRequest;
		const [, id, command, arg] = match;
		// The first request seen is whatever was there when the page loaded.
		if (lastRequest !== null && id !== lastRequest) runRequest(command, arg);
		return id;
	}

	function runRequest(command, arg) {
		if (command === "pick") pick(arg);
		if (command === "toggle") document.body.classList.toggle(HIDDEN_CLASS);
		if (command === "scroll") scroll(...arg.split("-"));
	}

	/**
	 * Gives every row that is at least partly visible a hint. Sidebar rows get letters (a…z,
	 * then aa, ab…) and an open quick pick gets numbers (1, 2…), so opening
	 * the Command Palette doesn't change the sidebar hints.
	 */
	function labelRows() {
		const quickInput = openQuickInput();
		const hinted = new Set();
		const groups = [
			{ containers: sidebars(), hintFor: letterHint },
			{ containers: quickInput ? [quickInput] : [], hintFor: (index) => String(index + 1) },
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

	/** The element holding the row's name, where the hint is shown before the name. */
	function nameElement(row) {
		if (row.matches(SELECTORS.paneHeader)) return row.querySelector(SELECTORS.paneTitle) ?? row;
		for (const selector of SELECTORS.names) {
			const element = row.querySelector(selector);
			if (element) return element;
		}
		return row.querySelector(SELECTORS.rowTarget) ?? row;
	}

	/**
	 * Rows of these containers that are at least partly on screen, top to
	 * bottom, container by container. View headers count as rows too, so
	 * "hint <letters>" can expand or collapse a view.
	 */
	function visibleRows(containers) {
		const rows = [];
		for (const container of containers) {
			const containerRows = [];
			for (const row of container.querySelectorAll(rowSelector())) {
				if (row.querySelector(SELECTORS.skip.join(","))) continue;
				const rect = row.getBoundingClientRect();
				// A header isn't in a list, so it only has to show inside the sidebar.
				// The header of a sidebar's only view is hidden and has no height.
				const bounds = row.matches(SELECTORS.paneHeader) ? container : row.closest(SELECTORS.list);
				if (rect.height === 0 || !isInside(rect, bounds, stickyBottom(row))) continue;
				containerRows.push({ row, top: rect.top, left: rect.left });
			}
			containerRows.sort((a, b) => a.top - b.top || a.left - b.left);
			rows.push(...containerRows.map(({ row }) => row));
		}
		return rows;
	}

	function rowSelector() {
		return `${SELECTORS.row}, ${SELECTORS.paneHeader}`;
	}

	/** The sidebar row or view header with this hint. */
	function rowWithHint(container, hint) {
		const withHint = `[${HINT_ATTR}="${hint}"]`;
		return container.querySelector(`${SELECTORS.row}${withHint}, ${SELECTORS.paneHeader}${withHint}`);
	}

	function sidebars() {
		return SELECTORS.parts
			.map((selector) => document.querySelector(selector))
			.filter((part) => part && part.offsetParent !== null);
	}

	function openQuickInput() {
		const quickInput = document.querySelector(SELECTORS.quickInput);
		const isOpen = quickInput && quickInput.style.display !== "none" && quickInput.offsetParent !== null;
		return isOpen ? quickInput : null;
	}

	// The list clips rows that are scrolled half out of view. Those still get a
	// hint, as long as a few pixels of them show; the list keeps rows just
	// outside its edges rendered, so those are skipped. Rows above coveredTo,
	// a page y, are hidden under something.
	function isInside(rect, container, coveredTo = -Infinity) {
		if (!container) return false;
		const bounds = container.getBoundingClientRect();
		const top = Math.max(rect.top, bounds.top, coveredTo);
		const bottom = Math.min(rect.bottom, bounds.bottom, window.innerHeight);
		return bottom - top >= 2;
	}

	/**
	 * Where the sticky scroll rows of the row's list end, as a page y, when
	 * they cover the row; -Infinity otherwise. The sticky rows themselves are
	 * rows too, and get their own hints.
	 */
	function stickyBottom(row) {
		const sticky = row.closest(SELECTORS.list)?.querySelector(SELECTORS.stickyRows);
		if (!sticky || sticky.contains(row)) return -Infinity;
		return sticky.getBoundingClientRect().bottom;
	}

	function letterHint(index) {
		const letters = "abcdefghijklmnopqrstuvwxyz";
		if (index < letters.length) return letters[index];
		const rest = index - letters.length;
		return letters[Math.floor(rest / letters.length) % letters.length] + letters[rest % letters.length];
	}

	/** Clicks the row with this hint, as if the user clicked its label. */
	function pick(hint) {
		const row = findRow(hint);
		if (!row) return;
		clickRow(row);
		console.log(`[beans] picked "${hint}"`);
	}

	/**
	 * Where to right-click the row with this hint, as fractions of the page's
	 * width and height, or null when there's no such row. On macOS, VS Code
	 * opens a context menu at the real cursor, not at the event's position,
	 * so Talon moves the mouse there and clicks. Fractions let Talon place
	 * the point in the window whatever VS Code's zoom.
	 */
	function rowPoint(hint) {
		const row = findRow(hint);
		if (!row) return null;
		const { x, y } = labelPoint(row.querySelector(SELECTORS.rowTarget) ?? row);
		return { x: x / window.innerWidth, y: y / window.innerHeight };
	}

	/** The quick pick row (numbers) or sidebar row (letters) with this hint, logging when there's none. */
	function findRow(hint) {
		const containers = /^\d+$/.test(hint) ? [openQuickInput()].filter(Boolean) : sidebars();
		const row = containers.map((container) => rowWithHint(container, hint)).find(Boolean);
		if (!row) console.log(`[beans] no row with hint "${hint}"`);
		return row;
	}

	/**
	 * Clicks a row's label like a mouse would, which on a view header expands
	 * or collapses the view. With addToSelection, adds it to the selection:
	 * Cmd+click on macOS, Ctrl+click on Windows and Linux.
	 */
	function clickRow(row, { addToSelection = false } = {}) {
		// VS Code tells macOS apart the same way.
		const isMac = navigator.userAgent.includes("Macintosh");
		const target = row.querySelector(SELECTORS.rowTarget) ?? row;
		const { x, y } = labelPoint(target);
		const init = {
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
	function labelPoint(target) {
		const rect = target.getBoundingClientRect();
		return { x: rect.left + Math.min(rect.width / 2, 40), y: rect.top + rect.height / 2 };
	}

	/**
	 * Scrolls a list "up", "down" (about a screen), to the "top" or to the
	 * "bottom". The list is the open quick pick's, else the one holding the
	 * row with this hint (or under the view header with it), else the tallest
	 * one in the sidebars.
	 */
	function scroll(direction, hint) {
		const list = listToScroll(hint);
		if (!list) {
			console.log(`[beans] no list to scroll${hint ? ` for hint "${hint}"` : ""}`);
			return;
		}
		const rows = list.querySelector(SELECTORS.listRows) ?? list;
		const rowHeight = list.querySelector(SELECTORS.row)?.getBoundingClientRect().height ?? 22;
		// Keep two rows of the old view on screen, so you don't lose your place.
		const page = Math.max(list.getBoundingClientRect().height - 2 * rowHeight, rowHeight);
		const distance = { up: -page, down: page, top: -1e6, bottom: 1e6 }[direction];
		if (distance === undefined) return;
		scrollBy(rows, distance);
	}

	/**
	 * Scrolls a list's rows by about this many pixels (positive is down).
	 *
	 * VS Code's lists draw their own scrollbar and only react to wheel
	 * events. How far a wheel event moves them depends on the screen's pixel
	 * ratio and VS Code's settings, and a synthetic event even reads with the
	 * opposite sign, so this sends one event, measures how far the rows
	 * moved, and sends a second one for the rest.
	 */
	function scrollBy(rows, distance) {
		const wheel = (deltaY) =>
			rows.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, view: window, deltaY, deltaMode: 0 }));
		// The list moves its rows by setting style.top to minus the scroll position.
		const position = () => -parseFloat(rows.style.top || "0");
		const before = position();
		const guess = -distance;
		wheel(guess);
		requestAnimationFrame(() => {
			const moved = position() - before;
			const remaining = distance - moved;
			if (moved === 0 || Math.abs(remaining) < 1) return;
			wheel(guess * (remaining / moved));
		});
	}

	function listToScroll(hint) {
		const quickInput = openQuickInput();
		if (quickInput) return quickInput.querySelector(SELECTORS.list);
		if (hint) {
			const row = sidebars().map((part) => rowWithHint(part, hint)).find(Boolean);
			if (row?.matches(SELECTORS.paneHeader)) return row.parentElement.querySelector(SELECTORS.list);
			return row?.closest(SELECTORS.list) ?? null;
		}
		const lists = sidebars().flatMap((part) => [...part.querySelectorAll(SELECTORS.list)]);
		const heights = lists.map((list) => list.getBoundingClientRect().height);
		const tallest = Math.max(0, ...heights);
		return tallest > 0 ? lists[heights.indexOf(tallest)] : null;
	}

	/**
	 * Resolves a spoken target, { items: [{ hint } | { from, to }] }, to the
	 * sidebar rows it names, in on-screen order. Returns the file rows as
	 * { hint, path, isFolder, view }, the hints of rows that aren't files
	 * (skipped), and hints that aren't on screen (missing).
	 */
	function resolve(target) {
		const rows = visibleRows(sidebars());
		const indexOf = (hint) => rows.findIndex((row) => row.getAttribute(HINT_ATTR) === hint);
		const chosen = new Set();
		const missing = [];
		for (const item of target.items) {
			const ends = item.hint ? [item.hint, item.hint] : [item.from, item.to];
			const [start, end] = ends.map(indexOf);
			if (start === -1 || end === -1) {
				missing.push(...ends.filter((hint, i) => [start, end][i] === -1));
				continue;
			}
			// A range includes both ends, whichever way round they were said.
			for (let i = Math.min(start, end); i <= Math.max(start, end); i++) chosen.add(i);
		}
		const items = [];
		const skipped = [];
		for (const i of [...chosen].sort((a, b) => a - b)) {
			const row = rows[i];
			const hint = row.getAttribute(HINT_ATTR);
			const path = rowPath(row);
			if (!path) skipped.push(hint);
			// Only folder rows can expand.
			else items.push({ hint, path, isFolder: row.hasAttribute("aria-expanded"), view: viewOf(row) });
		}
		return { items, skipped, missing: [...new Set(missing)] };
	}

	/** The path of the file a row shows, or undefined when it isn't a file. */
	function rowPath(row) {
		// The hover text adds decorations after the path: "/a/notes.txt • Modified".
		return row.querySelector(SELECTORS.pathLabel)?.getAttribute("aria-label")?.split(" • ")[0];
	}

	function viewOf(row) {
		const view = Object.entries(SELECTORS.views).find(([, selector]) => row.closest(selector));
		return view ? view[0] : "other";
	}

	/**
	 * Adds rows to their list's selection, with Cmd+click or Ctrl+click.
	 * Takes [{ hint, path }], and skips a row that no longer shows that path,
	 * in case the list changed since the target was resolved. Returns the
	 * paths of the Explorer's selected rows afterwards.
	 */
	function select(items) {
		const rows = visibleRows(sidebars());
		for (const { hint, path } of items) {
			const row = rows.find((r) => r.getAttribute(HINT_ATTR) === hint);
			if (row && rowPath(row) === path) clickRow(row, { addToSelection: true });
		}
		const selected = document.querySelectorAll(
			`${SELECTORS.views.explorer} ${SELECTORS.row}.selected:not(${SELECTORS.stickyRow})`,
		);
		return [...new Set([...selected].map(rowPath).filter(Boolean))];
	}

	/**
	 * Resizes a part or a sidebar view by dragging its sash, VS Code's
	 * draggable divider. The request is { target, by } (steps, negative to
	 * shrink), { target, to } (pixels) or { target, max: true }, where target
	 * is "sidebar", "secondary", "panel", or { hint } for the sidebar view
	 * holding that row. Resolves to { name, before, after } in pixels, or
	 * { problem }.
	 */
	async function resize({ target, by = 0, to, max }) {
		const found = await resizeTarget(target);
		if (found.problem) return found;
		const { element, axis, name } = found;
		const size = () => Math.round(element.getBoundingClientRect()[axis]);
		const before = size();
		const sashes = edgeSashes(element, axis);
		if (!sashes.length) return { problem: `the ${name} can't be resized here` };
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
			await dragSash(sashes[0], sashes[0].sign * change);
		}
		return { name, before, after: size() };
	}

	/**
	 * The element a resize target names, with the axis it resizes along and
	 * a name for messages. A collapsed view is expanded first, since it's
	 * only a header and can't be resized.
	 */
	async function resizeTarget(target) {
		if (typeof target === "string") {
			const name = PART_NAMES[target];
			const element = document.querySelector(SELECTORS.resizable[target]);
			if (!element || element.offsetParent === null) return { problem: `the ${name ?? target} isn't open` };
			// The panel can sit at the bottom or top of the window, or on a side.
			const isRow = target === "panel" && (element.classList.contains("bottom") || element.classList.contains("top"));
			return { element, axis: isRow ? "height" : "width", name };
		}
		const row = sidebars().map((part) => rowWithHint(part, target.hint)).find(Boolean);
		if (!row) return { problem: `no row with hint ${target.hint.toUpperCase()}` };
		const pane = row.closest(SELECTORS.pane);
		const name = pane?.querySelector(SELECTORS.paneTitle)?.textContent || "view";
		const element = row.closest(SELECTORS.splitViewView);
		if (!element) return { problem: `the ${name} view can't be resized here` };
		if (pane && !pane.classList.contains("expanded")) {
			clickRow(pane.querySelector(SELECTORS.paneHeader));
			// VS Code turns on the view's sashes a few frames after it expands.
			for (let frame = 0; frame < 30 && !edgeSashes(element, "height").length; frame++) await nextFrame();
		}
		return { element, axis: "height", name: `${name} view` };
	}

	/**
	 * The sashes on this element's two edges along the axis, as
	 * { sash, axis, sign }. sign is 1 on the right or bottom edge and -1 on
	 * the left or top one, and the sash on the right or bottom comes first.
	 * Disabled sashes, such as those next to collapsed views, are left out.
	 */
	function edgeSashes(element, axis) {
		const box = element.getBoundingClientRect();
		const isWidth = axis === "width";
		const [start, end] = isWidth ? [box.left, box.right] : [box.top, box.bottom];
		const edges = [];
		// A width changes at a vertical divider, a height at a horizontal one.
		for (const sash of document.querySelectorAll(`${SELECTORS.sash}.${isWidth ? "vertical" : "horizontal"}`)) {
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
		return edges.sort((a, b) => b.sign - a.sign);
	}

	/**
	 * Drags a sash this many pixels along its axis, like a mouse would, and
	 * resolves once VS Code has laid out the new sizes.
	 */
	async function dragSash({ sash, axis }, distance) {
		const rect = sash.getBoundingClientRect();
		const x = rect.left + rect.width / 2;
		const y = rect.top + rect.height / 2;
		const [dx, dy] = axis === "width" ? [distance, 0] : [0, distance];
		// The sash listens for mouse events: synthetic pointer events don't move it.
		const mouse = (type, target, fraction) =>
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

	function nextFrame() {
		return new Promise((resolve) => requestAnimationFrame(resolve));
	}
})();
