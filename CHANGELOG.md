# Changelog

## Unreleased

## 0.3.0

- The `beans.stableHints` setting gives each row a letter it keeps while its sidebar shows the same view, so scrolling or expanding a folder no longer changes the other rows' letters, and a row that scrolls away has the same letter when it comes back. New rows get two letters once the single letters are taken; switching the sidebar to another view forgets its letters.
- Beans works in the Eclipse Theia IDE desktop app: hints on the sidebar rows and view headers, numbers in the Command Palette, and the file commands. **Relaunch with hints** used to fail there without a word. Resizing, expanding more than one level and collapsing a file's folder say they don't work in Theia yet.
- When **Relaunch with hints** can't quit the editor, Beans says so, and quitting it yourself within two minutes finishes the relaunch.
- The `beans.hintSpacing` setting replaces `beans.hintStyle`, with three spacings: `"compact"`, `"default"` and `"comfortable"`. The default sits between the other two, with less space around the pill than before; `"comfortable"` is the old default. The old setting is gone, so set the new one if you had it.
- A **Beans** Output Channel (View → Output) logs what Beans does: the relay, each injection, errors from the page. Paste it into a bug report.
- Expand and collapse work on every row that has an arrow, such as Search files, Outline symbols, Source Control commits and view headers, instead of only on folders. Search files used to expand the file's row in the Explorer, and rows that aren't files were skipped.
- Expand and collapse leave the keyboard focus where it was (except "expand T deep N", which goes through the Explorer), and collapsing a sticky scroll row no longer selects it or scrolls the tree: the folder stays where its sticky row was.

## 0.2.0

- The `beans.hintStyle` setting: `"compact"` draws narrower hints that sit closer to the icon and the name.
- Right-click lands on the row when VS Code uses the native title bar, instead of above it.
- File commands work on the rows of a remote window opened from Windows, which Beans took for files outside the workspace folders.

## 0.1.0

The first release.

- Letter hints on every visible row of the VS Code sidebars (Explorer, Search, Source Control, Outline, Run and Debug, Extensions…) and on the headers of their views, and number hints on the rows of the Command Palette and other quick picks.
- Commands for Talon, called through command-server: click or right-click a row, scroll a list, resize the sidebars, the panel and sidebar views, and act on files and folders by hint (open, split, delete, move, copy path, expand, collapse, select, reveal, stage, unstage, discard, diff, rename, new file or folder, find in folder).
- **Beans: Relaunch with hints** restarts VS Code with its debug pipe, held by a small relay process, so Beans can show its hints without changing any of VS Code's files.
- **Beans: Toggle hints** and **Beans: Inject the hint script** in the Command Palette.
