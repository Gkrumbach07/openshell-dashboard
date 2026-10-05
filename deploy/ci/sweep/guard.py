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

One more file may change on either axis, and only in one place: README.md
restates the range and the SDK pin between two marker comments, in a block
that scripts/readme-gateway-range.mjs generates from the pins file (and that
CI fails on when it is stale). A README change is accepted when it is confined
to that block and refused when a single character outside it differs.

It runs in the workflow after the edit and before the commit, so a bug in the
editing code cannot reach a branch.
"""

import re

import pins

PINS_FILE = "deploy/ci/gateway-pins.json"
GO_MOD = "backend/go.mod"
GO_SUM = "backend/go.sum"
README = "README.md"

ALLOWED = {
    "gateway": (PINS_FILE, README),
    "sdk": (GO_MOD, GO_SUM, PINS_FILE, README),
}

# The markers scripts/readme-gateway-range.mjs writes. The begin marker carries
# a note for readers after the name, so only its start is fixed.
README_BEGIN_RE = re.compile(r"<!-- gateway-range:begin\b[^\n]*?-->")
README_END = "<!-- gateway-range:end -->"

# go.mod directives that swap or drop a module. `go get` and `go mod tidy`
# only ever touch requirements, so a move of the SDK has no reason to add one.
GO_MOD_REDIRECT_RE = re.compile(r"^(replace|exclude)\b\s*(.*)$")


def _without(doc, *keys):
    return {k: v for k, v in doc.items() if k not in keys}


def _lane(doc, version):
    for lane in doc.get("lanes", []):
        if lane.get("version") == version:
            return lane
    return None


def split_readme(text):
    """(text before the generated block, the block, text after it), or None.

    None when the document does not carry exactly one begin marker followed by
    exactly one end marker. The markers themselves belong to the outside: a
    change to a marker is a change to the README, not to what is generated.
    """
    if not isinstance(text, str):
        return None
    begins = list(README_BEGIN_RE.finditer(text))
    if len(begins) != 1 or text.count(README_END) != 1:
        return None
    start, end = begins[0].end(), text.index(README_END)
    if end < start:
        return None
    return text[:start], text[start:end], text[end:]


def readme_problems(before, after):
    """Why a pending README.md change may not be committed. Empty when it may."""
    old, new = split_readme(before), split_readme(after)
    if old is None or new is None:
        return [
            "%s changed, but it has no generated gateway-range block (one `<!-- gateway-range:begin ... -->` "
            "and one `%s`), so the change cannot be the generated one." % (README, README_END)
        ]
    if (old[0], old[2]) != (new[0], new[2]):
        return [
            "%s changed outside its generated gateway-range block. An automated PR may only "
            "regenerate that block." % README
        ]
    return []


def go_mod_redirects(text):
    """The replace and exclude directives of a go.mod, one normalised entry each.

    Both spellings are read: `replace a => b` on one line, and a block
    `replace ( ... )` with one entry per line.
    """
    found, block = [], None
    for raw in (text or "").splitlines():
        line = raw.split("//")[0].strip()
        if block:
            if line == ")":
                block = None
            elif line:
                found.append("%s %s" % (block, " ".join(line.split())))
            continue
        m = GO_MOD_REDIRECT_RE.match(line)
        if not m:
            continue
        rest = m.group(2).strip()
        if rest == "(":
            block = m.group(1)
        elif rest:
            found.append("%s %s" % (m.group(1), " ".join(rest.split())))
    return sorted(found)


def go_mod_problems(before, after):
    """Why a pending backend/go.mod change is more than a move of requirements.

    The SDK PR carries a go.mod that a sweep leg produced and uploaded. It is
    data from a job that ran third-party code, so the one edit that would let
    it swap a dependency for something else is refused here rather than left
    for a reviewer to spot.
    """
    if go_mod_redirects(before) != go_mod_redirects(after):
        return [
            "%s gained or lost a replace/exclude directive. Moving the SDK changes requirements "
            "only; a directive that swaps or drops a module is a person's change." % GO_MOD
        ]
    return []


def check_changes(
    axis, changed_paths, before, after, go_mod_version=None, readme=None, go_mod=None
):
    """Problems with a pending change, as sentences. Empty means it may be committed.

    changed_paths: every path that differs from HEAD, tracked or not.
    before / after: the pins document at HEAD and in the working tree.
    go_mod_version: the SDK version now in backend/go.mod, when known; the
        `sdk` field must agree with it.
    readme: (text at HEAD, text in the working tree) when README.md changed.
    go_mod: (text at HEAD, text in the working tree) when backend/go.mod changed.
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
    if README in changed:
        # Named in the list of changed files but not shown to the guard: it
        # cannot be vouched for, so it is refused like any other stray file.
        problems += readme_problems(*(readme or (None, None)))
    problems += pins.validate(after, go_mod_version=go_mod_version)
    if problems:
        return problems

    # What is left after the generated block, which was judged above.
    changed = [p for p in changed if p != README]

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
            # An advisory lane that already existed for the new ceiling is
            # promoted to it, so that one lane is the change, not an edit.
            if kept is None or lane["version"] == new_ceiling:
                continue
            # The single-lane case relabels the old lane as the floor; nothing
            # else about a kept lane may change.
            if _without(kept, "label") != _without(lane, "label"):
                problems.append("lane %s was edited; only the ceiling lane may change" % lane["version"])
    else:
        if GO_MOD not in changed:
            problems.append("the sdk axis must change %s; nothing moved" % GO_MOD)
        elif go_mod is not None:
            problems += go_mod_problems(*go_mod)
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
