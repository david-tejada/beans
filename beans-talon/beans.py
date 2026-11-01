from talon import Module, actions, ui

mod = Module()

# Resize targets that are parts of the window; anything else is a hint.
PARTS = {"sidebar", "secondary", "panel"}


@mod.capture(rule="<user.letters>")
def beans_hint(m) -> str:
    """The letters of one sidebar hint, like "any bill" for AB."""
    return str(m.letters)


@mod.capture(rule="<user.beans_hint> [past <user.beans_hint>]")
def beans_item(m) -> dict:
    """One hint, or a range of rows from one hint past another, both included."""
    hints = m.beans_hint_list
    if len(hints) == 1:
        return {"hint": hints[0]}
    return {"from": hints[0], "to": hints[1]}


@mod.capture(rule="<user.beans_item> (and <user.beans_item>)*")
def beans_target(m) -> dict:
    """Hints and ranges joined with "and": "harp past ink and made"."""
    return {"items": m.beans_item_list}


@mod.action_class
class Actions:
    def beans_run(command: str, target: dict):
        """Run a Beans target command"""
        actions.user.run_rpc_command(command, {"target": target})

    def beans_right_click(hint: str):
        """Right-click the row with this hint, opening its context menu"""
        # On macOS, VS Code opens a context menu at the real cursor, so the
        # mouse has to move there. The point is a fraction of the window.
        point = actions.user.run_rpc_command_get("beans.rowPoint", hint)
        if not point:
            return
        rect = ui.active_window().rect
        actions.mouse_move(rect.x + rect.width * point["x"], rect.y + rect.height * point["y"])
        actions.mouse_click(1)

    def beans_move(target: dict, destination: dict):
        """Move the target's files into the destination's folder"""
        actions.user.run_rpc_command("beans.move", {"target": target, "destination": destination})

    def beans_move_to_root(target: dict):
        """Move the target's files into the workspace folder"""
        actions.user.run_rpc_command("beans.move", {"target": target, "destination": "root"})

    def beans_expand(target: dict, levels: int):
        """Expand the target's folders this many levels deep"""
        actions.user.run_rpc_command("beans.expand", {"target": target, "levels": levels})

    def beans_find_in(target: dict, text: str):
        """Search in the target's folder, then type the text"""
        actions.user.run_rpc_command_and_wait("beans.findInFolder", {"target": target})
        actions.insert(text)

    def beans_grow(target: str, steps: int):
        """Grow a part, or the sidebar view with this hint, by this many steps"""
        actions.user.run_rpc_command("beans.resize", {"target": resize_target(target), "by": steps})

    def beans_shrink(target: str, steps: int):
        """Shrink a part, or the sidebar view with this hint, by this many steps"""
        actions.user.run_rpc_command("beans.resize", {"target": resize_target(target), "by": -steps})

    def beans_resize_to(target: str, pixels: int):
        """Resize a part, or the sidebar view with this hint, to this many pixels"""
        actions.user.run_rpc_command("beans.resize", {"target": resize_target(target), "to": pixels})

    def beans_resize_max(target: str):
        """Make the sidebar view with this hint, or a part, as big as it can be"""
        actions.user.run_rpc_command("beans.resize", {"target": resize_target(target), "max": True})


def resize_target(target: str):
    """A part's name as is, or a hint as {"hint": letters}."""
    return target if target in PARTS else {"hint": target}
