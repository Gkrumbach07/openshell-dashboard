"""Outcome classification: what does a set of sweep results mean?

Three links make up the version chain, and each is proven separately:

  gateway <-> SDK   the WIRE link. Proven only by running backend/test/compat
                    against a real gateway. A newer gateway is not assumed to
                    work with a newer SDK, or the other way round.
  SDK <-> BFF       the SOURCE link. Proven by the compiler, go vet and the
                    unit tests. No gateway is involved.
  BFF <-> UI        ship together from one commit; nothing to sweep.

Every verdict below names the link it is about, because the two are fixed in
different places by different work. A compile error is never reported as a
gateway that cannot be reached.

Invariants enforced here rather than left to the workflow:

  * each axis can produce at most one PR, and that PR is for that axis only;
  * dev / HEAD and @latest are early warning. They never become a bump target,
    whatever their result;
  * the ceiling never moves past a release that failed OR that this run has no
    result for (not swept, no published image, a leg that did not report);
  * unknown is not a result. A leg that did not report, or two legs that
    disagree about the same commands on the same SDK, is never read as a pass
    or as a failure: it closes nothing, proposes nothing it depends on, and
    marks the run incomplete;
  * a run that was narrowed by hand (a cap that left part of the range out,
    HEAD not probed) reports what it saw but never closes the issue: it did
    not look at everything the issue may be about.
"""

import pins

# Step outcomes as GitHub Actions reports them.
STEP_SUCCESS = "success"

# What one leg observed.
COMPATIBLE = "compatible"
INCOMPATIBLE = "incompatible"  # the compat suite failed
PULL_FAILED = "pull_failed"  # an image could not be pulled
STACK_FAILED = "stack_failed"  # the gateway never became healthy
BFF_FAILED = "bff_failed"  # the BFF did not become healthy in front of the gateway
SOURCE_INCOMPATIBLE = "source_incompatible"  # go build / vet / test failed
SDK_UNRESOLVED = "sdk_unresolved"  # go get / go mod tidy failed
NO_RESULT = "no_result"  # the leg did not report

# The leg never got as far as sending the gateway a request, so it says nothing
# about either link.
SETUP_FAILED = (PULL_FAILED, STACK_FAILED, BFF_FAILED)

# What a row means once the whole run is known.
OK = "ok"  # passed, nothing to do
BUMP = "bump"  # passed and is this axis's PR
HELD = "held"  # passed, but a release below it holds the ceiling
WIRE = "wire"  # the wire link failed
SOURCE = "source"  # the source link failed
STACK = "stack"  # inconclusive: the leg could not be set up (pull, gateway, BFF)
UNRESOLVED = "unresolved"  # inconclusive: the SDK could not be fetched or resolved
INFO = "info"  # below the supported range; informational
MISSING = "missing"  # unknown: a leg did not report
FLAKY = "flaky"  # unknown: legs disagree about the same source check

NEEDS_ATTENTION = (WIRE, SOURCE, STACK, UNRESOLVED)
UNKNOWN = (MISSING, FLAKY)

# The source check's steps (sourcecheck.py). The first two fetch and resolve
# the module; only the last three say anything about the BFF's source.
RESOLVE_STEPS = ("get", "tidy")
PROVE_STEPS = ("build", "vet", "test")
SOURCE_STEPS = RESOLVE_STEPS + PROVE_STEPS

# Why a passing release above the ceiling is held back.
HELD_FAILED = "failed"
HELD_SETUP = "setup"
HELD_MISSING = "missing"
HELD_UNSWEPT = "unswept"

# GitHub refuses an issue title longer than 256 characters.
TITLE_LIMIT = 240


def gateway_leg_outcome(pull, stack, bff, compat):
    """Step outcomes of a gateway-axis leg -> what it observed.

    The steps run in this order and each needs the one before it, so the
    first that did not succeed names what happened. Only a compat suite that
    ran says anything about compatibility.
    """
    if pull != STEP_SUCCESS:
        return PULL_FAILED
    if stack != STEP_SUCCESS:
        return STACK_FAILED
    if bff != STEP_SUCCESS:
        return BFF_FAILED
    return COMPATIBLE if compat == STEP_SUCCESS else INCOMPATIBLE


def sdk_leg_outcome(source, source_step, pull, stack, bff, compat):
    """Step outcomes of an SDK-axis leg -> what it observed.

    The source check comes first and short-circuits: when the BFF does not
    build against an SDK there is no binary to point at a gateway, so the
    result says nothing about any gateway.

    A source check that failed without naming a step it is known to have is
    NO_RESULT. Guessing "build" there would report a compile failure nobody
    saw, which is the mistake this sweep was rebuilt to stop making.
    """
    if source != STEP_SUCCESS:
        if source_step in RESOLVE_STEPS:
            return SDK_UNRESOLVED
        if source_step in PROVE_STEPS:
            return SOURCE_INCOMPATIBLE
        return NO_RESULT
    return gateway_leg_outcome(pull, stack, bff, compat)


