"""The one-axis guard: an automated PR changes exactly one axis.

The sweep only ever proves one link at a time, so a PR that moved the SDK and
a gateway together would claim something nobody tested. This module looks at a
working tree that is about to be committed and refuses anything outside the
axis it was prepared for:

  gateway axis  deploy/ci/gateway-pins.json only, and inside it only the
                ceiling lane. The SDK pin, the floor lane and the workload
                image stay exactly as they were.
  sdk axis      backend/go.mod, backend/go.sum and the `sdk` field of the pins
                file. No lane changes.

It runs in the workflow after the edit and before the commit, so a bug in the
editing code cannot reach a branch.
"""

import pins

PINS_FILE = "deploy/ci/gateway-pins.json"
GO_MOD = "backend/go.mod"
GO_SUM = "backend/go.sum"

ALLOWED = {
    "gateway": (PINS_FILE,),
    "sdk": (GO_MOD, GO_SUM, PINS_FILE),
}


def _without(doc, *keys):
    return {k: v for k, v in doc.items() if k not in keys}


def _lane(doc, version):
    for lane in doc.get("lanes", []):
        if lane.get("version") == version:
            return lane
    return None


def check_changes(axis, changed_paths, before, after, go_mod_version=None):
    """Problems with a pending change, as sentences. Empty means it may be committed.

    changed_paths: every path that differs from HEAD, tracked or not.
    before / after: the pins document at HEAD and in the working tree.
    go_mod_version: the SDK version now in backend/go.mod, when known; the
        `sdk` field must agree with it.
    """
    if axis not in ALLOWED:
        return ["unknown axis %r" % (axis,)]
    problems = []
    changed = sorted(set(changed_paths))
    stray = [p for p in changed if p not in ALLOWED[axis]]
    if stray:
        problems.append(
            "the %s axis may only change %s, but these also changed: %s"
            % (axis, ", ".join(ALLOWED[axis]), ", ".join(stray))
        )
    problems += pins.validate(after, go_mod_version=go_mod_version)
    if problems:
        return problems

    if axis == "gateway":
        if changed != [PINS_FILE]:
            problems.append("the gateway axis changes %s and nothing else; changed: %s" % (PINS_FILE, changed))
        if _without(before, "lanes") != _without(after, "lanes"):
            problems.append(
                "something other than a lane changed in the pins file. The SDK pin and the "
                "workload image do not move on the gateway axis."
            )
        old_floor, old_ceiling = pins.supported_range(before)
        new_floor, new_ceiling = pins.supported_range(after)
        if new_floor != old_floor:
            problems.append("the floor moved from %s to %s; the gateway axis only moves the ceiling" % (old_floor, new_floor))
        if pins.parse_release(new_ceiling) <= pins.parse_release(old_ceiling):
            problems.append("the ceiling did not move up (%s -> %s)" % (old_ceiling, new_ceiling))
        expected = set(lane["version"] for lane in before["lanes"]) | {new_ceiling}
        if old_floor != old_ceiling:
            expected.discard(old_ceiling)
        actual = set(lane["version"] for lane in after["lanes"])
        if actual != expected:
            problems.append(
                "lanes after the change should be %s, found %s" % (sorted(expected), sorted(actual))
            )
        for lane in before["lanes"]:
            kept = _lane(after, lane["version"])
            if kept is None:
                continue
            # The single-lane case relabels the old lane as the floor; nothing
            # else about a kept lane may change.
            if _without(kept, "label") != _without(lane, "label"):
                problems.append("lane %s was edited; only the ceiling lane may change" % lane["version"])
    else:
        if GO_MOD not in changed:
            problems.append("the sdk axis must change %s; nothing moved" % GO_MOD)
        if PINS_FILE not in changed:
            problems.append(
                "the sdk field of %s was not updated. It records the pin in %s and "
                "moves in the same commit." % (PINS_FILE, GO_MOD)
            )
        if _without(before, "sdk") != _without(after, "sdk"):
            problems.append(
                "something other than `sdk` changed in the pins file. No gateway lane moves "
                "on the sdk axis."
            )
        if before.get("sdk") == after.get("sdk"):
            problems.append("the sdk field did not change")
    return problems
