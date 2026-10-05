"""The command line the workflows call, end to end on temporary files.

One test walks a whole sweep the way the workflow does: plan, record every
leg, report, apply each bump, guard it, render the PR. The network is the
fake upstream; git is replaced by a function that answers from the same
temporary directory.
"""

import contextlib
import io
import json
import os
import shutil
import tempfile
import unittest

import pins
import sourcecheck
import sweep
from tests import support

PIN = "v0.0.0-20260928030816-6648bd0c290e"
SDK13 = "v0.0.0-20261012090000-a0130000a013"
GO_MOD = "module example\n\ngo 1.25.13\n\nrequire (\n\tgithub.com/NVIDIA/OpenShell/sdk/go %s\n)\n"


def run(*argv):
    """Run the CLI in-process; (exit code, stdout, stderr)."""
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        try:
            code = sweep.main(list(argv))
        except SystemExit as exit_:  # argparse rejected the arguments
            code = exit_.code
    return code, out.getvalue(), err.getvalue()


class Workspace(unittest.TestCase):
    """A scratch repository layout: pins, templates, go.mod, and an outputs file."""

    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="sweep-test-")
        self.addCleanup(shutil.rmtree, self.dir)
        os.makedirs(os.path.join(self.dir, "deploy", "ci"))
        os.makedirs(os.path.join(self.dir, "backend"))
        self.pins = os.path.join(self.dir, "deploy", "ci", "gateway-pins.json")
        self.go_mod = os.path.join(self.dir, "backend", "go.mod")
        self.write_pins(support.fixture("pins.json"))
        self.write_go_mod(PIN)
        for schema in ("v1", "v2"):
            open(os.path.join(self.dir, "deploy", "ci", "gateway.e2e.%s.toml.tmpl" % schema), "w").close()

        self.outputs = os.path.join(self.dir, "github-output")
        self._saved = {key: os.environ.get(key) for key in ("GITHUB_OUTPUT", "GITHUB_ACTIONS")}
        os.environ["GITHUB_OUTPUT"] = self.outputs
        os.environ.pop("GITHUB_ACTIONS", None)
        self.addCleanup(self._restore_env)

    def _restore_env(self):
        for key, value in self._saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def path(self, *parts):
        return os.path.join(self.dir, *parts)

    def write_pins(self, doc):
        with open(self.pins, "w", encoding="utf-8") as fh:
            fh.write(pins.dump(doc))

    def write_go_mod(self, version):
        with open(self.go_mod, "w", encoding="utf-8") as fh:
            fh.write(GO_MOD % version)

    def step_outputs(self):
        with open(self.outputs, encoding="utf-8") as fh:
            return dict(line.rstrip("\n").split("=", 1) for line in fh if "=" in line)

    def read_json(self, *parts):
        with open(self.path(*parts), encoding="utf-8") as fh:
            return json.load(fh)


