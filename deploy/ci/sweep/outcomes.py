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
  * a missing result is never read as a pass or as a failure. It leaves the
    issue and the PRs alone and marks the run incomplete.
"""

import pins

# Step outcomes as GitHub Actions reports them.
STEP_SUCCESS = "success"

# What one leg observed.
COMPATIBLE = "compatible"
INCOMPATIBLE = "incompatible"  # the compat suite failed
STACK_FAILED = "stack_failed"  # the gateway never became healthy
SOURCE_INCOMPATIBLE = "source_incompatible"  # go get / build / vet / test failed
NO_RESULT = "no_result"  # the leg did not report

# What a row means once the whole run is known.
OK = "ok"  # passed, nothing to do
BUMP = "bump"  # passed and is this axis's PR
HELD = "held"  # passed, but a failing release below it holds the ceiling
WIRE = "wire"  # the wire link failed
SOURCE = "source"  # the source link failed
STACK = "stack"  # inconclusive: a gateway did not start
INFO = "info"  # below the supported range; informational
MISSING = "missing"

NEEDS_ATTENTION = (WIRE, SOURCE, STACK)

SOURCE_STEPS = ("get", "tidy", "build", "vet", "test")


def gateway_leg_outcome(stack, compat):
    """Step outcomes of a gateway-axis leg -> what it observed."""
    if stack != STEP_SUCCESS:
        return STACK_FAILED
    return COMPATIBLE if compat == STEP_SUCCESS else INCOMPATIBLE


def sdk_leg_outcome(source, stack, compat):
    """Step outcomes of an SDK-axis leg -> what it observed.

    The source check comes first and short-circuits: when the BFF does not
    build against an SDK there is no binary to point at a gateway, so the
    result says nothing about any gateway.
    """
    if source != STEP_SUCCESS:
        return SOURCE_INCOMPATIBLE
    return gateway_leg_outcome(stack, compat)


def _release_key(row):
    return pins.parse_release(row["version"])


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
    # directly above it, and stops at the first one that did not pass. Moving
    # past a failing release would publish a range with a known hole in it.
    above = sorted((r for r in rows if r["kind"] == "release" and r["position"] == "above"), key=_release_key)
    target, blocker = None, None
    for row in above:
        if blocker is None and row["outcome"] == COMPATIBLE:
            target = row
        elif blocker is None:
            blocker = row

    for row in rows:
        outcome = row["outcome"]
        if outcome == NO_RESULT:
            row["status"] = MISSING
        elif row["kind"] != "release":
            # Upstream HEAD: reported, never acted on.
            row["status"] = {COMPATIBLE: OK, INCOMPATIBLE: WIRE}.get(outcome, STACK)
        elif row["position"] == "below":
            row["status"] = INFO
        elif outcome == INCOMPATIBLE:
            row["status"] = WIRE
        elif outcome == STACK_FAILED:
            row["status"] = STACK
        elif row["position"] == "above" and row is target:
            row["status"] = BUMP
        elif row["position"] == "above" and blocker is not None and _release_key(row) > _release_key(blocker):
            row["status"] = HELD
            row["held_by"] = blocker["version"]
        else:
            row["status"] = OK
        if target is not None and row["status"] == OK and row["position"] == "above":
            row["passed_over_for"] = target["version"]

    bump = None
    if target is not None:
        bump = {
            "from": plan["range"]["ceiling"],
            "version": target["version"],
            "gateway_image": target["gateway_image"],
            "supervisor_image": target["supervisor_image"],
            "config_schema": target["config_schema"],
        }
    # A missing result above the ceiling means this run cannot say whether the
    # ceiling may move, so an existing PR is neither refreshed nor closed.
    if any(r["status"] == MISSING for r in above):
        pr = "skip"
    else:
        pr = "open" if bump else "close"
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
        outcomes = [lane["outcome"] for lane in row["lanes"]]
        broken = next((r for r in results if r and r["outcome"] == SOURCE_INCOMPATIBLE), None)
        failed = [lane["version"] for lane in row["lanes"] if lane["outcome"] == INCOMPATIBLE]
        row["dropped"] = failed
        row["drops_floor"] = floor in failed
        if broken is not None:
            # Decided before any gateway is looked at: one leg that could not
            # build speaks for the SDK, whatever the other legs reported.
            row["status"] = SOURCE
            row["source_step"] = broken.get("source_step") or "build"
            row["source_log"] = broken.get("source_log") or ""
        elif failed:
            # One failing lane settles it, even when another lane never
            # reported: this SDK cannot be a bump.
            row["status"] = WIRE
        elif NO_RESULT in outcomes or not legs:
            row["status"] = MISSING
        elif STACK_FAILED in outcomes:
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
    if release is not None and release["status"] == MISSING:
        pr = "skip"
    else:
        pr = "open" if bump else "close"
    return {"rows": rows, "bump": bump, "pr": pr}


def _join(items):
    items = list(items)
    if len(items) <= 1:
        return "".join(items)
    return ", ".join(items[:-1]) + " and " + items[-1]


def _title(gateway_rows, sdk_rows):
    """One line saying which link needs a person, most urgent first."""
    releases = [r for r in gateway_rows if not r["early_warning"]]
    in_range = [r["version"] for r in releases if r["status"] == WIRE and r["position"] == "in_range"]
    above = [r["version"] for r in releases if r["status"] == WIRE and r["position"] == "above"]
    stuck = [r["version"] for r in releases if r["status"] == STACK]
    parts = []
    if in_range:
        parts.append("gateway %s fails inside the supported range (wire)" % _join(in_range))
    if above:
        parts.append("gateway %s does not work with the code we ship (wire)" % _join(above))
    if stuck:
        parts.append("gateway %s did not start" % _join(stuck))
    for row in sdk_rows:
        if row["early_warning"]:
            continue
        if row["status"] == SOURCE:
            parts.append("SDK %s needs a source migration" % row["label"])
        elif row["status"] == WIRE:
            parts.append("SDK %s would drop gateway %s (wire)" % (row["label"], _join(row["dropped"])))
        elif row["status"] == STACK:
            parts.append("SDK %s could not be tested" % row["label"])
    if parts:
        return "Compat sweep: " + "; ".join(parts)
    return "Compat sweep: early warning from upstream HEAD"


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

    outstanding = [r for r in rows if r["status"] in NEEDS_ATTENTION and not r["early_warning"]]
    early = [r for r in rows if r["status"] in NEEDS_ATTENTION and r["early_warning"]]
    missing = [r for r in rows if r["status"] == MISSING]

    if outstanding or early:
        action = "upsert"
    elif missing:
        # Nothing is known to be wrong, but not everything is known: do not
        # close an issue on the strength of a leg that never reported.
        action = "keep"
    else:
        action = "close"

    return {
        "range": plan["range"],
        "sdk_pin": plan["sdk_pin"],
        "sdk_pin_tag": plan.get("sdk_pin_tag"),
        "newest_release": plan.get("newest_release"),
        "lanes": [lane["version"] for lane in plan["lanes"]],
        "head_probed": bool(plan.get("inputs", {}).get("include_head", True)),
        "notes": {
            "skipped": plan["gateway"].get("skipped", []),
            "not_swept": plan["gateway"].get("not_swept", []),
        },
        "gateway": gateway,
        "sdk": sdk,
        "counts": {"outstanding": len(outstanding), "early_warning": len(early), "missing": len(missing)},
        "issue": {"action": action, "title": _title(gateway["rows"], sdk["rows"])},
        "incomplete": bool(missing),
    }
