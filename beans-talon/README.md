# beans-talon

These are the [Talon](https://talonvoice.com) voice commands for [Beans](https://github.com/david-tejada/beans), my VS Code extension that puts letter hints on sidebar rows (and numbers on Command Palette rows) so I can drive VS Code by voice. The extension draws the hints; this repo gives you the words to use them.

This repo is a mirror of the [`beans-talon/` folder of the Beans repo](https://github.com/david-tejada/beans/tree/main/beans-talon), updated on every merge there. Issues and pull requests go to [Beans](https://github.com/david-tejada/beans).

## Requirements

- The [Beans extension](https://marketplace.visualstudio.com/items?itemName=david-tejada.beans) from the VS Code Marketplace.
- The [Talon community repo](https://github.com/talonhub/community) in your Talon user folder. Beans uses its alphabet (`<user.letters>`), its number captures and its command client actions.
- The [command-server](https://marketplace.visualstudio.com/items?itemName=pokey.command-server) VS Code extension, which lets Talon run VS Code commands. Talon sends every Beans command through it.

## Install

Clone this repo into your Talon user folder:

- macOS and Linux: `~/.talon/user`
- Windows: `%APPDATA%\Talon\user`

```bash
cd ~/.talon/user
git clone https://github.com/david-tejada/beans-talon
```

Talon picks the files up on its own; there's no need to restart it. The commands only work while VS Code is the focused app.

## Commands

The commands that act on rows start with `bean`, so they don't clash with other Talon commands, such as `click` in [talon-gaze-ocr](https://github.com/wolfmanstout/talon-gaze-ocr).

A **hint** is the letters on a row, spoken with your community alphabet words. A **target** is one or more hints and ranges joined with "and", where a range is `<hint> past <hint>` and includes both ends. For example: `bean open harp past ink and made`.

Wherever a hint goes, you can say `this` for the selected rows, so you don't have to look for the letters: `bean split this`, `downer this`, `view this bigger`, `bean move this to drum`. In a target, `this` is every selected row; where one row is needed, and as the end of a range, it's the first one. The selection is the one in the sidebar list you're in, or the Explorer's while you're in the editor. Only the rows on screen count. When Beans can tell the selection may go on past the screen, `bean delete`, `bean move`, `bean discard`, `bean stage` and `bean unstage` do nothing and say why, and the other commands use the selected rows on screen and say so. Scroll until a row past each end of the selection shows, or say the rows' hints.

### Hints

| Say | What it does |
| --- | --- |
| `bean <hint>` | Click the row with that hint |
| `bean <number>` | Click that row in the Command Palette |
| `bean toggle` | Show or hide the hints |
| `bean righty <hint>` | Right-click the row, opening its context menu |

### Scrolling

These scroll the open Command Palette, or else the tallest sidebar list. With a hint, they scroll the sidebar list holding that row.

| Say | What it does |
| --- | --- |
| `upper [<hint>]` | Scroll up |
| `downer [<hint>]` | Scroll down |
| `upper all [<hint>]` | Scroll to the top |
| `downer all [<hint>]` | Scroll to the bottom |

### Targets

| Say | What it does |
| --- | --- |
| `bean open <target>` | Open |
| `bean split <target>` | Open to the side |
| `bean delete <target>` | Delete |
| `bean move <target> to <target>` | Move the first target's files into the second target's folder |
| `bean move <target> to root` | Move the files into the workspace folder |
| `bean copy path <target>` | Copy the path |
| `bean copy local <target>` | Copy the relative path |
| `bean expand <target>` | Expand folders |
| `bean expand <target> deep <number>` | Expand folders that many levels deep |
| `bean collapse <target>` | Collapse folders |
| `bean parent <target>` | Collapse the parent folder |
| `bean select <target>` | Select the rows |
| `bean reveal <target>` | Reveal in Finder / File Explorer |
| `bean stage <target>` | Stage changes |
| `bean unstage <target>` | Unstage changes |
| `bean discard <target>` | Discard changes |
| `bean diff <target>` | Open the diff |

These act on one row:

| Say | What it does |
| --- | --- |
| `bean rename <target>` | Rename |
| `bean new file <target>` | Create a new file there |
| `bean new folder <target>` | Create a new folder there |
| `bean find in <target> [<text>]` | Search in that folder, then type the text |

### Resizing

These drag VS Code's dividers. A step is 60px for a width and 44px (two rows) for a height; a size is in pixels. `view <hint>` is the sidebar view holding that row or header. The step count is optional and defaults to one. `right bar` is the secondary sidebar, which is on the right unless you've moved the primary sidebar there. If you have, you can change the words in your copy of `beans.talon`.

| Say | What it does |
| --- | --- |
| `bar bigger [<number>]` / `bar smaller [<number>]` | Resize the sidebar by steps |
| `bar size <number>` | Set the sidebar width |
| `right bar bigger [<number>]` / `right bar smaller [<number>]` | Resize the secondary sidebar by steps |
| `right bar size <number>` | Set the secondary sidebar width |
| `panel bigger [<number>]` / `panel smaller [<number>]` | Resize the panel by steps |
| `panel size <number>` | Set the panel height |
| `view <hint> bigger [<number>]` / `view <hint> smaller [<number>]` | Resize a sidebar view by steps |
| `view <hint> size <number>` | Set a sidebar view's height |
| `view <hint> max` | Make a sidebar view as tall as it can be |

## License

[MIT](LICENSE)
