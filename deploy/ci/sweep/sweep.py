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
    bump-sdk           copy in the tested go.mod and record the new SDK pin
    check-diff         refuse a pending change that leaves its axis
    pr-text            render a PR's title, body and commit message
    pr-close           decide whether this run may close an open sweep PR

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
import prs  # noqa: E402
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
    # Checked last, so a malformed file is reported for what is wrong with it
    # rather than for how it is laid out.
    if not pins.is_canonical(_read(args.pins)):
        return _fail(
            [
                "%s is well formed but not in canonical form (indentation, escapes or the final "
                "newline differ from what the automated PRs write). The next automated PR would "
                "rewrite lines it did not mean to change. Run `python3 deploy/ci/sweep/sweep.py "
                "format-pins %s` and commit the result." % (args.pins, args.pins)
            ]
        )
    floor, ceiling = pins.supported_range(doc)
    print("%s is well formed" % args.pins)
    print("supported gateway range: %s to %s (derived from the required lanes)" % (floor, ceiling))
    print("sdk pin: %s" % doc["sdk"])
    return 0


def cmd_format_pins(args):
    """Rewrite the pins file the way the automated PRs write it.

    After a hand edit this keeps the next automated PR's diff down to the
    lines it means to change. validate-pins requires it.
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


def _max_versions(text):
    """'' -> None (every release in the range); otherwise a whole number."""
    text = (text or "").strip()
    if not text:
        return None
    try:
        return int(text)
    except ValueError:
        raise candidates.PlanError("max_versions=%r is not a whole number" % (text,))


def cmd_plan(args, upstream=None):
    doc = _load_valid_pins(args.pins, args.go_mod)
    upstream = upstream or upstream_module.Upstream(backend_dir=os.path.dirname(args.go_mod) or ".")
    plan = candidates.build_plan(
        doc,
        upstream,
        max_versions=_max_versions(args.max_versions),
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
    outcome = outcomes.gateway_leg_outcome(args.pull, args.stack, args.bff, args.compat)
    schema = args.config_schema or None
    if outcome in (outcomes.COMPATIBLE, outcomes.INCOMPATIBLE) and not schema:
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
    outcome = outcomes.sdk_leg_outcome(args.source, args.source_step, args.pull, args.stack, args.bff, args.compat)
    if outcome == outcomes.NO_RESULT:
        # Exit non-zero and upload nothing: the report then reads this leg as
        # "no result", which is what is actually known.
        return _fail(
            [
                "the source check did not succeed and did not say which step failed "
                "(--source-step %r). Nothing is known about this SDK from this leg, so no "
                "result is recorded; the report will show the leg as not having reported."
                % (args.source_step,)
            ]
        )
    result = {"id": leg["id"], "axis": "sdk", "outcome": outcome}
    if outcome in (outcomes.SOURCE_INCOMPATIBLE, outcomes.SDK_UNRESOLVED):
        result["source_step"] = args.source_step
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
    title, body = report.render_issue(decision, args.run_url, args.repo_url)
    summary = report.render_summary(decision, args.run_url, args.repo_url, dry_run=args.dry_run == "true")
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


def _tested_go_files(directory):
    """(go.mod text, go.sum text, how many copies) uploaded by the legs that passed.

    Every passing leg of the release SDK uploads the go.mod and go.sum it
    built and tested. They were all produced by the same commands on the same
    commit, so they must be byte-identical; a difference means the legs did
    not test one tree, and then there is no tree to commit.
    """
    copies = []
    for root, _, files in sorted(os.walk(directory)):
        if "go.mod" in files and "go.sum" in files:
            copies.append((_read(os.path.join(root, "go.mod")), _read(os.path.join(root, "go.sum")), root))
    if not copies:
        raise pins.PinsError(
            ["no tested go.mod and go.sum under %s: the SDK legs that passed upload them, and a PR may only carry what a leg proved" % directory]
        )
    for go_mod, go_sum, root in copies[1:]:
        if (go_mod, go_sum) != copies[0][:2]:
            raise pins.PinsError(
                ["the go.mod / go.sum in %s differ from the ones in %s. The legs did not test one tree, so nothing is committed." % (root, copies[0][2])]
            )
    return copies[0][0], copies[0][1], len(copies)


def cmd_bump_sdk(args):
    decision = json.loads(_read(args.decision))
    bump = decision["sdk"]["bump"]
    if not bump:
        return _fail(["this run has no SDK bump; nothing to record"])
    if args.tested:
        # Copied, never regenerated: producing them means running `go`, which
        # downloads and (in `go test`) executes the candidate SDK. The job
        # that calls this holds a write token and must not do either.
        go_mod, go_sum, count = _tested_go_files(args.tested)
        tested = pins.go_mod_sdk(go_mod)
        if tested != bump["version"]:
            return _fail(
                [
                    "the uploaded go.mod requires SDK %s but the sweep decided on %s. A PR may "
                    "only carry the version that was proven." % (tested, bump["version"])
                ]
            )
        _write(args.go_mod, go_mod)
        _write(os.path.join(os.path.dirname(args.go_mod), "go.sum"), go_sum)
        print("copied the go.mod and go.sum that %d passing leg(s) tested" % count)
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


def _at_head(path):
    """A file's text at HEAD, or None when HEAD does not have it."""
    try:
        return _git("show", "HEAD:" + path)
    except subprocess.CalledProcessError:
        return None


