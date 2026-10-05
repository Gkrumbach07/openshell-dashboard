"""Invariants of the workflow files themselves.

The sweep's rules are stated in comments at the top of compat-sweep.yml. A
comment cannot fail a build, so the ones that can be read off the YAML are
checked here: every PR runs this file from ci.yml's compat-pins job.

There is no YAML parser in the standard library, so this reads the files by
indentation. That is enough for the handful of facts it needs, and it only
looks at files this directory owns: all of compat-sweep.yml, and the
compat-pins and compat jobs of ci.yml.
"""

import os
import re
import unittest

from tests import support

WORKFLOWS = os.path.join(support.REPO_ROOT, ".github", "workflows")


def read(*parts):
    with open(os.path.join(support.REPO_ROOT, *parts), encoding="utf-8") as fh:
        return fh.read()


def jobs(text):
    """{job id: its lines} for a workflow file."""
    lines = text.splitlines()
    out, current = {}, None
    for line in lines[lines.index("jobs:") + 1 :]:
        m = re.match(r"^  ([A-Za-z0-9_-]+):\s*$", line)
        if m:
            current = m.group(1)
            out[current] = []
        elif current is not None:
            out[current].append(line)
    return out


def indent(line):
    return len(line) - len(line.lstrip())


def run_scripts(lines):
    """The shell text of every `run:` among some lines."""
    scripts, i = [], 0
    while i < len(lines):
        m = re.match(r"^(\s*)(- )?run:\s*(.*)$", lines[i])
        i += 1
        if not m:
            continue
        key_column = len(m.group(1)) + (2 if m.group(2) else 0)
        if m.group(3)[:1] in ("|", ">"):
            body = []
            while i < len(lines) and (not lines[i].strip() or indent(lines[i]) > key_column):
                body.append(lines[i])
                i += 1
            scripts.append("\n".join(body))
        else:
            scripts.append(m.group(3))
    return scripts


def permissions(lines):
    """A job's permissions block as a dict; None when it declares none."""
    for i, line in enumerate(lines):
        m = re.match(r"^    permissions:\s*(.*)$", line)
        if not m:
            continue
        if m.group(1).strip() == "{}":
            return {}
        found = {}
        for entry in lines[i + 1 :]:
            if indent(entry) != 6:
                break
            key, _, value = entry.strip().partition(":")
            found[key] = value.split("#")[0].strip()
        return found
    return None


SWEEP = read(".github", "workflows", "compat-sweep.yml")
CI = read(".github", "workflows", "ci.yml")
STACK = read("deploy", "ci", "e2e-stack.sh")
SWEEP_JOBS = jobs(SWEEP)
CI_JOBS = {name: lines for name, lines in jobs(CI).items() if name in ("compat-pins", "compat")}


class ScannerSanity(unittest.TestCase):
    """If the scanner found nothing, every test below would pass for no reason."""

    def test_finds_the_jobs(self):
        self.assertEqual(sorted(SWEEP_JOBS), ["bff", "bump", "gateway", "plan", "report", "sdk", "verdict"])
        self.assertEqual(sorted(CI_JOBS), ["compat", "compat-pins"])

    def test_finds_the_scripts(self):
        self.assertGreaterEqual(sum(len(run_scripts(lines)) for lines in SWEEP_JOBS.values()), 20)
        self.assertGreaterEqual(sum(len(run_scripts(lines)) for lines in CI_JOBS.values()), 7)

    def test_reads_block_and_inline_scripts(self):
        lines = [
            "      - run: echo one",
            "      - name: x",
            "        run: |",
            "          echo two",
            "",
            "          echo three",
            "      - uses: y",
        ]
        self.assertEqual(run_scripts(lines), ["echo one", "          echo two\n\n          echo three"])


class NoExpressionInsideAScript(unittest.TestCase):
    """Values reach scripts through env:, never by text substitution.

    `${{ }}` is expanded before the shell sees the script, so a value that
    contains a quote or a `$(...)` becomes code. An env var cannot.
    """

    def test_compat_sweep(self):
        for name, lines in SWEEP_JOBS.items():
            for script in run_scripts(lines):
                with self.subTest(job=name):
                    self.assertNotIn("${{", script)

    def test_ci_compat_jobs(self):
        for name, lines in CI_JOBS.items():
            for script in run_scripts(lines):
                with self.subTest(job=name):
                    self.assertNotIn("${{", script)


class EveryCompatRunIsUncached(unittest.TestCase):
    """-count=1: Go's test cache cannot see the gateway behind the BFF.

    Without it a pass against one gateway is replayed as "ok (cached)" for the
    next one, without a single request being sent.
    """

    def compat_runs(self, text):
        return [line for line in text.splitlines() if "go test" in line and "-tags compat" in line and not line.lstrip().startswith("#")]

    def test_every_invocation_passes_count_1(self):
        expected = {"compat-sweep.yml": (SWEEP, 2), "ci.yml": (CI, 1), "e2e-stack.sh": (STACK, 1)}
        for name, (text, at_least) in expected.items():
            runs = self.compat_runs(text)
            with self.subTest(file=name):
                self.assertGreaterEqual(len(runs), at_least, "the compat suite is no longer run from here")
                for line in runs:
                    self.assertIn("-count=1", line)


