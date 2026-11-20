# Changelog

## Unreleased

- The Talon commands have new words, and the old ones are gone. The commands that act on rows start with "bean", so they don't clash with other Talon commands such as talon-gaze-ocr's "click": "click air" is now "bean air", "righty air" is "bean righty air", "open air" is "bean open air", and "file delete air" is "bean delete air". A few changed more than their prefix: "file open folder" is "bean reveal", "file create" and "folder new" are "bean new file" and "bean new folder". The resize commands say "bigger", "smaller" and "size": "bar bigger" for the sidebar, "right bar bigger" for the secondary sidebar, "panel smaller", "view air size 300". "upper" and "downer" are unchanged. The full list is in the beans-talon README. Pull beans-talon (`git pull` in its folder) to get the new words.
- "this" can be said in place of a hint, for the selected rows: "bean split this", "downer this", "view this bigger", "bean move this to drum". It's the selection of the sidebar list you're in, or the Explorer's while you're in the editor. Only selected rows on screen count, and Beans says when none is. When the selection may go on past the screen, delete, move, discard, stage and unstage do nothing and say why, rather than change part of it; the other commands use the rows on screen and say so. Pull beans-talon to get the word.
- "upper" and "downer" scroll the document now: the one in the editor split you're in, even while the focus is in the sidebar or the terminal. "upper bar" and "downer bar" do what "upper" and "downer" used to, scrolling the tallest sidebar list; "upper side" and "downer side" do the same, for when "bar" sounds like "bat". "upper left" and "downer right" scroll the left or right editor split without moving the focus. A hint works as before, and an open Command Palette still takes every scroll, "left" and "right" included. "upper all" and "downer all" go with any of these. A scroll moves 80% of the view now, keeping at least one row in sight, where it used to keep two rows. Pull beans-talon to get the new words.

## 0.3.1

- Beans is no longer marked as a preview on the Marketplace and Open VSX.
- In Theia, with `beans.stableHints`, a folder's files no longer take the letters of the rows that were in their place when it expands.

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