def cmd_check_diff(args):
    changed = _git("diff", "--name-only", "HEAD").splitlines()
    changed += _git("ls-files", "--others", "--exclude-standard").splitlines()
    before = json.loads(_git("show", "HEAD:" + args.pins))
    after = pins.load(args.pins)
    go_mod_version = pins.go_mod_sdk(_read(args.go_mod))
    readme = go_mod = None
    if guard.README in changed:
        readme = (_at_head(guard.README), _read(args.readme) if os.path.exists(args.readme) else None)
    if guard.GO_MOD in changed:
        go_mod = (_at_head(guard.GO_MOD), _read(args.go_mod))
    problems = guard.check_changes(
        args.axis, changed, before, after, go_mod_version=go_mod_version, readme=readme, go_mod=go_mod
    )
    if problems:
        return _fail(["one-axis guard (%s): %s" % (args.axis, p) for p in problems])
    changed = sorted(set(changed))
    if args.changed_out:
        _write(args.changed_out, "\n".join(changed) + "\n")
    print("one-axis guard (%s): ok. Changed: %s" % (args.axis, ", ".join(changed)))
    return 0


def _prs(path):
    return json.loads(_read(path)) if path and os.path.exists(path) else []


def cmd_pr_text(args):
    decision = json.loads(_read(args.decision))
    if not decision[args.axis]["bump"]:
        return _fail(["this run has no %s bump; there is no PR to describe" % args.axis])
    changed = _read(args.changed).splitlines() if args.changed and os.path.exists(args.changed) else []
    text = report.render_pr(
        args.axis,
        decision,
        args.run_url,
        args.has_sweep_token == "true",
        repo_url=args.repo_url,
        readme_block=guard.README in changed,
    )
    _write(os.path.join(args.out, "title.txt"), text["title"] + "\n")
    _write(os.path.join(args.out, "body.md"), text["body"])
    _write(os.path.join(args.out, "commit.txt"), text["commit"])
    # The pull request to rewrite, if the sweep already has one open. Empty
    # means "create one". Only ever a pull request from this repository.
    own = prs.own_pr(_prs(args.prs), args.branch) if args.branch else None
    _write(os.path.join(args.out, "number.txt"), "%s\n" % own["number"] if own else "")
    print(text["title"])
    print("existing pull request: %s" % ("#%d" % own["number"] if own else "none"))
    return 0


