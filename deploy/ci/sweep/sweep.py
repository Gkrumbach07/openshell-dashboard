#!/usr/bin/env python3
"""Command line for the gateway compatibility sweep (ADR 0006).

.github/workflows/compat-sweep.yml and the compat-pins job in ci.yml call this
file and nothing else in this directory. The workflow keeps the parts only a
runner can do (checkout, toolchains, containers, `gh`); every decision is made
here, where it can be unit-tested:

    validate-pins      fail fast on a malformed deploy/ci/gateway-pins.json
    format-pins        rewrite the pins file the way the automated PRs write it
    range              print the derived supported range
    plan               discover what this run should test, on both axes
    record-gateway     turn one gateway-axis leg's step outcomes into a result
    sdk-source-check   move the SDK, then build / vet / unit-test the BFF
    record-sdk         turn one SDK-axis leg's step outcomes into a result
    report             classify the results; render the issue and the summary
    bump-gateway       move the ceiling lane (gateway axis PR)
    bump-sdk           record the new SDK pin (SDK axis PR)
    check-diff         refuse a pending change that leaves its axis
    pr-text            render a PR's title, body and commit message

Standard library only: a runner needs nothing installed to use it.
"""

import argparse
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import candidates  # noqa: E402
import guard  # noqa: E402
import outcomes  # noqa: E402
import pins  # noqa: E402
import report  # noqa: E402
import sourcecheck  # noqa: E402
import upstream as upstream_module  # noqa: E402

DEFAULT_PINS = "deploy/ci/gateway-pins.json"
DEFAULT_GO_MOD = "backend/go.mod"


def _read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def _write(path, text):
    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)


def _set_outputs(values):
    """Append step outputs when running under GitHub Actions; print them always."""
    lines = ["%s=%s" % (key, value) for key, value in values.items()]
    target = os.environ.get("GITHUB_OUTPUT")
    if target:
        with open(target, "a", encoding="utf-8") as fh:
            fh.write("\n".join(lines) + "\n")
    for line in lines:
        print(line)


def _fail(problems):
    for problem in problems:
        print("::error::" + problem if os.environ.get("GITHUB_ACTIONS") else "error: " + problem, file=sys.stderr)
    return 1


def _load_valid_pins(path, go_mod=None):
    """Load the pins file or exit with every problem it has."""
    doc = pins.load(path)
    go_mod_version = None
    if go_mod:
        go_mod_version = pins.go_mod_sdk(_read(go_mod))
        if go_mod_version is None:
            raise pins.PinsError(["%s does not require %s" % (go_mod, pins.SDK_MODULE)])
    problems = pins.validate(doc, schemas=pins.known_schemas(path), go_mod_version=go_mod_version)
    if problems:
        raise pins.PinsError(problems)
    return doc


def cmd_validate_pins(args):
    doc = _load_valid_pins(args.pins, args.go_mod)
    floor, ceiling = pins.supported_range(doc)
    print("%s is well formed" % args.pins)
    print("supported gateway range: %s to %s (derived from the required lanes)" % (floor, ceiling))
    print("sdk pin: %s" % doc["sdk"])
    return 0


def cmd_format_pins(args):
    """Rewrite the pins file the way the automated PRs write it.

    After a hand edit this keeps the next automated PR's diff down to the
    lines it means to change.
    """
    doc = pins.load(args.pins)
    _write(args.pins, pins.dump(doc))
    print("%s rewritten in canonical form" % args.pins)
    return 0


def cmd_range(args):
    doc = _load_valid_pins(args.pins)
    floor, ceiling = pins.supported_range(doc)
    print(json.dumps({"floor": floor, "ceiling": ceiling, "sdk": doc["sdk"]}))
    return 0


def cmd_plan(args, upstream=None):
    doc = _load_valid_pins(args.pins, args.go_mod)
    upstream = upstream or upstream_module.Upstream(backend_dir=os.path.dirname(args.go_mod) or ".")
    plan = candidates.build_plan(
        doc,
        upstream,
        max_versions=args.max_versions,
        include_head=args.include_head == "1",
        since=args.since or None,
    )
    _write(args.out, json.dumps(plan, indent=2) + "\n")
    gateway_matrix = plan["gateway"]["candidates"]
    sdk_matrix = plan["sdk"]["legs"]
    print(json.dumps(plan, indent=2))
    _set_outputs(
        {
            "gateway_matrix": json.dumps(gateway_matrix, separators=(",", ":")),
            "gateway_count": len(gateway_matrix),
            "sdk_matrix": json.dumps(sdk_matrix, separators=(",", ":")),
            "sdk_count": len(sdk_matrix),
        }
    )
    return 0


