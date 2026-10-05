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
import subprocess
import tempfile
import unittest

import outcomes
import pins
import report
import sourcecheck
import sweep
from tests import support

PIN = "v0.0.0-20260928030816-6648bd0c290e"
SDK13 = "v0.0.0-20261012090000-a0130000a013"
GO_MOD = "module example\n\ngo 1.25.13\n\nrequire (\n\tgithub.com/NVIDIA/OpenShell/sdk/go %s\n)\n"
GO_SUM = "github.com/NVIDIA/OpenShell/sdk/go %s h1:abc=\n"

# What scripts/readme-gateway-range.mjs maintains: its markers, its rows.
README = (
    "# Dashboard\n\nProse.\n\n"
    "<!-- gateway-range:begin (generated from deploy/ci/gateway-pins.json by "
    "scripts/readme-gateway-range.mjs; do not edit) -->\n"
    "| | |\n|---|---|\n| Newest tested gateway | `%s` |\n| OpenShell Go SDK | `%s` |\n"
    "<!-- gateway-range:end -->\n\nMore prose.\n"
)


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

    def test_a_well_formed_file_that_is_not_canonical_is_refused(self):
        # The automated PRs rewrite the whole file. A file CI let through in
        # another layout would come back with every line changed.
        directory = os.path.join(support.FIXTURES, "noncanonical")
        for name in sorted(os.listdir(directory)):
            shutil.copy(os.path.join(directory, name), self.pins)
            code, _, err = run("validate-pins", self.pins)
            with self.subTest(fixture=name):
                self.assertEqual(code, 1)
                self.assertIn("is well formed but not in canonical form", err)
                self.assertIn("format-pins", err)
                # ...and the command it names fixes it.
                self.assertEqual(run("format-pins", self.pins)[0], 0)
                self.assertEqual(run("validate-pins", self.pins)[0], 0)

    def test_a_malformed_file_is_reported_for_what_is_wrong_not_for_its_layout(self):
        with open(self.pins, "w", encoding="utf-8") as fh:
            json.dump(support.fixture("malformed/dev-lane.json")["pins"], fh, indent=4)
        _, _, err = run("validate-pins", self.pins)
        self.assertIn("a dev lane is not allowed", err)
        self.assertNotIn("canonical", err)

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
        """Run the record step of every leg, the way the workflow does."""
        outputs = self.step_outputs()
        results = self.path("results")
        for leg in json.loads(outputs["gateway_matrix"]):
            if leg["id"] in legs and legs[leg["id"]] is None:
                continue  # this leg never got as far as recording anything
            observed = support.observed(legs.get(leg["id"]))
            code, _, err = run(
                "record-gateway", "--leg", json.dumps(leg), "--pull", observed["pull"], "--stack", observed["stack"],
                "--bff", observed["bff"], "--compat", observed["compat"],
                "--config-schema", observed["config_schema"], "--out", results,
            )
            self.assertEqual(code, 0, err)
        for leg in json.loads(outputs["sdk_matrix"]):
            if leg["id"] in legs and legs[leg["id"]] is None:
                continue
            observed = support.observed(legs.get(leg["id"]))
            log = self.path("source.log")
            with open(log, "w", encoding="utf-8") as fh:
                fh.write(observed.get("source_log", ""))
            step = observed.get("source_step", "" if observed["source"] == "success" else "build")
            code, _, err = run(
                "record-sdk", "--leg", json.dumps(leg), "--source", observed["source"],
                "--source-step", step, "--source-log", log, "--pull", observed["pull"],
                "--stack", observed["stack"], "--bff", observed["bff"], "--compat", observed["compat"],
                "--out", results,
            )
            # A source check that names no step is refused: the leg then
            # uploads nothing and the report reads it as "no result".
            named = observed["source"] == "success" or step in outcomes.SOURCE_STEPS
            self.assertEqual(code, 0 if named else 1, err)

    def report(self):
        code, _, err = run(
            "report", "--plan", self.path("plan.json"), "--results", self.path("results"),
            "--run-url", "https://example.invalid/run", "--out", self.path("report"),
        )
        self.assertEqual(code, 0, err)
        return self.step_outputs()

    def fake_git(self, before_text, changed, at_head=None):
        """git as check-diff sees it: what changed, and files as they are at HEAD."""
        at_head = dict({self.pins: before_text}, **(at_head or {}))

        def git(*argv):
            if argv[:2] == ("diff", "--name-only"):
                return "\n".join(changed) + "\n"
            if argv[0] == "ls-files":
                return ""
            if argv[0] == "show":
                path = argv[1].split(":", 1)[1]
                if path not in at_head:
                    raise subprocess.CalledProcessError(128, "git show")
                return at_head[path]
            raise AssertionError("unexpected git call: %r" % (argv,))

        return git

    def use_git(self, git):
        sweep._git, real_git = git, sweep._git
        self.addCleanup(setattr, sweep, "_git", real_git)

    def decide(self, scenario_name, **overrides):
        """plan -> record -> report for a scenario; returns the decision's path."""
        scenario = self.plan(scenario_name, **overrides)
        self.record_all(scenario["legs"])
        self.report()
        return self.path("report", "decision.json")

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
        # 0.1.3 is above the ceiling and is never capped; the cap is the two below it.
        self.assertEqual([c["version"] for c in plan["gateway"]["candidates"]], ["0.1.3", "0.1.2", "0.1.1"])

    def test_an_empty_max_versions_sweeps_the_whole_range(self):
        # What a scheduled run passes: `--max-versions ""`.
        self.plan("newer-release-passes", max_versions="")
        plan = self.read_json("plan.json")
        self.assertIsNone(plan["inputs"]["max_versions"])
        self.assertEqual(plan["gateway"]["not_swept"], [])

    def test_a_max_versions_that_would_sweep_nothing_is_refused(self):
        for bad, message in (("0", "at least 1"), ("-3", "at least 1"), ("five", "not a whole number")):
            code, _, err = run(
                "plan", "--pins", self.pins, "--go-mod", self.go_mod, "--max-versions", bad, "--out", self.path("plan.json")
            )
            with self.subTest(max_versions=bad):
                self.assertEqual(code, 1)
                self.assertIn(message, err)
                self.assertFalse(os.path.exists(self.path("plan.json")))

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

        self.use_git(self.fake_git(before_text, ["deploy/ci/gateway-pins.json"]))
        code, out, err = run(
            "check-diff", "--axis", "gateway", "--pins", self.pins, "--go-mod", self.go_mod,
            "--changed-out", self.path("changed.txt"),
        )
        self.assertEqual(code, 0, err)
        with open(self.path("changed.txt"), encoding="utf-8") as fh:
            self.assertEqual(fh.read(), "deploy/ci/gateway-pins.json\n")
        # The same pending change is refused as an SDK-axis change.
        code, _, err = run("check-diff", "--axis", "sdk", "--pins", self.pins, "--go-mod", self.go_mod)
        self.assertEqual(code, 1)
        self.assertIn("one-axis guard (sdk)", err)

        code, out, err = run(
            "pr-text", "--axis", "gateway", "--decision", decision, "--run-url", "https://example.invalid/run",
            "--repo-url", "https://example.invalid/o/r", "--changed", self.path("changed.txt"),
            "--has-sweep-token", "false", "--out", self.path("pr"),
        )
        self.assertEqual(code, 0, err)
        with open(self.path("pr", "title.txt"), encoding="utf-8") as fh:
            self.assertEqual(fh.read(), "fix(compat): support gateway 0.1.3\n")
        with open(self.path("pr", "body.md"), encoding="utf-8") as fh:
            body = fh.read()
        self.assertIn("CI does not start by itself on this PR.", body)
        self.assertIn("(https://example.invalid/o/r/blob/main/docs/adrs/0006-compat-links-and-sweep-axes.md)", body)
        self.assertNotIn("README", body)
        # No pull request list was given, so there is none to rewrite.
        with open(self.path("pr", "number.txt"), encoding="utf-8") as fh:
            self.assertEqual(fh.read(), "")
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

        # The bump job runs no `go`. It is handed the go.mod and go.sum that
        # each passing SDK leg uploaded, one directory per leg.
        self.uploaded_by_legs({"sweep-sdk-gomod-sdk-release-0.1.0": SDK13, "sweep-sdk-gomod-sdk-release-0.1.2": SDK13})
        code, out, err = run(
            "bump-sdk", "--decision", decision, "--pins", self.pins, "--go-mod", self.go_mod, "--tested", self.path("tested")
        )
        self.assertEqual(code, 0, err)
        self.assertIn("copied the go.mod and go.sum that 2 passing leg(s) tested", out)
        after = pins.load(self.pins)
        self.assertEqual(after["sdk"], SDK13)
        self.assertEqual(after["lanes"], json.loads(before_text)["lanes"])
        with open(self.go_mod, encoding="utf-8") as fh:
            self.assertEqual(fh.read(), GO_MOD % SDK13)
        with open(self.path("backend", "go.sum"), encoding="utf-8") as fh:
            self.assertEqual(fh.read(), GO_SUM % SDK13)

        changed = ["backend/go.mod", "backend/go.sum", "deploy/ci/gateway-pins.json"]
        self.use_git(self.fake_git(before_text, changed, {"backend/go.mod": GO_MOD % PIN}))
        code, _, err = run("check-diff", "--axis", "sdk", "--pins", self.pins, "--go-mod", self.go_mod)
        self.assertEqual(code, 0, err)
        code, _, err = run("check-diff", "--axis", "gateway", "--pins", self.pins, "--go-mod", self.go_mod)
        self.assertEqual(code, 1)

        code, _, err = run("pr-text", "--axis", "sdk", "--decision", decision, "--has-sweep-token", "true", "--out", self.path("pr"))
        self.assertEqual(code, 0, err)
        with open(self.path("pr", "title.txt"), encoding="utf-8") as fh:
            self.assertEqual(fh.read(), "fix(sdk): move to the OpenShell SDK at v0.1.3\n")
        code, _, err = run("bump-gateway", "--decision", decision, "--pins", self.pins)
        self.assertEqual(code, 1)
        self.assertIn("no gateway bump", err)

    def uploaded_by_legs(self, legs):
        """Lay out what download-artifact leaves: one directory per passing leg."""
        for name, version in legs.items():
            os.makedirs(self.path("tested", name))
            with open(self.path("tested", name, "go.mod"), "w", encoding="utf-8") as fh:
                fh.write(GO_MOD % version)
            with open(self.path("tested", name, "go.sum"), "w", encoding="utf-8") as fh:
                fh.write(GO_SUM % version)

    def test_the_sdk_bump_refuses_files_no_leg_proved(self):
        decision = self.decide("sdk-passes-everywhere")
        with open(self.pins, encoding="utf-8") as fh:
            before_pins = fh.read()

        def bump():
            return run(
                "bump-sdk", "--decision", decision, "--pins", self.pins, "--go-mod", self.go_mod, "--tested", self.path("tested")
            )

        def untouched():
            with open(self.go_mod, encoding="utf-8") as fh:
                self.assertEqual(fh.read(), GO_MOD % PIN)
            with open(self.pins, encoding="utf-8") as fh:
                self.assertEqual(fh.read(), before_pins)

        # Nothing was uploaded.
        os.makedirs(self.path("tested"))
        code, _, err = bump()
        self.assertEqual(code, 1)
        self.assertIn("no tested go.mod and go.sum", err)
        untouched()

        # The legs did not test one tree.
        self.uploaded_by_legs({"leg-a": SDK13, "leg-b": SDK13})
        with open(self.path("tested", "leg-b", "go.sum"), "a", encoding="utf-8") as fh:
            fh.write("example.invalid/other v1.0.0 h1:xyz=\n")
        code, _, err = bump()
        self.assertEqual(code, 1)
        self.assertIn("The legs did not test one tree, so nothing is committed.", err)
        untouched()

        # The files are for another SDK than the one the report decided on.
        shutil.rmtree(self.path("tested"))
        self.uploaded_by_legs({"leg-a": "v0.0.0-20261019090000-a0140000a014"})
        code, _, err = bump()
        self.assertEqual(code, 1)
        self.assertIn("the uploaded go.mod requires SDK v0.0.0-20261019090000-a0140000a014 but the sweep decided on " + SDK13, err)
        untouched()

    def test_the_guard_refuses_a_tested_go_mod_that_swaps_a_module(self):
        decision = self.decide("sdk-passes-everywhere")
        with open(self.pins, encoding="utf-8") as fh:
            before_text = fh.read()
        self.uploaded_by_legs({"leg-a": SDK13})
        with open(self.path("tested", "leg-a", "go.mod"), "a", encoding="utf-8") as fh:
            fh.write("\nreplace golang.org/x/net => example.invalid/net v0.0.1\n")
        code, _, err = run(
            "bump-sdk", "--decision", decision, "--pins", self.pins, "--go-mod", self.go_mod, "--tested", self.path("tested")
        )
        self.assertEqual(code, 0, err)  # the version is right, so it is copied in...
        changed = ["backend/go.mod", "backend/go.sum", "deploy/ci/gateway-pins.json"]
        self.use_git(self.fake_git(before_text, changed, {"backend/go.mod": GO_MOD % PIN}))
        code, _, err = run("check-diff", "--axis", "sdk", "--pins", self.pins, "--go-mod", self.go_mod)
        self.assertEqual(code, 1)  # ...and refused before anything is committed.
        self.assertIn("gained or lost a replace/exclude directive", err)

    def readme_case(self, axis, readme_after, extra_changed=()):
        """Apply the axis's bump, change README.md, run the guard; (exit code, stderr)."""
        scenario = "newer-release-passes"
        decision = self.decide(scenario)
        with open(self.pins, encoding="utf-8") as fh:
            before_text = fh.read()
        if axis == "gateway":
            self.assertEqual(run("bump-gateway", "--decision", decision, "--pins", self.pins)[0], 0)
            changed = ["deploy/ci/gateway-pins.json"]
        else:
            self.uploaded_by_legs({"leg": SDK13})
            code, _, err = run(
                "bump-sdk", "--decision", decision, "--pins", self.pins, "--go-mod", self.go_mod, "--tested", self.path("tested")
            )
            self.assertEqual(code, 0, err)
            changed = ["backend/go.mod", "backend/go.sum", "deploy/ci/gateway-pins.json"]
        readme = self.path("README.md")
        with open(readme, "w", encoding="utf-8") as fh:
            fh.write(readme_after)
        at_head = {"README.md": README % ("0.1.2", PIN), "backend/go.mod": GO_MOD % PIN}
        self.use_git(self.fake_git(before_text, changed + ["README.md"] + list(extra_changed), at_head))
        code, _, err = run(
            "check-diff", "--axis", axis, "--pins", self.pins, "--go-mod", self.go_mod, "--readme", readme,
            "--changed-out", self.path("changed.txt"),
        )
        return code, err, decision

    def test_a_readme_change_confined_to_the_generated_block_is_accepted(self):
        for axis, regenerated in (("gateway", README % ("0.1.3", PIN)), ("sdk", README % ("0.1.2", SDK13))):
            with self.subTest(axis=axis):
                code, err, decision = self.readme_case(axis, regenerated)
                self.assertEqual(code, 0, err)
                # ...and the PR text then says so instead of claiming fewer files.
                code, _, err = run(
                    "pr-text", "--axis", axis, "--decision", decision, "--changed", self.path("changed.txt"), "--out", self.path("pr")
                )
                self.assertEqual(code, 0, err)
                with open(self.path("pr", "body.md"), encoding="utf-8") as fh:
                    self.assertIn("and the generated range block of `README.md`", fh.read())
            shutil.rmtree(self.path("results"))
            shutil.rmtree(self.path("tested"), ignore_errors=True)
            self.write_pins(support.fixture("pins.json"))
            self.write_go_mod(PIN)

    def test_any_other_readme_change_is_refused(self):
        for axis, regenerated in (("gateway", README % ("0.1.3", PIN)), ("sdk", README % ("0.1.2", SDK13))):
            with self.subTest(axis=axis):
                code, err, _ = self.readme_case(axis, regenerated.replace("More prose.", "More prose, edited."))
                self.assertEqual(code, 1)
                self.assertIn("README.md changed outside its generated gateway-range block", err)
                self.assertFalse(os.path.exists(self.path("changed.txt")))
            shutil.rmtree(self.path("results"))
            shutil.rmtree(self.path("tested"), ignore_errors=True)
            self.write_pins(support.fixture("pins.json"))
            self.write_go_mod(PIN)

    def test_a_readme_that_has_no_block_at_head_may_not_change(self):
        # This branch today: README.md has no markers yet.
        decision = self.decide("newer-release-passes")
        with open(self.pins, encoding="utf-8") as fh:
            before_text = fh.read()
        run("bump-gateway", "--decision", decision, "--pins", self.pins)
        readme = self.path("README.md")
        with open(readme, "w", encoding="utf-8") as fh:
            fh.write(README % ("0.1.3", PIN))
        git = self.fake_git(before_text, ["deploy/ci/gateway-pins.json", "README.md"], {"README.md": "# Dashboard\n"})
        self.use_git(git)
        code, _, err = run("check-diff", "--axis", "gateway", "--pins", self.pins, "--go-mod", self.go_mod, "--readme", readme)
        self.assertEqual(code, 1)
        self.assertIn("has no generated gateway-range block", err)

    def test_pr_text_finds_the_sweeps_own_open_pull_request(self):
        decision = self.decide("newer-release-passes")
        listed = [
            {"number": 97, "title": "mine", "headRefName": "compat-sweep/gateway", "isCrossRepository": True},
            {"number": 90, "title": report.GATEWAY_TITLE % "0.1.3", "headRefName": "compat-sweep/gateway", "isCrossRepository": False},
        ]
        with open(self.path("prs.json"), "w", encoding="utf-8") as fh:
            json.dump(listed, fh)
        code, out, err = run(
            "pr-text", "--axis", "gateway", "--decision", decision, "--prs", self.path("prs.json"),
            "--branch", "compat-sweep/gateway", "--out", self.path("pr"),
        )
        self.assertEqual(code, 0, err)
        with open(self.path("pr", "number.txt"), encoding="utf-8") as fh:
            self.assertEqual(fh.read(), "90\n")
        # Only a fork's pull request on that branch name: there is none of ours to rewrite.
        with open(self.path("prs.json"), "w", encoding="utf-8") as fh:
            json.dump(listed[:1], fh)
        run(
            "pr-text", "--axis", "gateway", "--decision", decision, "--prs", self.path("prs.json"),
            "--branch", "compat-sweep/gateway", "--out", self.path("pr"),
        )
        with open(self.path("pr", "number.txt"), encoding="utf-8") as fh:
            self.assertEqual(fh.read(), "")

    def close(self, scenario, listed, axis="sdk"):
        decision = self.decide(scenario)
        with open(self.path("prs.json"), "w", encoding="utf-8") as fh:
            json.dump(listed, fh)
        code, out, err = run(
            "pr-close", "--axis", axis, "--decision", decision, "--prs", self.path("prs.json"),
            "--branch", "compat-sweep/" + axis, "--run-url", "https://example.invalid/run", "--out", self.path("close"),
        )
        self.assertEqual(code, 0, err)
        with open(self.path("close", "number.txt"), encoding="utf-8") as fh:
            number = fh.read()
        with open(self.path("close", "comment.md"), encoding="utf-8") as fh:
            return number, fh.read(), out

    def test_pr_close_leaves_a_pr_this_run_did_not_retest(self):
        listed = [{"number": 91, "title": report.SDK_TITLE % "v0.1.3", "headRefName": "compat-sweep/sdk", "isCrossRepository": False}]
        number, comment, out = self.close("newer-sdk-fails-older-pr-open", listed)
        self.assertEqual((number, comment), ("", ""))
        self.assertIn("LEAVING OPEN pull request #91", out)
        self.assertIn("v0.1.3 was not retested", out)
        # The run's summary line said "SDK PR: close", so the summary gets the correction.
        with open(self.path("close", "note.md"), encoding="utf-8") as fh:
            note = fh.read()
        self.assertTrue(note.startswith("**sdk axis:** pull request #91 was LEFT OPEN: it proposes the SDK at v0.1.3;"))

    def test_pr_close_closes_the_pr_it_retested_and_says_what_is_true(self):
        listed = [{"number": 92, "title": report.SDK_TITLE % "v0.1.4", "headRefName": "compat-sweep/sdk", "isCrossRepository": False}]
        number, comment, out = self.close("newer-sdk-fails-older-pr-open", listed)
        self.assertEqual(number, "92\n")
        self.assertIn("retested the SDK at v0.1.4 and no longer proposes this change", comment)
        self.assertIn("https://example.invalid/run", comment)
        with open(self.path("close", "note.md"), encoding="utf-8") as fh:
            self.assertEqual(fh.read(), "")

    def test_pr_close_never_touches_a_fork_pr_with_the_same_branch_name(self):
        listed = [{"number": 97, "title": report.SDK_TITLE % "v0.1.4", "headRefName": "compat-sweep/sdk", "isCrossRepository": True}]
        number, comment, out = self.close("newer-sdk-fails-older-pr-open", listed)
        self.assertEqual((number, comment), ("", ""))
        self.assertIn("nothing to close", out)
        with open(self.path("close", "note.md"), encoding="utf-8") as fh:
            self.assertEqual(fh.read(), "")

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

    def test_report_is_told_about_the_repository_and_about_dry_runs(self):
        scenario = self.plan("newer-release-fails")
        self.record_all(scenario["legs"])
        code, out, err = run(
            "report", "--plan", self.path("plan.json"), "--results", self.path("results"),
            "--run-url", "https://example.invalid/o/r/actions/runs/7", "--repo-url", "https://example.invalid/o/r",
            "--dry-run", "true", "--out", self.path("report"),
        )
        self.assertEqual(code, 0, err)
        link = "(https://example.invalid/o/r/blob/main/docs/adrs/0006-compat-links-and-sweep-axes.md)"
        with open(self.path("report", "summary.md"), encoding="utf-8") as fh:
            summary = fh.read()
        self.assertIn("**Dry run.** This run is not on `main`, so it writes nothing", summary)
        self.assertIn(link, summary)
        with open(self.path("report", "issue-body.md"), encoding="utf-8") as fh:
            issue = fh.read()
        self.assertIn(link, issue)
        self.assertNotIn("](docs/", issue)
        self.assertNotIn("Dry run", issue)

    def test_report_with_no_results_is_incomplete_and_touches_nothing(self):
        self.plan("newer-release-passes")
        outputs = self.report()  # no record step ran; the results directory does not exist
        self.assertEqual(outputs["incomplete"], "1")
        self.assertEqual((outputs["issue_action"], outputs["gateway_pr"], outputs["sdk_pr"]), ("keep", "skip", "skip"))


