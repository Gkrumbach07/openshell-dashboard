"""follow.py as the workflows call it: arguments in, files and step outputs out."""

import contextlib
import io
import json
import os
import shutil
import tempfile
import unittest
from unittest import mock

import follow
import pinmove
import pins
import plan as plan_module
import upstream
from tests import support

REAL_PINS = os.path.join(support.REPO_ROOT, "deploy", "ci", "gateway-pins.json")
REAL_GO_MOD = os.path.join(support.REPO_ROOT, "backend", "go.mod")


class Cli(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="upstream-cli-")
        self.addCleanup(shutil.rmtree, self.dir, ignore_errors=True)
        self.outputs = os.path.join(self.dir, "github-output")

    def path(self, *parts):
        return os.path.join(self.dir, *parts)

    def write(self, name, value):
        path = self.path(name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(value if isinstance(value, str) else json.dumps(value))
        return path

    def read(self, *parts):
        with open(self.path(*parts), encoding="utf-8") as fh:
            return fh.read()

    def run_cli(self, *argv):
        """(exit code, stdout, stderr, step outputs) for one invocation."""
        out, err = io.StringIO(), io.StringIO()
        if os.path.exists(self.outputs):
            os.remove(self.outputs)
        with mock.patch.dict(os.environ, {"GITHUB_OUTPUT": self.outputs}):
            # Annotations are for a runner; a plain "error:" is what a person reads.
            os.environ.pop("GITHUB_ACTIONS", None)
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                code = follow.main(list(argv))
        outputs = {}
        if os.path.exists(self.outputs):
            with open(self.outputs, encoding="utf-8") as fh:
                outputs = dict(text.rstrip("\n").split("=", 1) for text in fh if "=" in text)
        return code, out.getvalue(), err.getvalue(), outputs

    def pins_file(self, doc, name="deploy/ci/gateway-pins.json", canonical=True):
        text = pins.dump(doc) if canonical else json.dumps(doc, indent=4) + "\n"
        path = self.write(name, text)
        # A template for the schema, beside the pins as in deploy/ci.
        self.write(os.path.join(os.path.dirname(name), "gateway.e2e.v2.toml.tmpl"), "version = 2\n")
        return path


class ValidatePins(Cli):
    def test_the_checked_in_file_passes_with_its_go_mod(self):
        code, out, err, _ = self.run_cli("validate-pins", REAL_PINS, "--go-mod", REAL_GO_MOD)
        self.assertEqual((code, err), (0, ""))
        self.assertIn("is well formed", out)
        self.assertIn("pinned OpenShell release: ", out)

    def test_a_malformed_file_fails_with_every_problem(self):
        doc = dict(support.pins_doc(), release="dev", lanes=[], sdk="latest")
        code, _, err, _ = self.run_cli("validate-pins", self.pins_file(doc))
        self.assertEqual(code, 1)
        self.assertIn("dev build, which is never pinned", err)
        self.assertIn("top-level key 'lanes' is not allowed", err)
        self.assertIn("sdk must be an exact module version", err)

    def test_a_pin_that_disagrees_with_go_mod_fails(self):
        go_mod = self.write("go.mod", "require %s v0.0.0-20260101000000-000000000000\n" % pins.SDK_MODULE)
        code, _, err, _ = self.run_cli("validate-pins", self.pins_file(support.pins_doc()), "--go-mod", go_mod)
        self.assertEqual(code, 1)
        self.assertIn("one pin recorded twice", err)

    def test_a_go_mod_without_the_sdk_fails(self):
        go_mod = self.write("go.mod", "module example.com/x\n")
        code, _, err, _ = self.run_cli("validate-pins", self.pins_file(support.pins_doc()), "--go-mod", go_mod)
        self.assertEqual(code, 1)
        self.assertIn("does not require %s" % pins.SDK_MODULE, err)

    def test_a_well_formed_file_in_another_layout_fails_and_format_pins_fixes_it(self):
        path = self.pins_file(support.pins_doc(), canonical=False)
        code, _, err, _ = self.run_cli("validate-pins", path)
        self.assertEqual(code, 1)
        self.assertIn("not in canonical form", err)
        self.assertIn("follow.py format-pins", err)
        self.assertEqual(self.run_cli("format-pins", path)[0], 0)
        self.assertEqual(self.run_cli("validate-pins", path)[0], 0)

    def test_a_schema_without_a_template_fails(self):
        code, _, err, _ = self.run_cli("validate-pins", self.pins_file(dict(support.pins_doc(), config_schema="v7")))
        self.assertEqual(code, 1)
        self.assertIn("config_schema 'v7' has no template", err)

    def test_under_github_actions_a_problem_is_an_annotation(self):
        path = self.pins_file(dict(support.pins_doc(), release="dev"))
        err = io.StringIO()
        with mock.patch.dict(os.environ, {"GITHUB_ACTIONS": "true"}), contextlib.redirect_stderr(err), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(follow.main(["validate-pins", path]), 1)
        self.assertTrue(err.getvalue().startswith("::error::"))


class RequireStable(Cli):
    def test_a_stable_release_passes(self):
        code, out, _, _ = self.run_cli("require-stable", self.pins_file(support.pins_doc("0.1.3")))
        self.assertEqual(code, 0)
        self.assertIn("pins OpenShell 0.1.3, a stable release", out)

    def test_a_pre_release_fails_and_does_not_read_as_a_compatibility_failure(self):
        to = support.target("0.1.4-pre.2")
        doc = pins.move(support.pins_doc(), to["version"], to["gateway_image"], to["supervisor_image"], support.sdk_version(to["commit"]))
        code, _, err, _ = self.run_cli("require-stable", self.pins_file(doc))
        self.assertEqual(code, 1)
        self.assertIn("pins OpenShell 0.1.4-pre.2, a pre-release", err)
        self.assertIn("It says nothing about compatibility", err)

    def test_the_checked_in_file_is_judged_by_what_it_pins(self):
        # On main and release/** this passes. On next it fails, which is the point.
        stable = "-pre." not in pins.load(REAL_PINS)["release"]
        self.assertEqual(self.run_cli("require-stable", REAL_PINS)[0], 0 if stable else 1)


class Plan(Cli):
    def plan(self, doc=None, **data):
        pins_path = self.pins_file(doc or support.pins_of_2026_10_09())
        go_mod = self.write("backend/go.mod", "require %s %s\n" % (pins.SDK_MODULE, (doc or support.pins_of_2026_10_09())["sdk"]))
        fake = support.FakeUpstream(support.upstream_data(**data))
        out, err = io.StringIO(), io.StringIO()
        args = follow.build_parser().parse_args(
            ["plan", "--pins", pins_path, "--go-mod", go_mod, "--out", self.path("plan.json"), "--summary", self.path("plan.md"), "--dry-run", "true"]
        )
        with mock.patch.dict(os.environ, {"GITHUB_OUTPUT": self.outputs}), contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = follow.cmd_plan(args, upstream=fake)
        with open(self.outputs, encoding="utf-8") as fh:
            outputs = dict(text.rstrip("\n").split("=", 1) for text in fh)
        return code, outputs, json.loads(self.read("plan.json"))

    def test_upstream_today_gives_the_jobs_what_they_need(self):
        code, outputs, made = self.plan()
        self.assertEqual(code, 0)
        self.assertEqual(
            {key: outputs[key] for key in ("pinned", "has_target", "ready", "target", "same_line", "config_schema")},
            {"pinned": "0.1.3", "has_target": "true", "ready": "true", "target": "0.1.4-pre.2", "same_line": "true", "config_schema": "v2"},
        )
        self.assertEqual(outputs["gateway_image"], made["target"]["gateway_image"])
        self.assertEqual(outputs["supervisor_image"], made["target"]["supervisor_image"])
        self.assertEqual(outputs["sandbox_image"], support.SANDBOX)
        self.assertIn("Target: OpenShell `0.1.4-pre.2`", self.read("plan.md"))
        self.assertIn("dry run", self.read("plan.md"))

    def test_nothing_ahead_is_a_success_with_nothing_to_test(self):
        code, outputs, made = self.plan(drop=("v0.1.4-pre.1", "v0.1.4-pre.2"))
        self.assertEqual(code, 0)
        self.assertEqual((outputs["has_target"], outputs["ready"], outputs["target"], outputs["gateway_image"]), ("false", "false", "", ""))
        self.assertIsNone(made["target"])

    def test_a_target_without_images_is_a_target_that_is_not_ready(self):
        _, outputs, _ = self.plan(tags=["v0.1.4"])
        self.assertEqual((outputs["has_target"], outputs["ready"], outputs["target"]), ("true", "false", "0.1.4"))

    def test_a_new_line_is_not_the_same_line(self):
        images = {"gateway:0.2.0": support.digest("g"), "supervisor:0.2.0": support.digest("s")}
        _, outputs, _ = self.plan(tags=["v0.2.0"], images=images)
        self.assertEqual((outputs["target"], outputs["same_line"]), ("0.2.0", "false"))

    def test_an_outage_fails_the_command(self):
        pins_path = self.pins_file(support.pins_of_2026_10_09())
        go_mod = self.write("backend/go.mod", "require %s %s\n" % (pins.SDK_MODULE, support.pins_of_2026_10_09()["sdk"]))

        class Down(object):
            def release_tags(self):
                raise upstream.UpstreamError("git ls-remote failed: could not resolve host")

        with mock.patch.object(follow.upstream_module, "Upstream", lambda: Down()):
            code, _, err, _ = self.run_cli("plan", "--pins", pins_path, "--go-mod", go_mod, "--out", self.path("plan.json"))
        self.assertEqual(code, 1)
        self.assertIn("could not resolve host", err)
        self.assertFalse(os.path.exists(self.path("plan.json")))


class Next(Cli):
    """`next` and `publish` in a dry run, against a throwaway repository."""

    def setUp(self):
        Cli.setUp(self)
        self.repo = support.Repo("0.1.3")
        self.addCleanup(self.repo.close)
        self.tools = support.FakeTools()

    def plan_file(self, target, pinned="0.1.3"):
        made = {
            "pinned": {"release": pinned, "line": "0.1", "stable": True, "sdk": support.pins_doc(pinned)["sdk"], "sdk_on_tag": True},
            "config_schema": "v2",
            "sandbox_image": support.SANDBOX,
            "newest_stable": pinned,
            "target": target and dict(target, same_line=True, skipped=[], release_branch=None),
        }
        return self.write("plan.json", made)

    def next(self, target, *more):
        args = follow.build_parser().parse_args(
            ["next", "--plan", self.plan_file(target), "--repo", self.repo.path, "--tools", "/tools",
             "--main-ref", "refs/remotes/origin/main", "--out", self.path("next"),
             "--repo-url", "https://github.com/o/r"] + list(more)
        )
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = follow.cmd_next(args, run=self.tools)
        return code, out.getvalue(), json.loads(self.read("next", "outcome.json")), json.loads(self.read("next", "publish.json"))

    def test_the_first_run_would_create_next_and_open_a_draft(self):
        code, out, outcome, decided = self.next(support.target("0.1.4-pre.2"), "--dry-run", "true")
        self.assertEqual(code, 0)
        self.assertEqual(outcome["action"], "create")
        self.assertEqual(decided["push"]["expected"], "")
        self.assertEqual(decided["pr"]["title"], "fix: move to OpenShell 0.1.4-pre.2")
        self.assertTrue(decided["pr"]["draft"])
        self.assertIn("`next` would be created from `main`", out)
        self.assertIn("A draft pull request `next` -> `main` would be opened", out)
        self.assertEqual(out.strip().splitlines()[-1][:2], "- ", "the summary is the last thing printed")
        self.assertIsNone(self.repo.origin_next(), "preparing pushes nothing")

    def test_publish_in_a_dry_run_prints_the_commands_and_runs_none(self):
        self.next(support.target("0.1.4-pre.2"), "--dry-run", "true")
        with mock.patch.object(follow.publish_module, "run_command", side_effect=AssertionError("ran something")):
            code, out, err, _ = self.run_cli(
                "publish", "--plan", self.path("next", "publish.json"), "--dry-run", "true", "--summary", self.path("published.md")
            )
        self.assertEqual((code, err), (0, ""))
        self.assertIn("would run: git push --force-with-lease=refs/heads/next: origin ", out)
        self.assertIn("would run: gh pr create --head next --base main --title fix: move to OpenShell 0.1.4-pre.2", out)
        self.assertEqual(self.read("published.md"), "")
        self.assertIsNone(self.repo.origin_next())

    def test_the_pull_request_listings_and_the_flags_reach_the_decision(self):
        first = self.next(support.target("0.1.4-pre.1"))[2]
        self.repo.publish(first["sha"])
        merged = self.write("merged.json", [])
        opened = self.write(
            "open.json",
            [{"number": 9, "title": "old", "body": "", "isDraft": False, "headRefName": "next", "headRefOid": first["sha"],
              "baseRefName": "main", "isCrossRepository": False, "comments": []}],
        )
        _, _, outcome, decided = self.next(
            support.target("0.1.4-pre.2"), "--open-prs", opened, "--merged-prs", merged, "--has-bot-token", "true", "--automerge", "true"
        )
        self.assertEqual(outcome["action"], "update")
        self.assertEqual(decided["push"]["expected"], first["sha"])
        self.assertEqual((decided["pr"]["number"], decided["pr"]["set_title"], decided["pr"]["set_draft"]), (9, True, "draft"))
        self.assertNotIn("does not start by itself", decided["pr"]["body"])
        self.assertFalse(decided["automerge"], "a pre-release is never set to merge")

    def test_a_merged_pull_request_at_the_commit_next_is_on_makes_it_spent(self):
        first = self.next(support.target("0.1.4"))[2]
        self.repo.publish(first["sha"])
        merged = self.write(
            "merged.json",
            [{"number": 9, "headRefName": "next", "headRefOid": first["sha"], "baseRefName": "main", "isCrossRepository": False}],
        )
        _, out, outcome, decided = self.next(None, "--merged-prs", merged)
        self.assertEqual(outcome["action"], "delete")
        self.assertEqual(decided["delete"]["expected"], first["sha"])
        self.assertIn("its pull request was merged", out)

    def test_a_target_whose_images_are_not_published_waits_and_touches_nothing(self):
        waiting = dict(support.target("0.1.4"), ready=False, waiting_for="upstream has tagged v0.1.4 but has not published its gateway image yet", gateway_image=None, supervisor_image=None)
        _, out, outcome, decided = self.next(waiting)
        self.assertEqual(outcome["action"], "none")
        self.assertEqual(self.tools.calls, [])
        self.assertEqual([decided[key] for key in ("push", "pr", "comment", "delete")], [None] * 4)
        self.assertIn("has not published its gateway image yet", out)

    def test_a_failing_tool_fails_the_command_and_leaves_no_decision_to_publish(self):
        plan_path = self.plan_file(support.target("0.1.4-pre.2"))
        with mock.patch.object(follow.pinmove, "run_command", support.FakeTools(fail=("go", "get"))):
            code, _, err, _ = self.run_cli(
                "next", "--plan", plan_path, "--repo", self.repo.path, "--main-ref", "refs/remotes/origin/main", "--out", self.path("next")
            )
        self.assertEqual(code, 1)
        self.assertIn("go get", err)
        self.assertFalse(os.path.exists(self.path("next", "publish.json")))


class PublishFailure(Cli):
    def test_a_refused_step_fails_the_command_and_says_so_in_the_summary(self):
        decided = {"action": "update", "release_branch": None, "push": {"sha": "c" * 40, "expected": "b" * 40, "created": False},
                   "pr": None, "comment": None, "automerge": False, "delete": None}
        plan_path = self.write("publish.json", decided)
        with mock.patch.object(follow.publish_module, "run_command", lambda command, env=None: (1, "", "remote: Permission denied")):
            code, _, err, _ = self.run_cli("publish", "--plan", plan_path, "--summary", self.path("published.md"))
        self.assertEqual(code, 1)
        self.assertIn("could not push next", err)
        self.assertIn("**Publishing failed.**", self.read("published.md"))


class CheckA(Cli):
    def record(self, pull, stack, bff, compat):
        code, _, _, _ = self.run_cli("record-check", "--pull", pull, "--stack", stack, "--bff", bff, "--compat", compat, "--out", self.path("check-a.json"))
        self.assertEqual(code, 0)
        return json.loads(self.read("check-a.json"))["outcome"]

    def report(self, made, result="check-a.json", dry_run="false"):
        plan_path = self.write("plan.json", made)
        return self.run_cli(
            "check-report", "--plan", plan_path, "--result", self.path(result), "--run-url", "https://github.com/o/r/actions/runs/7",
            "--repo-url", "https://github.com/o/r", "--dry-run", dry_run, "--out", self.path("report"),
        )

    def today(self):
        return plan_module.build(support.pins_of_2026_10_09(), support.FakeUpstream(support.upstream_data()))

    def test_step_outcomes_become_one_result(self):
        self.assertEqual(self.record("success", "success", "success", "success"), "passed")
        self.assertEqual(self.record("success", "success", "success", "failure"), "failed")
        self.assertEqual(self.record("success", "failure", "skipped", "skipped"), "stack_failed")

    def test_a_failure_renders_the_issue_and_is_not_incomplete(self):
        self.record("success", "success", "success", "failure")
        code, _, _, outputs = self.report(self.today())
        self.assertEqual(code, 0)
        self.assertEqual(outputs, {"issue_action": "upsert", "incomplete": "0"})
        self.assertEqual(self.read("report", "issue-title.txt"), "OpenShell 0.1.4-pre.2: main fails the compatibility suite\n")
        self.assertIn("https://github.com/o/r/actions/runs/7", self.read("report", "issue-body.md"))
        self.assertIn("FAILS", self.read("report", "summary.md"))

    def test_a_pass_closes_with_a_comment_that_says_why(self):
        self.record("success", "success", "success", "success")
        _, _, _, outputs = self.report(self.today())
        self.assertEqual(outputs, {"issue_action": "close", "incomplete": "0"})
        comment = self.read("report", "close-comment.md")
        self.assertTrue(comment.startswith("`main` passes the compatibility suite against OpenShell `0.1.4-pre.2`"))
        self.assertIn("https://github.com/o/r/actions/runs/7", comment)
        self.assertEqual(self.read("report", "issue-body.md"), "")

    def test_a_job_that_never_reported_keeps_the_issue_and_marks_the_run(self):
        _, _, _, outputs = self.report(self.today(), result="missing.json")
        self.assertEqual(outputs, {"issue_action": "keep", "incomplete": "1"})

    def test_a_gateway_that_did_not_start_is_not_a_finding(self):
        self.record("success", "failure", "skipped", "skipped")
        _, out, _, outputs = self.report(self.today())
        self.assertEqual(outputs, {"issue_action": "keep", "incomplete": "1"})
        self.assertIn("the gateway never became healthy", out)

    def test_nothing_ahead_closes_and_needs_no_result(self):
        made = plan_module.build(
            support.pins_of_2026_10_09(), support.FakeUpstream(support.upstream_data(drop=("v0.1.4-pre.1", "v0.1.4-pre.2")))
        )
        _, _, _, outputs = self.report(made, result="missing.json")
        self.assertEqual(outputs, {"issue_action": "close", "incomplete": "0"})


class Errors(Cli):
    def test_every_expected_failure_is_exit_1_with_a_message_not_a_traceback(self):
        for error in (
            pins.PinsError(["a pins problem"]),
            plan_module.PlanError("a plan problem"),
            upstream.UpstreamError("an upstream problem"),
            pinmove.PinMoveError("a move problem"),
            follow.nextbranch.GitError("a git problem"),
            follow.publish_module.PublishError("a publish problem"),
            follow.versions.VersionError("a version problem"),
        ):
            # Raised from inside a command, whichever one: format-pins loads first.
            with mock.patch.object(follow.pins, "load", side_effect=error):
                code, _, err, _ = self.run_cli("format-pins", self.path("pins.json"))
            self.assertEqual(code, 1, error)
            self.assertEqual(err, "error: %s\n" % error)

    def test_a_command_is_required(self):
        with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
            follow.main([])


if __name__ == "__main__":
    unittest.main()