class ValidatePins(Workspace):
    def test_accepts_a_well_formed_file_and_prints_the_derived_range(self):
        code, out, _ = run("validate-pins", self.pins, "--go-mod", self.go_mod)
        self.assertEqual(code, 0)
        self.assertIn("supported gateway range: 0.1.0 to 0.1.2 (derived from the required lanes)", out)

    def test_every_malformed_fixture_exits_non_zero_with_its_reason(self):
        for name in sorted(os.listdir(os.path.join(support.FIXTURES, "malformed"))):
            case = support.fixture("malformed/" + name)
            self.write_pins(case["pins"])
            code, _, err = run("validate-pins", self.pins)
            with self.subTest(fixture=name):
                self.assertEqual(code, 1)
                for expected in case["expect_problems"]:
                    self.assertIn(expected, err)

    def test_fails_when_the_sdk_field_and_go_mod_disagree(self):
        self.write_go_mod(SDK13)
        code, _, err = run("validate-pins", self.pins, "--go-mod", self.go_mod)
        self.assertEqual(code, 1)
        self.assertIn("backend/go.mod requires " + SDK13, err)

    def test_fails_when_a_lane_names_a_schema_without_a_template(self):
        doc = support.fixture("pins.json")
        doc["lanes"][0]["config_schema"] = "v3"
        self.write_pins(doc)
        code, _, err = run("validate-pins", self.pins)
        self.assertEqual(code, 1)
        self.assertIn("config_schema 'v3' has no template (known: v1, v2)", err)

    def test_problems_become_error_annotations_under_actions(self):
        os.environ["GITHUB_ACTIONS"] = "true"
        self.write_pins(support.fixture("malformed/dev-lane.json")["pins"])
        _, _, err = run("validate-pins", self.pins)
        self.assertTrue(all(line.startswith("::error::") for line in err.strip().splitlines()))

    def test_format_pins_restores_the_canonical_form(self):
        doc = support.fixture("pins.json")
        with open(self.pins, "w", encoding="utf-8") as fh:
            json.dump(doc, fh, indent=8, sort_keys=True)  # a hand edit with other formatting
        code, _, _ = run("format-pins", self.pins)
        self.assertEqual(code, 0)
        with open(self.pins, encoding="utf-8") as fh:
            text = fh.read()
        self.assertEqual(text, pins.dump(pins.load(self.pins)))
        self.assertEqual(pins.load(self.pins), doc)

    def test_range_prints_json_for_other_tools(self):
        code, out, _ = run("range", self.pins)
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out), {"floor": "0.1.0", "ceiling": "0.1.2", "sdk": PIN})


