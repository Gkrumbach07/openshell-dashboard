"""Shared test plumbing: a fake upstream and a scenario runner.

A scenario is a JSON file in fixtures/scenarios. It says what upstream looks
like, what each leg of the sweep observed, and what the run must conclude.
run_scenario() pushes that through the same functions the workflow calls -
plan, classify each leg, decide - with FakeUpstream standing in for git, the
registry and the Go module proxy. Nothing here opens a socket or starts a
container.
"""

import copy
import json
import os

import candidates
import outcomes
import upstream

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURES = os.path.join(HERE, "fixtures")
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))

# What a leg reports unless the scenario says otherwise: everything worked.
# A scenario names only the step that failed; like the workflow's `if:`
# conditions, every step after a failed one is then "skipped".
DEFAULT_LEG = {
    "source": "success",
    "pull": "success",
    "stack": "success",
    "bff": "success",
    "compat": "success",
    "config_schema": "v2",
}
STEP_ORDER = ("source", "pull", "stack", "bff", "compat")


def observed(overrides=None):
    """One leg's step outcomes, with the steps after a failure skipped."""
    overrides = overrides or {}
    leg = dict(DEFAULT_LEG, **overrides)
    failed = False
    for step in STEP_ORDER:
        if failed and step not in overrides:
            leg[step] = "skipped"
        failed = failed or leg[step] != "success"
    return leg


def fixture(name):
    with open(os.path.join(FIXTURES, name), encoding="utf-8") as fh:
        return json.load(fh)


def scenario_names():
    return sorted(name[:-5] for name in os.listdir(os.path.join(FIXTURES, "scenarios")) if name.endswith(".json"))


class FakeUpstream(object):
    """Answers the three network questions from a fixture and records them."""

    def __init__(self, data):
        self.data = data
        self.digest_lookups = []
        self.sdk_queries = []

    def release_tags(self):
        return "\n".join(self.data["tags"]) + "\n"

    def image_digest(self, repository, tag):
        key = "%s:%s" % (repository.rsplit("/", 1)[-1], tag)
        self.digest_lookups.append(key)
        if key in self.data.get("outage", []):
            raise upstream.UpstreamError("ghcr.io/%s:%s: registry answered HTTP 503" % (repository, tag))
        return self.data["images"].get(key)

    def sdk_version(self, query):
        self.sdk_queries.append(query)
        return self.data["sdk"][query]


def upstream_data(patch=None):
    """The real upstream of 2026-10-05, with a scenario's additions on top."""
    data = copy.deepcopy(fixture("upstream.json"))
    patch = patch or {}
    data["tags"] = data["tags"] + patch.get("tags", [])
    data["images"].update(patch.get("images", {}))
    data["sdk"].update(patch.get("sdk", {}))
    data["outage"] = patch.get("outage", [])
    return data


def leg_results(plan, legs=None):
    """What the workflow's record steps would have uploaded for this plan."""
    legs = legs or {}
    results = []
    for candidate in plan["gateway"]["candidates"]:
        if candidate["id"] in legs and legs[candidate["id"]] is None:
            continue  # this leg never reported
        leg = observed(legs.get(candidate["id"]))
        outcome = outcomes.gateway_leg_outcome(leg["pull"], leg["stack"], leg["bff"], leg["compat"])
        results.append(
            {"id": candidate["id"], "axis": "gateway", "outcome": outcome, "config_schema": leg["config_schema"] or None}
        )
    for sdk_leg in plan["sdk"]["legs"]:
        if sdk_leg["id"] in legs and legs[sdk_leg["id"]] is None:
            continue
        leg = observed(legs.get(sdk_leg["id"]))
        # A fixture that fails the source check without saying where means the
        # compiler: that is the case the sweep was rebuilt around.
        step = leg.get("source_step", "build")
        outcome = outcomes.sdk_leg_outcome(leg["source"], step, leg["pull"], leg["stack"], leg["bff"], leg["compat"])
        if outcome == outcomes.NO_RESULT:
            continue  # `sweep.py record-sdk` refuses to record it, so nothing is uploaded
        result = {"id": sdk_leg["id"], "axis": "sdk", "outcome": outcome}
        if outcome in (outcomes.SOURCE_INCOMPATIBLE, outcomes.SDK_UNRESOLVED):
            result["source_step"] = step
            result["source_log"] = leg.get("source_log", "")
        results.append(result)
    return results


def run_scenario(name):
    """(scenario, plan, results, decision) for fixtures/scenarios/<name>.json."""
    scenario = fixture("scenarios/%s.json" % name)
    doc = fixture(scenario.get("pins", "pins.json"))
    inputs = scenario.get("inputs", {})
    plan = candidates.build_plan(
        doc,
        FakeUpstream(upstream_data(scenario.get("upstream"))),
        max_versions=inputs.get("max_versions"),
        include_head=inputs.get("include_head", True),
        since=inputs.get("since"),
    )
    results = leg_results(plan, scenario.get("legs"))
    return scenario, plan, results, outcomes.decide(plan, results)
