# Beans

A VS Code extension that puts letter hints on sidebar rows for Talon voice control. `README.md` says what it does and how it works around VS Code; `package.json` has the commands, and `vite.config.ts` the build, lint, test and hook setup. What follows is what none of those say.

## Two runtimes, two tsconfigs

- `src/page/` runs inside VS Code's workbench page (Chromium). DOM types only, `src/page/tsconfig.json`. Bundled to `dist/beans.js` as one plain script; `src/inject.ts` embeds its text in a `Runtime.evaluate` call, so it has no module system at run time.
- Everything else in `src/` runs in the extension host, Node 20 (VS Code 1.90's Electron): no newer Node APIs. Root `tsconfig.json`. `src/cdp-relay.ts` is spawned as its own Node process by `relaunch.ts`, so it's its own bundle and imports nothing that needs VS Code.
- `src/shared/types.ts` is the only thing both sides import: types only.

## Rules that aren't in a config

- The page enforces Trusted Types: set attributes and classes, never assign HTML strings.
- Every VS Code class name the page depends on lives in `src/page/selectors.ts`. A new selector goes there, with a comment saying what VS Code element it is, since VS Code renames classes between releases and that file is where we look when hints vanish.
- Talon's requests arrive as plain JSON through command-server. `src/requests.ts` checks them once at the boundary; past it, the code trusts the types. Keep new parsing there, with a unit test.
- Pure logic goes in modules that import neither `vscode` nor the DOM (`paths.ts`, `globs.ts`, `requests.ts`, `hint-style.ts`, `page/hints.ts`), so `test/` can import them without a mock. There is no `vscode` mock, and that's deliberate.
- The relay protocol (`src/relay-protocol.ts`) is JSON messages ended by `\0`, the framing Chromium uses on its debug pipe; the relay passes messages through, renumbering ids. A change on one side is a change on both.
- Work in the extension host stays short and async: a Talon command blocks until it returns, and the hint script runs on the page's main thread, so DOM reads and writes stay batched inside one `requestAnimationFrame`.
- User-facing text follows the README's voice: plain sentences, "Beans" as the subject, what happened and what to do. Diagnostics go to the "Beans" Output Channel (`src/output.ts`), toasts only for what the user must act on.

## Trying a change

`pnpm dev` (or `vpr dev`) opens a separate VS Code running this checkout with hints live; a rebuild re-injects the page script and reloads the window for extension-host changes. To see the hints from outside, connect to the relay named in `.dev/user-data/beans-relay.json` (address and token) and evaluate in the page, as `scripts/dev.mts` does to reload. "Relaunch with hints" from an ordinary VS Code is the other path to test when `relaunch.ts` or `cdp-relay.ts` change.

`pnpm test:integration` (`vpr test:integration`) runs `test/integration/` against a downloaded VS Code, started through the relay the way `pnpm dev` starts it, and asserts in the page. CI runs it on pull requests and weekly against Insiders; when VS Code renames a class, this is the test that fails, and `src/page/selectors.ts` is where to fix it.

## Releases and the Talon folder

`CHANGELOG.md` has an "Unreleased" section; user-visible changes get a line there in the same PR. A release is the PR that bumps `version` and moves that section under the new version; CI publishes on merge. `beans-talon/` is mirrored to the `beans-talon` repo on merge, so it's edited here, never there.
