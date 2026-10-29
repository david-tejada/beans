# Changelog

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