def _release_key(row):
    return pins.parse_release(row["version"])


def _unswept_above(plan):
    """Releases above the ceiling that upstream has and this run did not test.

    Either the tag has no published image yet, or - only possible with a plan
    that was not built by candidates.py, which never caps above the ceiling -
    it was left out. Both are a hole the ceiling may not be moved across.
    """
    ceiling = pins.parse_release(plan["range"]["ceiling"])
    found = {}
    for skipped in plan["gateway"].get("skipped", []):
        release = pins.parse_release(skipped["version"])
        if release is not None and release > ceiling:
            found[skipped["version"]] = {"version": skipped["version"], "reason": skipped["reason"], "capped": False}
    for version in plan["gateway"].get("not_swept", []):
        release = pins.parse_release(version)
        if release is not None and release > ceiling:
            found[version] = {"version": version, "reason": "left out of this run", "capped": True}
    return list(found.values())


def _decide_gateway(plan, by_id):
    rows = []
    for candidate in plan["gateway"]["candidates"]:
        result = by_id.get(candidate["id"])
        row = dict(candidate)
        row["outcome"] = result["outcome"] if result else NO_RESULT
        row["config_schema"] = result.get("config_schema") if result else None
        row["early_warning"] = candidate["kind"] != "release"
        rows.append(row)

    # The ceiling advances through the unbroken run of passing releases
    # directly above it, and stops at the first release that did not pass OR
    # that this run has no result for. Moving past either would publish a
    # range with a hole in it: one known, the other simply never looked at.
    above = [r for r in rows if r["kind"] == "release" and r["position"] == "above"]
    unswept = _unswept_above(plan)
    ladder = [(_release_key(r), r, None) for r in above] + [(_release_key(u), None, u) for u in unswept]
    ladder.sort(key=lambda step: step[0])
    target, blocker = None, None
    for key, row, hole in ladder:
        if blocker is not None:
            break
        if row is not None and row["outcome"] == COMPATIBLE:
            target = row
            continue
        if hole is not None:
            why, reason = HELD_UNSWEPT, hole["reason"]
        elif row["outcome"] == NO_RESULT:
            why, reason = HELD_MISSING, None
        elif row["outcome"] in SETUP_FAILED:
            why, reason = HELD_SETUP, None
        else:
            why, reason = HELD_FAILED, None
        blocker = {"version": (row or hole)["version"], "key": key, "why": why, "reason": reason}

    held = set(
        r["id"] for r in above if blocker is not None and r["outcome"] == COMPATIBLE and _release_key(r) > blocker["key"]
    )

    # What this run may do with the axis's PR. A result it does not have,
    # anywhere above the ceiling, means it cannot say where the ceiling
    # belongs: an existing PR is then neither refreshed nor closed.
    if any(r["outcome"] == NO_RESULT for r in above) or any(u["capped"] for u in unswept):
        pr = "skip"
    elif target is not None:
        pr = "open"
    elif held and blocker["why"] == HELD_UNSWEPT:
        pr = "skip"
    else:
        pr = "close"

    for row in rows:
        outcome = row["outcome"]
        is_above = row["kind"] == "release" and row["position"] == "above"
        if outcome == NO_RESULT:
            row["status"] = MISSING
        elif row["kind"] != "release":
            # Upstream HEAD: reported, never acted on.
            row["status"] = {COMPATIBLE: OK, INCOMPATIBLE: WIRE}.get(outcome, STACK)
        elif row["position"] == "below":
            row["status"] = INFO
        elif outcome == INCOMPATIBLE:
            row["status"] = WIRE
        elif outcome in SETUP_FAILED:
            row["status"] = STACK
        elif row["id"] in held:
            row["status"] = HELD
            row["held_by"] = blocker["version"]
            row["held_why"] = blocker["why"]
            row["held_reason"] = blocker["reason"]
        elif row is target and pr == "open":
            row["status"] = BUMP
        else:
            row["status"] = OK
            if is_above and pr == "open":
                row["passed_over_for"] = target["version"]
            elif is_above:
                # It passed, and would have been (part of) the move, but this
                # run proposes nothing on the axis. The row must not send a
                # reader to a PR that this run did not open.
                row["not_proposed"] = True

    bump = None
    if pr == "open":
        bump = {
            "from": plan["range"]["ceiling"],
            "version": target["version"],
            "gateway_image": target["gateway_image"],
            "supervisor_image": target["supervisor_image"],
            "config_schema": target["config_schema"],
        }
    return {"rows": rows, "bump": bump, "pr": pr}


