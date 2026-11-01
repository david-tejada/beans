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

A **hint** is the letters on a row, spoken with your community alphabet words. A **target** is one or more hints and ranges joined with "and", where a range is `<hint> past <hint>` and includes both ends. For example: `open harp past ink and made`.

### Hints

| Say | What it does |
| --- | --- |
| `click <hint>` | Click the row with that hint |
| `click <number>` | Click that row in the Command Palette |
| `beans toggle` | Show or hide the hints |
| `righty <hint>` | Right-click the row, opening its context menu |

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
| `open <target>` | Open |
| `split <target>` | Open to the side |
| `file delete <target>` | Delete |
| `file move <target> to <target>` | Move the first target's files into the second target's folder |
| `file move <target> to root` | Move the files into the workspace folder |
| `file copy path <target>` | Copy the path |
| `file copy local <target>` | Copy the relative path |
| `expand <target>` | Expand folders |
| `expand <target> deep <number>` | Expand folders that many levels deep |
| `collapse <target>` | Collapse folders |
| `parent <target>` | Collapse the parent folder |
| `select <target>` | Select the rows |
| `file open folder <target>` | Reveal in Finder / File Explorer |
| `stage <target>` | Stage changes |
| `unstage <target>` | Unstage changes |
| `discard <target>` | Discard changes |
| `diff <target>` | Open the diff |

These act on one row:

| Say | What it does |
| --- | --- |
| `file rename <target>` | Rename |
| `file create <target>` | Create a new file there |
| `folder new <target>` | Create a new folder there |
| `find in <target> [<text>]` | Search in that folder, then type the text |

### Resizing

These drag VS Code's dividers. A step is 60px for a width and 44px (two rows) for a height; a size is in pixels. `view <hint>` is the sidebar view holding that row or header. The step count is optional and defaults to one.

| Say | What it does |
| --- | --- |
| `side wider [<number>]` / `side narrower [<number>]` | Resize the sidebar by steps |
| `side width <number>` | Set the sidebar width |
| `secondary wider [<number>]` / `secondary narrower [<number>]` | Resize the secondary sidebar by steps |
| `secondary width <number>` | Set the secondary sidebar width |
| `panel taller [<number>]` / `panel shorter [<number>]` | Resize the panel by steps |
| `panel height <number>` | Set the panel height |
| `view <hint> taller [<number>]` / `view <hint> shorter [<number>]` | Resize a sidebar view by steps |
| `view <hint> height <number>` | Set a sidebar view's height |
| `view <hint> max` | Make a sidebar view as tall as it can be |

## License

[MIT](LICENSE)
