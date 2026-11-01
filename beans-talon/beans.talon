app: vscode
-
# Hints from the Beans extension (https://github.com/david-tejada/beans):
# letters on sidebar rows, numbers on Command Palette rows.
click <user.beans_hint>: user.run_rpc_command("beans.pick", beans_hint)
click <number_small>: user.run_rpc_command("beans.pick", number_small)
beans toggle: user.run_rpc_command("beans.toggle")

# Right-clicks a row, opening its context menu. Community's plain "righty"
# right-clicks at the mouse.
righty <user.beans_hint>: user.beans_right_click(beans_hint)

# Scrolls the open Command Palette, else the tallest sidebar list. With a
# hint, scrolls the sidebar list holding that row. Same words as Rango.
upper [<user.beans_hint>]: user.run_rpc_command("beans.scroll", "up", beans_hint or "")
downer [<user.beans_hint>]: user.run_rpc_command("beans.scroll", "down", beans_hint or "")
upper all [<user.beans_hint>]: user.run_rpc_command("beans.scroll", "top", beans_hint or "")
downer all [<user.beans_hint>]: user.run_rpc_command("beans.scroll", "bottom", beans_hint or "")

# Target commands. A target is hints and ranges joined with "and", like
# "harp past ink and made". Commands with a community "file ..." version for
# the open file use the same words, with a target added.
open <user.beans_target>: user.beans_run("beans.open", beans_target)
split <user.beans_target>: user.beans_run("beans.split", beans_target)
file delete <user.beans_target>: user.beans_run("beans.delete", beans_target)
file move <user.beans_target> to root: user.beans_move_to_root(beans_target)
file move <user.beans_target> to <user.beans_target>:
    user.beans_move(beans_target_1, beans_target_2)
file copy path <user.beans_target>: user.beans_run("beans.copyPath", beans_target)
file copy local <user.beans_target>: user.beans_run("beans.copyRelativePath", beans_target)
expand <user.beans_target>: user.beans_expand(beans_target, 1)
expand <user.beans_target> deep <number_small>: user.beans_expand(beans_target, number_small)
collapse <user.beans_target>: user.beans_run("beans.collapse", beans_target)
parent <user.beans_target>: user.beans_run("beans.collapseParent", beans_target)
select <user.beans_target>: user.beans_run("beans.select", beans_target)
file open folder <user.beans_target>: user.beans_run("beans.revealInFinder", beans_target)
stage <user.beans_target>: user.beans_run("beans.stage", beans_target)
unstage <user.beans_target>: user.beans_run("beans.unstage", beans_target)
discard <user.beans_target>: user.beans_run("beans.discard", beans_target)
diff <user.beans_target>: user.beans_run("beans.diff", beans_target)

# These act on one row.
file rename <user.beans_target>: user.beans_run("beans.rename", beans_target)
file create <user.beans_target>: user.beans_run("beans.newFile", beans_target)
folder new <user.beans_target>: user.beans_run("beans.newFolder", beans_target)
find in <user.beans_target> [<user.text>]: user.beans_find_in(beans_target, text or "")

# Resizing, by dragging VS Code's dividers. A step is 60px for a width and
# 44px (two rows) for a height; a size is in pixels. "view <hint>" is the
# sidebar view holding that row or header.
side wider [<number_small>]: user.beans_grow("sidebar", number_small or 1)
side narrower [<number_small>]: user.beans_shrink("sidebar", number_small or 1)
side width <number>: user.beans_resize_to("sidebar", number)
secondary wider [<number_small>]: user.beans_grow("secondary", number_small or 1)
secondary narrower [<number_small>]: user.beans_shrink("secondary", number_small or 1)
secondary width <number>: user.beans_resize_to("secondary", number)
panel taller [<number_small>]: user.beans_grow("panel", number_small or 1)
panel shorter [<number_small>]: user.beans_shrink("panel", number_small or 1)
panel height <number>: user.beans_resize_to("panel", number)
view <user.beans_hint> taller [<number_small>]: user.beans_grow(beans_hint, number_small or 1)
view <user.beans_hint> shorter [<number_small>]: user.beans_shrink(beans_hint, number_small or 1)
view <user.beans_hint> height <number>: user.beans_resize_to(beans_hint, number)
view <user.beans_hint> max: user.beans_resize_max(beans_hint)
