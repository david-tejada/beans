import type { Editor, PageApi } from "../shared/types";

// What the hint script and inject.ts leave on the window, so a later inject
// can find the running copy.
declare global {
	interface Window {
		/** The functions inject.ts calls over the debug pipe. */
		__beans?: PageApi;
		/** The editor whose page this is; inject.ts sets it before the script runs. */
		__beansEditor?: Editor;
		/** The DOM id of the status bar item that carries requests; inject.ts sets it before the script runs. */
		__beansChannelId?: string;
		/** The beans.stableHints setting; inject.ts sets it before the script runs. */
		__beansStableHints?: boolean;
		/** Stops the running copy of the script, for the next one to take over. */
		__beansStop?: () => void;
		/** A hash of the injected files and settings, so the same version isn't injected twice. */
		__beansVersion?: string;
	}
}
