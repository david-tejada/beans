app: vscode
-
# Hints from the Beans extension (https://github.com/david-tejada/beans):
# letters on sidebar rows, numbers on Command Palette rows. The commands that
# act on rows start with "bean", so they don't clash with other Talon
# commands, such as talon-gaze-ocr's "click".
bean <user.beans_hint>: user.run_rpc_command("beans.pick", beans_hint)
bean <number_small>: user.run_rpc_command("beans.pick", number_small)
bean toggle: user.run_rpc_command("beans.toggle")

# Right-clicks a row, opening its context menu. Community's plain "righty"
# right-clicks at the mouse; the prefix keeps the two apart.
bean righty <user.beans_hint>: user.beans_right_click(beans_hint)

# An open Command Palette takes every scroll. Otherwise these scroll the
# document in the focused editor split; with a hint, the sidebar list holding
# that row; with "left" or "right", that editor split, without moving the
# focus; with "bar" or "side", the tallest sidebar list (see
# beans_scroll_place.talon-list). Same words as Rango.
upper [<user.beans_hint>]: user.run_rpc_command("beans.scroll", "up", beans_hint or "", "")
downer [<user.beans_hint>]: user.run_rpc_command("beans.scroll", "down", beans_hint or "", "")
upper all [<user.beans_hint>]: user.run_rpc_command("beans.scroll", "top", beans_hint or "", "")
downer all [<user.beans_hint>]: user.run_rpc_command("beans.scroll", "bottom", beans_hint or "", "")
upper {user.beans_scroll_place}: user.run_rpc_command("beans.scroll", "up", "", beans_scroll_place)
downer {user.beans_scroll_place}: user.run_rpc_command("beans.scroll", "down", "", beans_scroll_place)
upper all {user.beans_scroll_place}: user.run_rpc_command("beans.scroll", "top", "", beans_scroll_place)
downer all {user.beans_scroll_place}: user.run_rpc_command("beans.scroll", "bottom", "", beans_scroll_place)

# Target commands. A target is hints and ranges joined with "and", like
# "harp past ink and made".
bean open <user.beans_target>: user.beans_run("beans.open", beans_target)
bean split <user.beans_target>: user.beans_run("beans.split", beans_target)
bean delete <user.beans_target>: user.beans_run("beans.delete", beans_target)
bean move <user.beans_target> to root: user.beans_move_to_root(beans_target)
bean move <user.beans_target> to <user.beans_target>:
    user.beans_move(beans_target_1, beans_target_2)
bean copy path <user.beans_target>: user.beans_run("beans.copyPath", beans_target)
bean copy local <user.beans_target>: user.beans_run("beans.copyRelativePath", beans_target)
bean expand <user.beans_target>: user.beans_expand(beans_target, 1)
bean expand <user.beans_target> deep <number_small>: user.beans_expand(beans_target, number_small)
bean collapse <user.beans_target>: user.beans_run("beans.collapse", beans_target)
bean parent <user.beans_target>: user.beans_run("beans.collapseParent", beans_target)
bean select <user.beans_target>: user.beans_run("beans.select", beans_target)
bean reveal <user.beans_target>: user.beans_run("beans.revealInFinder", beans_target)
bean stage <user.beans_target>: user.beans_run("beans.stage", beans_target)
bean unstage <user.beans_target>: user.beans_run("beans.unstage", beans_target)
bean discard <user.beans_target>: user.beans_run("beans.discard", beans_target)
bean diff <user.beans_target>: user.beans_run("beans.diff", beans_target)

# These act on one row.
bean rename <user.beans_target>: user.beans_run("beans.rename", beans_target)
bean new file <user.beans_target>: user.beans_run("beans.newFile", beans_target)
bean new folder <user.beans_target>: user.beans_run("beans.newFolder", beans_target)
bean find in <user.beans_target> [<user.text>]: user.beans_find_in(beans_target, text or "")

# Resizing, by dragging VS Code's dividers. A step is 60px for a width and
# 44px (two rows) for a height; a size is in pixels. "bar" is the primary
# sidebar and "right bar" the secondary one, which is on the right unless
# you've moved the primary sidebar there; if you have, change the words here.
# "view <hint>" is the sidebar view holding that row or header.
bar bigger [<number_small>]: user.beans_grow("sidebar", number_small or 1)
bar smaller [<number_small>]: user.beans_shrink("sidebar", number_small or 1)
bar size <number>: user.beans_resize_to("sidebar", number)
right bar bigger [<number_small>]: user.beans_grow("secondary", number_small or 1)
right bar smaller [<number_small>]: user.beans_shrink("secondary", number_small or 1)
right bar size <number>: user.beans_resize_to("secondary", number)
panel bigger [<number_small>]: user.beans_grow("panel", number_small or 1)
panel smaller [<number_small>]: user.beans_shrink("panel", number_small or 1)
panel size <number>: user.beans_resize_to("panel", number)
view <user.beans_hint> bigger [<number_small>]: user.beans_grow(beans_hint, number_small or 1)
view <user.beans_hint> smaller [<number_small>]: user.beans_shrink(beans_hint, number_small or 1)
view <user.beans_hint> size <number>: user.beans_resize_to(beans_hint, number)
view <user.beans_hint> max: user.beans_resize_max(beans_hint)

# Switches to the editor tab with these letters, in whichever split it is,
# even when it's scrolled out of the tab strip. Tabs have letters of their
# own, apart from the rows': a tab can be A while a row is A too. Same word
# as Rango.
slot <user.letters>: user.run_rpc_command("beans.slot", letters)