def _decide_sdk(plan, by_id):
    floor = plan["range"]["floor"]
    rows = []
    for candidate in plan["sdk"]["candidates"]:
        row = dict(candidate)
        row["early_warning"] = candidate["kind"] != "release"
        legs = [leg for leg in plan["sdk"]["legs"] if leg["sdk_id"] == candidate["id"]]
        results = [by_id.get(leg["id"]) for leg in legs]
        row["lanes"] = [
            {"version": leg["lane"], "outcome": result["outcome"] if result else NO_RESULT}
            for leg, result in zip(legs, results)
        ]
        observed = [lane["outcome"] for lane in row["lanes"]]
        # Every leg of one candidate runs the same source check on the same
        # SDK version. A leg that got past it - whatever happened afterwards -
        # saw it pass.
        broken = [r for r in results if r and r["outcome"] == SOURCE_INCOMPATIBLE]
        unresolved = [r for r in results if r and r["outcome"] == SDK_UNRESOLVED]
        passed_source = [o for o in observed if o in (COMPATIBLE, INCOMPATIBLE) + SETUP_FAILED]
        failed = [lane["version"] for lane in row["lanes"] if lane["outcome"] == INCOMPATIBLE]
        row["dropped"] = failed
        row["drops_floor"] = floor in failed
        # A leg that got as far as build, vet or test says more than one that
        # could not fetch the module, so its output is the one that is kept.
        first = (broken or unresolved or [None])[0]
        if first is not None:
            row["source_step"] = first.get("source_step") or None
            row["source_log"] = first.get("source_log") or ""
        if first is not None and passed_source:
            # The same commands on the same SDK cannot both pass and fail. The
            # disagreement itself shows the failure is not a property of the
            # SDK: a flaky unit test, or the network during `go get`.
            row["status"] = FLAKY
        elif broken:
            # Decided before any gateway is looked at, and by every leg that
            # got that far: the BFF's source does not fit this SDK.
            row["status"] = SOURCE
        elif unresolved:
            row["status"] = UNRESOLVED
        elif failed:
            # One failing lane settles it, even when another lane never
            # reported: this SDK cannot be a bump.
            row["status"] = WIRE
        elif NO_RESULT in observed or not legs:
            row["status"] = MISSING
        elif any(o in SETUP_FAILED for o in observed):
            row["status"] = STACK
        elif candidate["kind"] == "release":
            row["status"] = BUMP
        else:
            row["status"] = OK
        rows.append(row)

    release = next((r for r in rows if r["kind"] == "release"), None)
    bump = None
    if release is not None and release["status"] == BUMP:
        bump = {
            "from": plan["sdk_pin"],
            "from_tag": plan.get("sdk_pin_tag"),
            "version": release["version"],
            "tag": release["tag"],
            "commit": release["commit"],
            "lanes": [lane["version"] for lane in release["lanes"]],
        }
    # Unknown, or a failure that is as likely the network as the SDK: this run
    # cannot say whether the SDK may move, so an existing PR is left as it is.
    if release is not None and release["status"] in UNKNOWN + (UNRESOLVED,):
        pr = "skip"
    else:
        pr = "open" if bump else "close"
    return {
        "rows": rows,
        "bump": bump,
        "pr": pr,
        # The one release this run tried, so a PR that proposes a different
        # one is not closed for something it was never retested against.
        "candidate": release["label"] if release is not None else None,
    }


def _join(items):
    items = list(items)
    if len(items) <= 1:
        return "".join(items)
    return ", ".join(items[:-1]) + " and " + items[-1]


def _title(gateway_rows, sdk_rows, pin_off_release):
    """One line saying which link needs a person, most urgent first."""
    releases = [r for r in gateway_rows if not r["early_warning"]]
    in_range = [r["version"] for r in releases if r["status"] == WIRE and r["position"] == "in_range"]
    above = [r["version"] for r in releases if r["status"] == WIRE and r["position"] == "above"]
    stuck = [r["version"] for r in releases if r["status"] == STACK and r["outcome"] == STACK_FAILED]
    untested = [r["version"] for r in releases if r["status"] == STACK and r["outcome"] != STACK_FAILED]
    parts = []
    if in_range:
        parts.append("gateway %s fails inside the supported range (wire)" % _join(in_range))
    if above:
        parts.append("gateway %s does not work with the code we ship (wire)" % _join(above))
    if stuck:
        parts.append("gateway %s did not start" % _join(stuck))
    if untested:
        parts.append("gateway %s could not be tested" % _join(untested))
    for row in sdk_rows:
        if row["early_warning"]:
            continue
        if row["status"] == SOURCE:
            parts.append("SDK %s needs a source migration" % row["label"])
        elif row["status"] == WIRE:
            parts.append("SDK %s would drop gateway %s (wire)" % (row["label"], _join(row["dropped"])))
        elif row["status"] == UNRESOLVED:
            parts.append("SDK %s could not be fetched or resolved" % row["label"])
        elif row["status"] == STACK:
            parts.append("SDK %s could not be tested" % row["label"])
    if pin_off_release:
        parts.append("the SDK pin is not on a release tag")
    title = "Compat sweep: " + "; ".join(parts) if parts else "Compat sweep: early warning from upstream HEAD"
    if len(title) > TITLE_LIMIT:
        title = title[: TITLE_LIMIT - 4].rstrip() + " ..."
    return title