class RecordSteps(Workspace):
    LEG = json.dumps({"id": "gateway-0.1.3", "version": "0.1.3"})
    SDK_LEG = json.dumps({"id": "sdk-release-0.1.0", "lane": "0.1.0"})
    # The steps before the compat suite, as they report when the stack is up...
    UP = ("--pull", "success", "--stack", "success", "--bff", "success")
    # ...and everything after a source check that failed.
    SKIPPED = ("--pull", "skipped", "--stack", "skipped", "--bff", "skipped", "--compat", "skipped")

    def test_gateway_result_keeps_the_schema_the_gateway_accepted(self):
        code, _, _ = run("record-gateway", "--leg", self.LEG, *self.UP, "--compat", "success",
                         "--config-schema", "v2", "--out", self.path("r"))
        self.assertEqual(code, 0)
        self.assertEqual(
            self.read_json("r", "gateway-0.1.3.json"),
            {"id": "gateway-0.1.3", "axis": "gateway", "outcome": "compatible", "config_schema": "v2"},
        )

    def test_a_gateway_that_did_not_start_needs_no_schema(self):
        code, _, _ = run("record-gateway", "--leg", self.LEG, "--pull", "success", "--stack", "failure",
                         "--bff", "skipped", "--compat", "skipped", "--out", self.path("r"))
        self.assertEqual(code, 0)
        self.assertEqual(self.read_json("r", "gateway-0.1.3.json")["outcome"], "stack_failed")

    def test_an_image_that_cannot_be_pulled_is_a_result_of_its_own(self):
        code, _, _ = run("record-gateway", "--leg", self.LEG, "--pull", "failure", "--stack", "skipped",
                         "--bff", "skipped", "--compat", "skipped", "--out", self.path("r"))
        self.assertEqual(code, 0)
        self.assertEqual(self.read_json("r", "gateway-0.1.3.json")["outcome"], "pull_failed")

    def test_a_bff_that_does_not_start_is_a_result_of_its_own(self):
        code, _, _ = run("record-gateway", "--leg", self.LEG, "--pull", "success", "--stack", "success",
                         "--bff", "failure", "--compat", "skipped", "--config-schema", "v2", "--out", self.path("r"))
        self.assertEqual(code, 0)
        self.assertEqual(self.read_json("r", "gateway-0.1.3.json")["outcome"], "bff_failed")

    def test_every_step_outcome_has_to_be_passed(self):
        # A step left out must not be read as one that succeeded.
        code, _, _ = run("record-gateway", "--leg", self.LEG, "--stack", "success", "--compat", "success",
                         "--config-schema", "v2", "--out", self.path("r"))
        self.assertEqual(code, 2)

    def test_a_stack_that_came_up_without_reporting_its_schema_is_an_error(self):
        # Otherwise a later PR would have to guess the lane's config schema.
        code, _, err = run("record-gateway", "--leg", self.LEG, *self.UP, "--compat", "success", "--out", self.path("r"))
        self.assertEqual(code, 1)
        self.assertIn("did not report which config schema", err)

    def test_sdk_source_failure_carries_the_step_and_the_log(self):
        log = self.path("source.log")
        with open(log, "w", encoding="utf-8") as fh:
            fh.write("$ go build ./...\nundefined: openshell.Foo\n")
        code, _, _ = run("record-sdk", "--leg", self.SDK_LEG, "--source", "failure", "--source-step", "build",
                         "--source-log", log, *self.SKIPPED, "--out", self.path("r"))
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
        code, _, _ = run("record-sdk", "--leg", self.SDK_LEG, "--source", "success", *self.UP,
                         "--compat", "success", "--out", self.path("r"))
        self.assertEqual(code, 0)
        self.assertEqual(self.read_json("r", "sdk-release-0.1.0.json"), {"id": "sdk-release-0.1.0", "axis": "sdk", "outcome": "compatible"})

    def test_a_fetch_failure_is_recorded_as_unresolved_with_its_output(self):
        log = self.path("source.log")
        with open(log, "w", encoding="utf-8") as fh:
            fh.write("$ go get x\ndial tcp: i/o timeout\n")
        code, _, _ = run("record-sdk", "--leg", self.SDK_LEG, "--source", "failure", "--source-step", "get",
                         "--source-log", log, *self.SKIPPED, "--out", self.path("r"))
        self.assertEqual(code, 0)
        result = self.read_json("r", "sdk-release-0.1.0.json")
        self.assertEqual((result["outcome"], result["source_step"]), ("sdk_unresolved", "get"))
        self.assertIn("i/o timeout", result["source_log"])

    def test_a_source_check_that_names_no_step_records_nothing(self):
        # It crashed. Recording "build" here would report a compile failure
        # that nobody saw; recording nothing makes the report say "no result".
        for step in ("", "banana"):
            code, _, err = run("record-sdk", "--leg", self.SDK_LEG, "--source", "failure", "--source-step", step,
                               "--source-log", self.path("missing.log"), *self.SKIPPED, "--out", self.path("r"))
            with self.subTest(step=step):
                self.assertEqual(code, 1)
                self.assertIn("did not say which step failed", err)
                self.assertFalse(os.path.exists(self.path("r", "sdk-release-0.1.0.json")))


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
