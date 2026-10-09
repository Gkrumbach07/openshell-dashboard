#!/usr/bin/env python3
"""Command line for following upstream OpenShell releases (ADR 0009, decisions 6 to 8).

.github/workflows/follow-upstream.yml and the compat-pins job in ci.yml call
this file and nothing else in this directory. The workflows keep the parts
only a runner can do (checkout, toolchains, containers); every decision is
made here, where it can be unit-tested:

    validate-pins    fail fast on a malformed deploy/ci/gateway-pins.json
    format-pins      rewrite the pins file in canonical form
    require-stable   fail when the pins name a pre-release (main, release/**)
    plan             which upstream release is ahead of this branch, if any
    next             build what `next` should be, and decide what to publish
    publish          push it and keep its pull request (git push and gh only)
    record-check     turn check A's step outcomes into a result
    check-report     what check A's result means; render its issue

Standard library only: a runner needs nothing installed to use it.
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import nextbranch  # noqa: E402
import pinmove  # noqa: E402
import pins  # noqa: E402
import plan as plan_module  # noqa: E402
import publish as publish_module  # noqa: E402
import report  # noqa: E402
import upstream as upstream_module  # noqa: E402
import versions  # noqa: E402

DEFAULT_PINS = "deploy/ci/gateway-pins.json"
DEFAULT_GO_MOD = "backend/go.mod"
SELF = "python3 deploy/ci/upstream/follow.py"


def _read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def _write(path, text):
    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)


def _json(path, default=None):
    if not path or not os.path.exists(path):
        return default
    return json.loads(_read(path))


def _set_outputs(values):
    """Append step outputs when running under GitHub Actions; print them always."""
    lines = ["%s=%s" % (key, value) for key, value in values.items()]
    target = os.environ.get("GITHUB_OUTPUT")
    if target:
        with open(target, "a", encoding="utf-8") as fh:
            fh.write("\n".join(lines) + "\n")
    for text in lines:
        print(text)


def _fail(problems):
    for problem in problems:
        if os.environ.get("GITHUB_ACTIONS"):
            # One annotation per problem; a newline would end it early.
            print("::error::" + problem.replace("\n", "%0A"), file=sys.stderr)
        else:
            print("error: " + problem, file=sys.stderr)
    return 1


def _load_valid_pins(path, go_mod=None):
    """Load the pins file or raise with every problem it has."""
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
                "newline differ from what a pin move writes). The next move would rewrite lines it "
                "did not mean to change. Run `%s format-pins %s` and commit the result."
                % (args.pins, SELF, args.pins)
            ]
        )
    print("%s is well formed" % args.pins)
    print(
        "pinned OpenShell release: %s (%s, gateway release line %s)"
        % (doc["release"], "stable" if versions.is_stable(doc["release"]) else "a pre-release", versions.line(doc["release"]))
    )
    print("sdk pin: %s" % doc["sdk"])
    return 0


def cmd_format_pins(args):
    """Rewrite the pins file the way a pin move writes it.

    After a hand edit this keeps the next move's diff down to the lines it
    means to change. validate-pins requires it.
    """
    doc = pins.load(args.pins)
    _write(args.pins, pins.dump(doc))
    print("%s rewritten in canonical form" % args.pins)
    return 0


def cmd_require_stable(args):
    doc = _load_valid_pins(args.pins)
    problems = pins.require_stable(doc)
    if problems:
        return _fail(problems)
    print("%s pins OpenShell %s, a stable release" % (args.pins, doc["release"]))
    return 0


def cmd_plan(args, upstream=None):
    doc = _load_valid_pins(args.pins, args.go_mod)
    made = plan_module.build(doc, upstream or upstream_module.Upstream())
    _write(args.out, json.dumps(made, indent=2) + "\n")
    summary = report.plan_summary(made, dry_run=args.dry_run == "true")
    if args.summary:
        _write(args.summary, summary)
    print(summary)
    target = made["target"] or {}
    _set_outputs(
        {
            "pinned": made["pinned"]["release"],
            "has_target": "true" if made["target"] else "false",
            # Something to test and to pin: a target whose images are published.
            "ready": "true" if target.get("ready") else "false",
            "target": target.get("version", ""),
            "same_line": "true" if target.get("same_line") else "false",
            "gateway_image": target.get("gateway_image") or "",
            "supervisor_image": target.get("supervisor_image") or "",
            "sandbox_image": made["sandbox_image"],
            "config_schema": made["config_schema"],
        }
    )
    return 0


def _echo(text):
    print(text)
    sys.stdout.flush()


def cmd_next(args, run=None):
    run = run or pinmove.run_command
    made = _json(args.plan)
    target = made.get("target")
    dry_run = args.dry_run == "true"
    repo = os.path.abspath(args.repo)
    tools = os.path.abspath(args.tools)
    git = nextbranch.Git(repo)
    existing = git.maybe("rev-parse", "--verify", "-q", "%s^{commit}" % args.next_ref)

    if target and not target["ready"]:
        # Tagged, but its images are not out yet. Nothing can be pinned, and a
        # rebase for its own sake can wait an hour with it.
        outcome = {
            "action": "none",
            "reason": target["waiting_for"],
            "main": git.out("rev-parse", "--verify", "%s^{commit}" % args.main_ref),
            "next": existing,
            "sha": None,
            "people": [],
            "pins": None,
        }
    else:
        outcome = nextbranch.prepare(
            repo,
            target,
            mover=lambda tree, to: pinmove.apply(tree, to, tools=tools, run=run, echo=_echo),
            message=lambda to, moved: report.commit_message(to, made["pinned"]),
            lockfiles=nextbranch.lockfile_regenerators(run=run, echo=_echo),
            main_ref=args.main_ref,
            next_ref=args.next_ref,
            spent=publish_module.is_spent(_json(args.merged_prs, []), existing),
        )

    release_branch_sha = None
    if target and target.get("release_branch"):
        release_branch_sha = git.maybe(
            "rev-parse", "--verify", "-q", "refs/remotes/origin/%s^{commit}" % target["release_branch"]
        )
    decided = publish_module.build(
        made,
        outcome,
        open_pulls=_json(args.open_prs, []),
        has_bot_token=args.has_bot_token == "true",
        automerge=args.automerge == "true",
        repo_url=args.repo_url,
        release_branch_sha=release_branch_sha,
    )
    _write(os.path.join(args.out, "outcome.json"), json.dumps(outcome, indent=2) + "\n")
    _write(os.path.join(args.out, "publish.json"), json.dumps(decided, indent=2) + "\n")
    summary = report.next_summary(outcome, decided, dry_run=dry_run)
    _write(os.path.join(args.out, "summary.md"), summary)
    print(summary)
    return 0


def cmd_publish(args):
    decided = _json(args.plan)
    dry_run = args.dry_run == "true"
    try:
        notes = publish_module.execute(decided, echo=_echo, dry_run=dry_run)
    except publish_module.PublishError as err:
        if args.summary:
            _write(args.summary, "- **Publishing failed.** %s\n" % str(err).splitlines()[0])
        return _fail([str(err)])
    text = "".join("- %s\n" % note for note in notes)
    if args.summary:
        _write(args.summary, text)
    if text:
        print(text)
    return 0


def cmd_record_check(args):
    result = {"outcome": report.check_outcome(args.pull, args.stack, args.bff, args.compat)}
    _write(args.out, json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
    return 0


def cmd_check_report(args):
    made = _json(args.plan)
    result = _json(args.result)
    dry_run = args.dry_run == "true"
    decision = report.check_decision(made, result)
    title, body = "", ""
    if decision["issue"] == "upsert":
        title, body = report.issue_text(made, args.run_url, args.repo_url)
    _write(os.path.join(args.out, "issue-title.txt"), title + "\n")
    _write(os.path.join(args.out, "issue-body.md"), body)
    _write(
        os.path.join(args.out, "close-comment.md"),
        "%s%s. Closing; a later run that fails opens a fresh issue.\n"
        % (decision["why"][:1].upper() + decision["why"][1:], " (%s)" % args.run_url if args.run_url else ""),
    )
    summary = report.check_summary(made, decision, dry_run=dry_run)
    _write(os.path.join(args.out, "summary.md"), summary)
    print(summary)
    _set_outputs({"issue_action": decision["issue"], "incomplete": "1" if decision["incomplete"] else "0"})
    return 0


def build_parser():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command")
    sub.required = True
    flag = ("true", "false")

    def add(name, func, help_text):
        p = sub.add_parser(name, help=help_text)
        p.set_defaults(func=func)
        return p

    p = add("validate-pins", cmd_validate_pins, "fail on a malformed pins file")
    p.add_argument("pins", nargs="?", default=DEFAULT_PINS)
    p.add_argument("--go-mod", default=None, help="also require the sdk field to match this go.mod")

    p = add("format-pins", cmd_format_pins, "rewrite the pins file in canonical form")
    p.add_argument("pins", nargs="?", default=DEFAULT_PINS)

    p = add("require-stable", cmd_require_stable, "fail when the pins name a pre-release")
    p.add_argument("pins", nargs="?", default=DEFAULT_PINS)

    p = add("plan", cmd_plan, "find the upstream release ahead of this branch")
    p.add_argument("--pins", default=DEFAULT_PINS)
    p.add_argument("--go-mod", default=DEFAULT_GO_MOD)
    p.add_argument("--dry-run", default="false", choices=flag)
    p.add_argument("--summary", default="", help="also write the summary here")
    p.add_argument("--out", required=True)

    p = add("next", cmd_next, "build what next should be and decide what to publish")
    p.add_argument("--plan", required=True)
    p.add_argument("--repo", default=".", help="the clone to work in; it needs --main-ref and, if it exists, --next-ref")
    p.add_argument("--tools", default=".", help="the checkout whose scripts are run: the one the workflow runs from")
    p.add_argument("--main-ref", default="HEAD")
    p.add_argument("--next-ref", default=nextbranch.NEXT_REF)
    p.add_argument("--open-prs", default="", help="`gh pr list --head next --state open --json ...` output")
    p.add_argument("--merged-prs", default="", help="`gh pr list --head next --state merged --json ...` output")
    p.add_argument("--has-bot-token", default="false", choices=flag)
    p.add_argument("--automerge", default="false", choices=flag)
    p.add_argument("--repo-url", default="", help="https://host/owner/repo, so links work in a pull request")
    p.add_argument("--dry-run", default="false", choices=flag)
    p.add_argument("--out", required=True)

    p = add("publish", cmd_publish, "push next and keep its pull request")
    p.add_argument("--plan", required=True, help="the publish.json that `next` wrote")
    p.add_argument("--dry-run", default="false", choices=flag)
    p.add_argument("--summary", default="", help="write notes for the run summary here")

    p = add("record-check", cmd_record_check, "record check A's result")
    p.add_argument("--pull", required=True)
    p.add_argument("--stack", required=True)
    p.add_argument("--bff", required=True)
    p.add_argument("--compat", required=True)
    p.add_argument("--out", required=True)

    p = add("check-report", cmd_check_report, "decide what check A's result means and render its issue")
    p.add_argument("--plan", required=True)
    p.add_argument("--result", default="", help="what record-check wrote; missing means the job did not report")
    p.add_argument("--run-url", default="")
    p.add_argument("--repo-url", default="")
    p.add_argument("--dry-run", default="false", choices=flag)
    p.add_argument("--out", required=True)
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except pins.PinsError as err:
        return _fail(err.problems)
    except (
        plan_module.PlanError,
        upstream_module.UpstreamError,
        versions.VersionError,
        pinmove.PinMoveError,
        nextbranch.GitError,
        publish_module.PublishError,
    ) as err:
        return _fail([str(err)])


if __name__ == "__main__":
    sys.exit(main())