def _narrowed(plan):
    """Reasons this run did not look at everything a scheduled sweep looks at."""
    reasons = []
    floor, ceiling = (pins.parse_release(plan["range"][key]) for key in ("floor", "ceiling"))
    left_out = [
        version
        for version in plan["gateway"].get("not_swept", [])
        if pins.parse_release(version) is not None and floor <= pins.parse_release(version) <= ceiling
    ]
    if left_out:
        reasons.append(
            "max_versions left %s inside the supported range unswept" % _join(left_out)
        )
    if not plan.get("inputs", {}).get("include_head", True):
        reasons.append("upstream HEAD was not probed")
    return reasons


def decide(plan, results):
    """Turn a plan and the results that came back into one decision.

    The decision is plain data: the rows to report, at most one bump per axis,
    what to do with each axis's PR (open / close / skip) and with the issue
    (upsert / close / keep).
    """
    by_id = {}
    for result in results:
        by_id[result["id"]] = result

    gateway = _decide_gateway(plan, by_id)
    sdk = _decide_sdk(plan, by_id)
    rows = gateway["rows"] + sdk["rows"]

    planned = [c["id"] for c in plan["gateway"]["candidates"]] + [leg["id"] for leg in plan["sdk"]["legs"]]
    silent = [leg_id for leg_id in planned if leg_id not in by_id]

    # ADR 0006 pins the SDK to the commit of an upstream release tag. A pin
    # that is anywhere else was moved by hand, and only a person can move it
    # back, so it goes to the issue and not only to the step summary.
    pin_off_release = not plan.get("sdk_pin_tag")

    outstanding = [r for r in rows if r["status"] in NEEDS_ATTENTION and not r["early_warning"]]
    early = [r for r in rows if r["status"] in NEEDS_ATTENTION and r["early_warning"]]
    unknown = [r for r in rows if r["status"] in UNKNOWN]
    held_by_a_hole = [r for r in gateway["rows"] if r["status"] == HELD and r.get("held_why") == HELD_UNSWEPT]
    narrowed = _narrowed(plan)

    kept_because = []
    if silent or unknown:
        kept_because.append("at least one leg did not report, or legs disagreed, so not everything is known")
    if held_by_a_hole:
        kept_because.append(
            "gateway %s passes but sits above %s, which this run has no result for"
            % (_join(r["version"] for r in held_by_a_hole), held_by_a_hole[0]["held_by"])
        )
    kept_because += narrowed

    if outstanding or early or pin_off_release:
        action = "upsert"
    elif kept_because:
        # Nothing is known to be wrong, but not everything was looked at: do
        # not close an issue on the strength of what this run did not see.
        action = "keep"
    else:
        action = "close"

    return {
        "range": plan["range"],
        "sdk_pin": plan["sdk_pin"],
        "sdk_pin_tag": plan.get("sdk_pin_tag"),
        "sdk_pin_other_tag": plan.get("sdk_pin_other_tag"),
        "newest_release": plan.get("newest_release"),
        "lanes": [lane["version"] for lane in plan["lanes"]],
        "head_probed": bool(plan.get("inputs", {}).get("include_head", True)),
        "max_versions": plan.get("inputs", {}).get("max_versions"),
        "notes": {
            "skipped": plan["gateway"].get("skipped", []),
            "not_swept": plan["gateway"].get("not_swept", []),
        },
        "gateway": gateway,
        "sdk": sdk,
        "counts": {
            "outstanding": len(outstanding) + (1 if pin_off_release else 0),
            "early_warning": len(early),
            "missing": len(unknown),
        },
        "issue": {
            "action": action,
            "title": _title(gateway["rows"], sdk["rows"], pin_off_release),
            "kept_because": kept_because if action == "keep" else [],
        },
        # Red run: the sweep's own machinery did not deliver every result.
        "incomplete": bool(silent or unknown),
    }