class WholeSweep(Workspace):
    """plan -> record -> report -> bump -> guard -> PR text, as the workflow runs it."""

    def plan(self, scenario_name, **overrides):
        scenario = support.fixture("scenarios/%s.json" % scenario_name)
        fake = support.FakeUpstream(support.upstream_data(scenario.get("upstream")))
        argv = ["plan", "--pins", self.pins, "--go-mod", self.go_mod, "--out", self.path("plan.json")]
        for flag, value in overrides.items():
            argv += ["--" + flag.replace("_", "-"), value]
        args = sweep.build_parser().parse_args(argv)
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(sweep.cmd_plan(args, upstream=fake), 0)
        return scenario

    def record_all(self, legs):
        outputs = self.step_outputs()
        results = self.path("results")
        for leg in json.loads(outputs["gateway_matrix"]):
            observed = dict(support.DEFAULT_LEG, **legs.get(leg["id"], {}))
            code, _, err = run(
                "record-gateway", "--leg", json.dumps(leg), "--stack", observed["stack"],
                "--compat", observed["compat"], "--config-schema", observed["config_schema"], "--out", results,
            )
            self.assertEqual(code, 0, err)
        for leg in json.loads(outputs["sdk_matrix"]):
            observed = dict(support.DEFAULT_LEG, **legs.get(leg["id"], {}))
            log = self.path("source.log")
            with open(log, "w", encoding="utf-8") as fh:
                fh.write(observed.get("source_log", ""))
            code, _, err = run(
                "record-sdk", "--leg", json.dumps(leg), "--source", observed["source"],
                "--source-step", observed.get("source_step", ""), "--source-log", log,
                "--stack", observed["stack"], "--compat", observed["compat"], "--out", results,
            )
            self.assertEqual(code, 0, err)

    def report(self):
        code, _, err = run(
            "report", "--plan", self.path("plan.json"), "--results", self.path("results"),
            "--run-url", "https://example.invalid/run", "--out", self.path("report"),
        )
        self.assertEqual(code, 0, err)
        return self.step_outputs()

    def fake_git(self, before_text, changed):
        def git(*argv):
            if argv[:2] == ("diff", "--name-only"):
                return "\n".join(changed) + "\n"
            if argv[0] == "ls-files":
                return ""
            if argv[0] == "show":
                return before_text
            raise AssertionError("unexpected git call: %r" % (argv,))

        return git

    def test_plan_writes_the_matrices_the_workflow_fans_out_on(self):
        self.plan("newer-release-passes")
        outputs = self.step_outputs()
        self.assertEqual(outputs["gateway_count"], "5")
        self.assertEqual(outputs["sdk_count"], "2")
        gateway = json.loads(outputs["gateway_matrix"])
        self.assertEqual(
            [leg["id"] for leg in gateway],
            ["gateway-0.1.3", "gateway-0.1.2", "gateway-0.1.1", "gateway-0.1.0", "gateway-dev"],
        )
        for leg in gateway:
            self.assertIn("@sha256:", leg["gateway_image"])
            self.assertIn("@sha256:", leg["supervisor_image"])
        for leg in json.loads(outputs["sdk_matrix"]):
            self.assertEqual(leg["sdk_version"], SDK13)
        # Matrix values are single-line JSON: they travel through $GITHUB_OUTPUT.
        self.assertNotIn("\n", outputs["gateway_matrix"])
        self.assertEqual(self.read_json("plan.json")["range"], {"floor": "0.1.0", "ceiling": "0.1.2"})

    def test_plan_refuses_a_malformed_pins_file(self):
        self.write_pins(support.fixture("malformed/no-required-lane.json")["pins"])
        code, _, err = run("plan", "--pins", self.pins, "--go-mod", self.go_mod, "--out", self.path("plan.json"))
        self.assertEqual(code, 1)
        self.assertIn("no lane has required=true", err)
        self.assertFalse(os.path.exists(self.path("plan.json")))

    def test_plan_passes_the_inputs_through(self):
        self.plan("newer-release-passes", max_versions="2", include_head="0", since="")
        plan = self.read_json("plan.json")
        self.assertEqual(plan["inputs"], {"max_versions": 2, "include_head": False, "since": None})
        self.assertEqual([c["version"] for c in plan["gateway"]["candidates"]], ["0.1.3", "0.1.2"])

    def test_gateway_axis_from_plan_to_pull_request(self):
        scenario = self.plan("sdk-source-incompatible")
        self.record_all(scenario["legs"])
        outputs = self.report()
        self.assertEqual((outputs["issue_action"], outputs["gateway_pr"], outputs["sdk_pr"]), ("upsert", "open", "close"))
        self.assertEqual(outputs["incomplete"], "0")
        with open(self.path("report", "issue-body.md"), encoding="utf-8") as fh:
            issue = fh.read()
        self.assertIn("missing method ListAllProviders", issue)
        with open(self.path("report", "issue-title.txt"), encoding="utf-8") as fh:
            self.assertEqual(fh.read(), "Compat sweep: SDK v0.1.3 needs a source migration\n")

        with open(self.pins, encoding="utf-8") as fh:
            before_text = fh.read()
        decision = self.path("report", "decision.json")
        code, out, err = run("bump-gateway", "--decision", decision, "--pins", self.pins)
        self.assertEqual(code, 0, err)
        self.assertIn("ceiling lane moved: 0.1.2 -> 0.1.3", out)

        after = pins.load(self.pins)
        self.assertEqual(pins.supported_range(after), ("0.1.0", "0.1.3"))
        self.assertEqual(after["sdk"], PIN)
        # The diff is the ceiling lane and nothing else: every other line survives.
        with open(self.pins, encoding="utf-8") as fh:
            after_lines = fh.read().splitlines()
        untouched = [line for line in before_text.splitlines() if "0.1.2" not in line]
        for line in untouched:
            self.assertIn(line, after_lines)

        sweep._git, real_git = self.fake_git(before_text, ["deploy/ci/gateway-pins.json"]), sweep._git
        self.addCleanup(setattr, sweep, "_git", real_git)
        code, out, err = run("check-diff", "--axis", "gateway", "--pins", self.pins, "--go-mod", self.go_mod)
        self.assertEqual(code, 0, err)
        # The same pending change is refused as an SDK-axis change.
        code, _, err = run("check-diff", "--axis", "sdk", "--pins", self.pins, "--go-mod", self.go_mod)
        self.assertEqual(code, 1)
        self.assertIn("one-axis guard (sdk)", err)

        code, out, err = run(
            "pr-text", "--axis", "gateway", "--decision", decision, "--run-url", "https://example.invalid/run",
            "--has-sweep-token", "false", "--out", self.path("pr"),
        )
        self.assertEqual(code, 0, err)
        with open(self.path("pr", "title.txt"), encoding="utf-8") as fh:
            self.assertEqual(fh.read(), "ci(compat): move the gateway ceiling to 0.1.3\n")
        with open(self.path("pr", "body.md"), encoding="utf-8") as fh:
            self.assertIn("CI does not start by itself on this PR.", fh.read())
        # This run has no SDK bump, so there is no SDK PR to describe.
        code, _, err = run("pr-text", "--axis", "sdk", "--decision", decision, "--out", self.path("pr"))
        self.assertEqual(code, 1)
        code, _, err = run("bump-sdk", "--decision", decision, "--pins", self.pins, "--go-mod", self.go_mod)
        self.assertEqual(code, 1)
        self.assertIn("no SDK bump", err)

    def test_sdk_axis_from_plan_to_pull_request(self):
        scenario = self.plan("sdk-passes-everywhere")
        self.record_all(scenario["legs"])
        outputs = self.report()
        self.assertEqual((outputs["issue_action"], outputs["gateway_pr"], outputs["sdk_pr"]), ("close", "close", "open"))
        decision = self.path("report", "decision.json")
        with open(self.pins, encoding="utf-8") as fh:
            before_text = fh.read()

        # go.mod still at the old pin: the PR may only carry what was proven.
        code, _, err = run("bump-sdk", "--decision", decision, "--pins", self.pins, "--go-mod", self.go_mod)
        self.assertEqual(code, 1)
        self.assertIn("but the sweep tested " + SDK13, err)

        self.write_go_mod(SDK13)  # what `sweep.py sdk-source-check` does through `go get`
        code, out, err = run("bump-sdk", "--decision", decision, "--pins", self.pins, "--go-mod", self.go_mod)
        self.assertEqual(code, 0, err)
        after = pins.load(self.pins)
        self.assertEqual(after["sdk"], SDK13)
        self.assertEqual(after["lanes"], json.loads(before_text)["lanes"])

        changed = ["backend/go.mod", "backend/go.sum", "deploy/ci/gateway-pins.json"]
        sweep._git, real_git = self.fake_git(before_text, changed), sweep._git
        self.addCleanup(setattr, sweep, "_git", real_git)
        code, _, err = run("check-diff", "--axis", "sdk", "--pins", self.pins, "--go-mod", self.go_mod)
        self.assertEqual(code, 0, err)
        code, _, err = run("check-diff", "--axis", "gateway", "--pins", self.pins, "--go-mod", self.go_mod)
        self.assertEqual(code, 1)

        code, _, err = run("pr-text", "--axis", "sdk", "--decision", decision, "--has-sweep-token", "true", "--out", self.path("pr"))
        self.assertEqual(code, 0, err)
        with open(self.path("pr", "title.txt"), encoding="utf-8") as fh:
            self.assertEqual(fh.read(), "build(sdk): move the OpenShell SDK to v0.1.3\n")
        code, _, err = run("bump-gateway", "--decision", decision, "--pins", self.pins)
        self.assertEqual(code, 1)
        self.assertIn("no gateway bump", err)

    def test_an_untracked_file_is_caught_by_the_guard(self):
        scenario = self.plan("newer-release-passes")
        self.record_all(scenario["legs"])
        self.report()
        with open(self.pins, encoding="utf-8") as fh:
            before_text = fh.read()
        run("bump-gateway", "--decision", self.path("report", "decision.json"), "--pins", self.pins)

        def git(*argv):
            if argv[0] == "ls-files":
                return "bin/server\n"
            if argv[0] == "diff":
                return "deploy/ci/gateway-pins.json\n"
            return before_text

        sweep._git, real_git = git, sweep._git
        self.addCleanup(setattr, sweep, "_git", real_git)
        code, _, err = run("check-diff", "--axis", "gateway", "--pins", self.pins, "--go-mod", self.go_mod)
        self.assertEqual(code, 1)
        self.assertIn("bin/server", err)

    def test_report_with_no_results_is_incomplete_and_touches_nothing(self):
        self.plan("newer-release-passes")
        outputs = self.report()  # no record step ran; the results directory does not exist
        self.assertEqual(outputs["incomplete"], "1")
        self.assertEqual((outputs["issue_action"], outputs["gateway_pr"], outputs["sdk_pr"]), ("keep", "skip", "skip"))