class LeastPrivilege(unittest.TestCase):
    def test_the_sweep_grants_nothing_by_default(self):
        self.assertIn("\npermissions: {}\n", SWEEP)

    def test_each_sweep_job_holds_exactly_what_it_uses(self):
        # Changing this table is the point at which a reviewer should ask why.
        expected = {
            "plan": {"contents": "read"},
            "bff": {"contents": "read"},
            "gateway": {"contents": "read"},
            "sdk": {"contents": "read"},
            "report": {"contents": "read", "issues": "write"},
            "bump": {"contents": "write", "pull-requests": "write"},
            "verdict": {},
        }
        self.assertEqual({name: permissions(lines) for name, lines in SWEEP_JOBS.items()}, expected)

    def test_the_legs_that_run_upstream_code_cannot_write_anything(self):
        # gateway and sdk legs run third-party images and a third-party SDK.
        for name in ("gateway", "sdk", "bff", "plan"):
            self.assertNotIn("write", permissions(SWEEP_JOBS[name]).values())
            self.assertNotIn("secrets.", "\n".join(SWEEP_JOBS[name]))

    def test_ci_compat_jobs_are_read_only(self):
        for name, lines in CI_JOBS.items():
            self.assertEqual(permissions(lines), {"contents": "read"}, name)


class TwoAxes(unittest.TestCase):
    def test_the_gateway_axis_cannot_modify_go_mod(self):
        for name in ("bff", "gateway"):
            text = "\n".join(SWEEP_JOBS[name])
            self.assertIn("GOFLAGS: -mod=readonly", text)
            for script in run_scripts(SWEEP_JOBS[name]):
                self.assertNotIn("go get", script)
                self.assertNotIn("go mod tidy", script)
                self.assertNotIn("sdk-source-check", script)
        self.assertIn("git diff --exit-code -- backend/go.mod backend/go.sum", "\n".join(SWEEP_JOBS["bff"]))

    def test_gateway_legs_run_the_one_binary_built_from_the_checked_in_go_mod(self):
        text = "\n".join(SWEEP_JOBS["gateway"])
        self.assertIn("name: sweep-bff", text)
        self.assertNotIn("go build", "\n".join(run_scripts(SWEEP_JOBS["gateway"])))

    def test_the_sdk_axis_takes_its_gateways_from_the_pinned_lanes(self):
        text = "\n".join(SWEEP_JOBS["sdk"])
        self.assertIn("OPENSHELL_GATEWAY_IMAGE: ${{ matrix.gateway_image }}", text)
        self.assertIn("OPENSHELL_CONFIG_SCHEMA: ${{ matrix.config_schema }}", text)
        self.assertNotIn("OPENSHELL_CONFIG_SCHEMA: auto", text)

    def test_images_are_never_named_in_a_script(self):
        # They arrive as tag@digest from the plan; a literal tag would be a moving one.
        for name, lines in SWEEP_JOBS.items():
            for script in run_scripts(lines):
                with self.subTest(job=name):
                    self.assertIsNone(re.search(r"openshell/(gateway|supervisor)[:@]", script))
                    self.assertNotIn("@latest", script)

    def test_the_guard_runs_before_anything_is_committed(self):
        script = "\n".join(run_scripts(SWEEP_JOBS["bump"]))
        self.assertLess(script.index("check-diff --axis"), script.index("git commit"))
        self.assertLess(script.index("check-diff --axis"), script.index("git push"))

    def test_one_fixed_branch_per_axis(self):
        text = "\n".join(SWEEP_JOBS["bump"])
        self.assertIn("branch: compat-sweep/gateway", text)
        self.assertIn("branch: compat-sweep/sdk", text)


class SideEffects(unittest.TestCase):
    def test_issue_and_prs_only_from_main(self):
        self.assertIn("if: always() && needs.report.result == 'success' && github.ref == 'refs/heads/main'", "\n".join(SWEEP_JOBS["bump"]))
        report = SWEEP_JOBS["report"]
        step = report.index("      - name: Maintain the issue")
        self.assertIn("github.ref == 'refs/heads/main'", report[step + 1])

    def test_the_sweep_token_is_optional(self):
        text = "\n".join(SWEEP_JOBS["bump"])
        self.assertEqual(text.count("secrets.SWEEP_TOKEN || github.token"), 2)

    def test_only_the_pr_job_is_handed_a_secret(self):
        for name, lines in SWEEP_JOBS.items():
            if name != "bump":
                self.assertNotIn("secrets.", "\n".join(lines), name)

    def test_nothing_is_merged_automatically(self):
        for script in run_scripts(SWEEP_JOBS["bump"]):
            self.assertNotIn("pr merge", script)
            self.assertNotIn("--auto", script)


class PinsJob(unittest.TestCase):
    def test_validates_the_pins_file_against_go_mod(self):
        scripts = run_scripts(CI_JOBS["compat-pins"])
        self.assertIn("python3 deploy/ci/sweep/sweep.py validate-pins deploy/ci/gateway-pins.json --go-mod backend/go.mod", scripts)

    def test_runs_these_tests(self):
        self.assertIn("python3 -m unittest discover -s deploy/ci/sweep", run_scripts(CI_JOBS["compat-pins"]))

    def test_the_matrix_waits_for_validation(self):
        self.assertIn("    needs: compat-pins", CI_JOBS["compat"])

    def test_nothing_reads_a_floor_key_any_more(self):
        for text in (SWEEP, "\n".join("\n".join(lines) for lines in CI_JOBS.values()), STACK):
            self.assertIsNone(re.search(r"\.floor\b|floor_release", text))


class StackScript(unittest.TestCase):
    def test_reports_the_config_schema_the_gateway_accepted(self):
        self.assertIn('echo "config_schema=${RESOLVED_SCHEMA}" >> "$GITHUB_OUTPUT"', STACK)

    def test_the_sweep_reads_it_back(self):
        self.assertIn("CONFIG_SCHEMA: ${{ steps.stack.outputs.config_schema }}", "\n".join(SWEEP_JOBS["gateway"]))


if __name__ == "__main__":
    unittest.main()