def cmd_pr_close(args):
    decision = json.loads(_read(args.decision))
    own = prs.own_pr(_prs(args.prs), args.branch)
    verdict = prs.close_decision(args.axis, decision, own, args.run_url)
    close = verdict["action"] == "close"
    _write(os.path.join(args.out, "number.txt"), "%s\n" % verdict["number"] if close else "")
    _write(os.path.join(args.out, "comment.md"), verdict["comment"] + "\n" if close else "")
    if verdict["action"] == "none":
        print("nothing to close: %s" % verdict["why"])
    else:
        print("%s pull request #%s: %s" % ("closing" if close else "LEAVING OPEN", verdict["number"], verdict["why"]))
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
    p.add_argument(
        "--max-versions",
        default="",
        help="narrow the gateway axis to the newest N releases at or below the ceiling; empty sweeps them all",
    )
    p.add_argument("--include-head", default="1", choices=("0", "1"))
    p.add_argument("--since", default="")
    p.add_argument("--out", required=True)

    p = add("record-gateway", cmd_record_gateway, "record one gateway-axis leg")
    p.add_argument("--leg", required=True, help="the matrix entry, as JSON")
    p.add_argument("--pull", required=True)
    p.add_argument("--stack", required=True)
    p.add_argument("--bff", required=True)
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
    p.add_argument("--pull", required=True)
    p.add_argument("--stack", required=True)
    p.add_argument("--bff", required=True)
    p.add_argument("--compat", required=True)
    p.add_argument("--out", required=True)

    p = add("report", cmd_report, "classify results and render the report")
    p.add_argument("--plan", required=True)
    p.add_argument("--results", required=True)
    p.add_argument("--run-url", default="")
    p.add_argument("--repo-url", default="", help="https://host/owner/repo, so links work outside rendered files")
    p.add_argument("--dry-run", default="false", choices=("true", "false"), help="this run writes no issue and no PR")
    p.add_argument("--out", required=True)

    p = add("bump-gateway", cmd_bump_gateway, "move the ceiling lane")
    p.add_argument("--decision", required=True)
    p.add_argument("--pins", default=DEFAULT_PINS)

    p = add("bump-sdk", cmd_bump_sdk, "copy in the tested go.mod / go.sum and record the new SDK pin")
    p.add_argument("--decision", required=True)
    p.add_argument("--pins", default=DEFAULT_PINS)
    p.add_argument("--go-mod", default=DEFAULT_GO_MOD)
    p.add_argument("--tested", default="", help="directory holding the go.mod / go.sum the passing legs uploaded")

    p = add("check-diff", cmd_check_diff, "refuse a change that leaves its axis")
    p.add_argument("--axis", required=True, choices=("gateway", "sdk"))
    p.add_argument("--pins", default=DEFAULT_PINS)
    p.add_argument("--go-mod", default=DEFAULT_GO_MOD)
    p.add_argument("--readme", default=guard.README)
    p.add_argument("--changed-out", default="", help="write the list of changed paths here")

    p = add("pr-text", cmd_pr_text, "render a PR's title, body and commit message")
    p.add_argument("--axis", required=True, choices=("gateway", "sdk"))
    p.add_argument("--decision", required=True)
    p.add_argument("--run-url", default="")
    p.add_argument("--repo-url", default="")
    p.add_argument("--has-sweep-token", default="false")
    p.add_argument("--changed", default="", help="the list check-diff wrote")
    p.add_argument("--prs", default="", help="`gh pr list --json ...` output for the axis's branch")
    p.add_argument("--branch", default="", help="the axis's branch; with --prs, finds the PR to rewrite")
    p.add_argument("--out", required=True)

    p = add("pr-close", cmd_pr_close, "decide whether this run may close the axis's open PR")
    p.add_argument("--axis", required=True, choices=("gateway", "sdk"))
    p.add_argument("--decision", required=True)
    p.add_argument("--prs", required=True, help="`gh pr list --json ...` output for the axis's branch")
    p.add_argument("--branch", required=True)
    p.add_argument("--run-url", default="")
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