def _record(args, result):
    path = os.path.join(args.out, result["id"] + ".json")
    _write(path, json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
    return 0


def cmd_record_gateway(args):
    leg = json.loads(args.leg)
    outcome = outcomes.gateway_leg_outcome(args.stack, args.compat)
    schema = args.config_schema or None
    if outcome != outcomes.STACK_FAILED and not schema:
        return _fail(["the stack came up but did not report which config schema it used"])
    return _record(args, {"id": leg["id"], "axis": "gateway", "outcome": outcome, "config_schema": schema})


def cmd_sdk_source_check(args):
    result = sourcecheck.check(args.sdk_version, args.backend, echo=print)
    _write(args.log, result["log"])
    _set_outputs({"step": result["step"] or ""})
    if not result["ok"]:
        print("source link FAILED at `%s` for SDK %s (output above; no gateway was involved)" % (result["step"], args.sdk_version))
        return 1
    print("source link holds: the BFF builds, vets and passes its unit tests against SDK %s" % args.sdk_version)
    return 0


def cmd_record_sdk(args):
    leg = json.loads(args.leg)
    outcome = outcomes.sdk_leg_outcome(args.source, args.stack, args.compat)
    result = {"id": leg["id"], "axis": "sdk", "outcome": outcome}
    if outcome == outcomes.SOURCE_INCOMPATIBLE:
        result["source_step"] = args.source_step or "build"
        log = _read(args.source_log) if args.source_log and os.path.exists(args.source_log) else ""
        # An artifact, not an archive: the report shows a few thousand characters.
        result["source_log"] = report.clip(log, budget=20000)
    return _record(args, result)


def _load_results(directory):
    results = []
    for root, _, files in os.walk(directory):
        for name in sorted(files):
            if name.endswith(".json"):
                results.append(json.loads(_read(os.path.join(root, name))))
    return results


def cmd_report(args):
    plan = json.loads(_read(args.plan))
    results = _load_results(args.results) if os.path.isdir(args.results) else []
    decision = outcomes.decide(plan, results)
    title, body = report.render_issue(decision, args.run_url)
    summary = report.render_summary(decision, args.run_url)
    _write(os.path.join(args.out, "decision.json"), json.dumps(decision, indent=2) + "\n")
    _write(os.path.join(args.out, "issue-title.txt"), title + "\n")
    _write(os.path.join(args.out, "issue-body.md"), body)
    _write(os.path.join(args.out, "summary.md"), summary)
    print(summary)
    _set_outputs(
        {
            "issue_action": decision["issue"]["action"],
            "gateway_pr": decision["gateway"]["pr"],
            "sdk_pr": decision["sdk"]["pr"],
            "incomplete": "1" if decision["incomplete"] else "0",
        }
    )
    return 0


def cmd_bump_gateway(args):
    decision = json.loads(_read(args.decision))
    bump = decision["gateway"]["bump"]
    if not bump:
        return _fail(["this run has no gateway bump; nothing to pin"])
    doc = _load_valid_pins(args.pins)
    new = pins.move_ceiling(
        doc, bump["version"], bump["gateway_image"], bump["supervisor_image"], bump["config_schema"]
    )
    problems = pins.validate(new, schemas=pins.known_schemas(args.pins))
    if problems:
        return _fail(problems)
    _write(args.pins, pins.dump(new))
    print("ceiling lane moved: %s -> %s" % (bump["from"], bump["version"]))
    return 0


def cmd_bump_sdk(args):
    decision = json.loads(_read(args.decision))
    bump = decision["sdk"]["bump"]
    if not bump:
        return _fail(["this run has no SDK bump; nothing to record"])
    version = pins.go_mod_sdk(_read(args.go_mod))
    if version != bump["version"]:
        return _fail(
            [
                "%s requires SDK %s but the sweep tested %s. A PR may only carry the "
                "version that was proven." % (args.go_mod, version, bump["version"])
            ]
        )
    doc = pins.load(args.pins)
    new = pins.set_sdk(doc, version)
    problems = pins.validate(new, schemas=pins.known_schemas(args.pins), go_mod_version=version)
    if problems:
        return _fail(problems)
    _write(args.pins, pins.dump(new))
    print("sdk pin recorded: %s -> %s" % (doc.get("sdk"), version))
    return 0


def _git(*argv):
    return subprocess.check_output(("git",) + argv, universal_newlines=True)


def cmd_check_diff(args):
    changed = _git("diff", "--name-only", "HEAD").splitlines()
    changed += _git("ls-files", "--others", "--exclude-standard").splitlines()
    before = json.loads(_git("show", "HEAD:" + args.pins))
    after = pins.load(args.pins)
    go_mod_version = pins.go_mod_sdk(_read(args.go_mod))
    problems = guard.check_changes(args.axis, changed, before, after, go_mod_version=go_mod_version)
    if problems:
        return _fail(["one-axis guard (%s): %s" % (args.axis, p) for p in problems])
    print("one-axis guard (%s): ok. Changed: %s" % (args.axis, ", ".join(sorted(set(changed)))))
    return 0


def cmd_pr_text(args):
    decision = json.loads(_read(args.decision))
    if not decision[args.axis]["bump"]:
        return _fail(["this run has no %s bump; there is no PR to describe" % args.axis])
    text = report.render_pr(args.axis, decision, args.run_url, args.has_sweep_token == "true")
    _write(os.path.join(args.out, "title.txt"), text["title"] + "\n")
    _write(os.path.join(args.out, "body.md"), text["body"])
    _write(os.path.join(args.out, "commit.txt"), text["commit"])
    print(text["title"])
    return 0


def build_parser():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command")
    sub.required = True

    def add(name, func, help_text):
        p = sub.add_parser(name, help=help_text)
        p.set_defaults(func=func)
        return p

    p = add("validate-pins", cmd_validate_pins, "fail on a malformed pins file")
    p.add_argument("pins", nargs="?", default=DEFAULT_PINS)
    p.add_argument("--go-mod", default=None, help="also require the sdk field to match this go.mod")

    p = add("format-pins", cmd_format_pins, "rewrite the pins file in canonical form")
    p.add_argument("pins", nargs="?", default=DEFAULT_PINS)

    p = add("range", cmd_range, "print the derived supported range as JSON")
    p.add_argument("pins", nargs="?", default=DEFAULT_PINS)

    p = add("plan", cmd_plan, "discover candidates on both axes")
    p.add_argument("--pins", default=DEFAULT_PINS)
    p.add_argument("--go-mod", default=DEFAULT_GO_MOD)
    p.add_argument("--max-versions", type=int, default=5)
    p.add_argument("--include-head", default="1", choices=("0", "1"))
    p.add_argument("--since", default="")
    p.add_argument("--out", required=True)

    p = add("record-gateway", cmd_record_gateway, "record one gateway-axis leg")
    p.add_argument("--leg", required=True, help="the matrix entry, as JSON")
    p.add_argument("--stack", required=True)
    p.add_argument("--compat", required=True)
    p.add_argument("--config-schema", default="")
    p.add_argument("--out", required=True)

    p = add("sdk-source-check", cmd_sdk_source_check, "move the SDK and prove the source link")
    p.add_argument("--sdk-version", required=True)
    p.add_argument("--backend", default="backend")
    p.add_argument("--log", required=True)

    p = add("record-sdk", cmd_record_sdk, "record one SDK-axis leg")
    p.add_argument("--leg", required=True, help="the matrix entry, as JSON")
    p.add_argument("--source", required=True)
    p.add_argument("--source-step", default="")
    p.add_argument("--source-log", default="")
    p.add_argument("--stack", required=True)
    p.add_argument("--compat", required=True)
    p.add_argument("--out", required=True)

    p = add("report", cmd_report, "classify results and render the report")
    p.add_argument("--plan", required=True)
    p.add_argument("--results", required=True)
    p.add_argument("--run-url", default="")
    p.add_argument("--out", required=True)

    p = add("bump-gateway", cmd_bump_gateway, "move the ceiling lane")
    p.add_argument("--decision", required=True)
    p.add_argument("--pins", default=DEFAULT_PINS)

    p = add("bump-sdk", cmd_bump_sdk, "record the new SDK pin")
    p.add_argument("--decision", required=True)
    p.add_argument("--pins", default=DEFAULT_PINS)
    p.add_argument("--go-mod", default=DEFAULT_GO_MOD)

    p = add("check-diff", cmd_check_diff, "refuse a change that leaves its axis")
    p.add_argument("--axis", required=True, choices=("gateway", "sdk"))
    p.add_argument("--pins", default=DEFAULT_PINS)
    p.add_argument("--go-mod", default=DEFAULT_GO_MOD)

    p = add("pr-text", cmd_pr_text, "render a PR's title, body and commit message")
    p.add_argument("--axis", required=True, choices=("gateway", "sdk"))
    p.add_argument("--decision", required=True)
    p.add_argument("--run-url", default="")
    p.add_argument("--has-sweep-token", default="false")
    p.add_argument("--out", required=True)
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except pins.PinsError as err:
        return _fail(err.problems)
    except (candidates.PlanError, upstream_module.UpstreamError) as err:
        return _fail([str(err)])


if __name__ == "__main__":
    sys.exit(main())