class RecordSteps(Workspace):
    LEG = json.dumps({"id": "gateway-0.1.3", "version": "0.1.3"})
    SDK_LEG = json.dumps({"id": "sdk-release-0.1.0", "lane": "0.1.0"})

    def test_gateway_result_keeps_the_schema_the_gateway_accepted(self):
        code, _, _ = run("record-gateway", "--leg", self.LEG, "--stack", "success", "--compat", "success",
                         "--config-schema", "v2", "--out", self.path("r"))
        self.assertEqual(code, 0)
        self.assertEqual(
            self.read_json("r", "gateway-0.1.3.json"),
            {"id": "gateway-0.1.3", "axis": "gateway", "outcome": "compatible", "config_schema": "v2"},
        )

    def test_a_gateway_that_did_not_start_needs_no_schema(self):
        code, _, _ = run("record-gateway", "--leg", self.LEG, "--stack", "failure", "--compat", "skipped", "--out", self.path("r"))
        self.assertEqual(code, 0)
        self.assertEqual(self.read_json("r", "gateway-0.1.3.json")["outcome"], "stack_failed")

    def test_a_stack_that_came_up_without_reporting_its_schema_is_an_error(self):
        # Otherwise a later PR would have to guess the lane's config schema.
        code, _, err = run("record-gateway", "--leg", self.LEG, "--stack", "success", "--compat", "success", "--out", self.path("r"))
        self.assertEqual(code, 1)
        self.assertIn("did not report which config schema", err)

    def test_sdk_source_failure_carries_the_step_and_the_log(self):
        log = self.path("source.log")
        with open(log, "w", encoding="utf-8") as fh:
            fh.write("$ go build ./...\nundefined: openshell.Foo\n")
        code, _, _ = run("record-sdk", "--leg", self.SDK_LEG, "--source", "failure", "--source-step", "build",
                         "--source-log", log, "--stack", "skipped", "--compat", "skipped", "--out", self.path("r"))
        self.assertEqual(code, 0)
        self.assertEqual(
            self.read_json("r", "sdk-release-0.1.0.json"),
            {
                "id": "sdk-release-0.1.0",
                "axis": "sdk",
                "outcome": "source_incompatible",
                "source_step": "build",
                "source_log": "$ go build ./...\nundefined: openshell.Foo",
            },
        )

    def test_sdk_pass_records_no_log(self):
        code, _, _ = run("record-sdk", "--leg", self.SDK_LEG, "--source", "success", "--stack", "success",
                         "--compat", "success", "--out", self.path("r"))
        self.assertEqual(code, 0)
        self.assertEqual(self.read_json("r", "sdk-release-0.1.0.json"), {"id": "sdk-release-0.1.0", "axis": "sdk", "outcome": "compatible"})


class SourceCheckCommand(Workspace):
    def test_writes_the_log_and_the_failing_step(self):
        def fake_check(sdk_version, backend_dir, echo=None):
            return {"ok": False, "step": "build", "log": "$ go build ./...\nboom"}

        sourcecheck.check, real = fake_check, sourcecheck.check
        self.addCleanup(setattr, sourcecheck, "check", real)
        code, out, _ = run("sdk-source-check", "--sdk-version", SDK13, "--backend", self.path("backend"), "--log", self.path("source.log"))
        self.assertEqual(code, 1)
        self.assertEqual(self.step_outputs()["step"], "build")
        with open(self.path("source.log"), encoding="utf-8") as fh:
            self.assertEqual(fh.read(), "$ go build ./...\nboom")
        self.assertIn("source link FAILED at `build` for SDK " + SDK13, out)


if __name__ == "__main__":
    unittest.main()
