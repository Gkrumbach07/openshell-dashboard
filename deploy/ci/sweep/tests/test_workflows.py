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


def steps(lines):
    """A job's steps, each as a dict of its name, text, scripts and own env.

    `env` is the text of the step's own env: block. A value handed to one step
    there is not visible to any other step, which is what the token tests
    below rely on.
    """
    start = lines.index("    steps:")
    found, current = [], None
    for line in lines[start + 1 :]:
        if line.strip() and not line.lstrip().startswith("#") and indent(line) < 6:
            break
        if re.match(r"^      - ", line):
            current = []
            found.append(current)
        if current is not None:
            current.append(line)
    out = []
    for body in found:
        text = "\n".join(body)
        name = re.search(r"^\s+(?:- )?name:\s*(.+)$", text, re.M)
        uses = re.search(r"^\s+(?:- )?uses:\s*(\S+)", text, re.M)
        env, inside = [], False
        for line in body:
            if re.match(r"^        env:\s*$", line):
                inside = True
            elif inside and line.strip() and indent(line) <= 8:
                inside = False
            elif inside:
                env.append(line)
        out.append(
            {
                "name": name.group(1).strip() if name else (uses.group(1) if uses else ""),
                "uses": uses.group(1) if uses else None,
                "lines": body,
                "text": text,
                "scripts": run_scripts(body),
                "env": "\n".join(env),
            }
        )
    return out


def job_env(lines):
    """The text of a job's own env: block (not its steps')."""
    start = lines.index("    steps:")
    env, inside = [], False
    for line in lines[:start]:
        if re.match(r"^    env:\s*$", line):
            inside = True
        elif inside and line.strip() and indent(line) <= 4:
            inside = False
        elif inside:
            env.append(line)
    return "\n".join(env)


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

    def test_finds_the_steps(self):
        bump = steps(SWEEP_JOBS["bump"])
        self.assertGreaterEqual(len(bump), 8)
        self.assertEqual(bump[0]["uses"], "actions/checkout@v4")
        named = [step["name"] for step in bump]
        for name in (
            "List open pull requests on this axis's branch",
            "Apply the change for this axis and nothing else",
            "Push the branch and open or rewrite the PR",
            "Decide what happens to a PR this run does not propose",
            "Close it",
        ):
            self.assertIn(name, named)
        self.assertIn("GH_TOKEN", [s for s in bump if s["name"] == "Close it"][0]["env"])
        self.assertIn("ACTION:", job_env(SWEEP_JOBS["bump"]))

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

    def test_the_candidate_sdk_is_only_ever_run_by_the_read_only_sdk_job(self):
        for name, lines in SWEEP_JOBS.items():
            scripts = "\n".join(run_scripts(lines))
            with self.subTest(job=name):
                if name != "sdk":
                    self.assertNotIn("sdk-source-check", scripts)
                    self.assertNotIn("go get", scripts)
                    self.assertNotIn("go mod tidy", scripts)
        self.assertEqual(permissions(SWEEP_JOBS["sdk"]), {"contents": "read"})


class TheJobThatCanWrite(unittest.TestCase):
    """bump holds contents: write and pull-requests: write, so it runs nothing foreign.

    The read-only legs above may run upstream images and the candidate SDK
    because the worst they can do is read a public repository. This job could
    push to main (there is no branch protection), so the rule is the reverse:
    it executes only what is in this repository's own checkout, and the token
    reaches only the steps that push or call `gh`.
    """

    def setUp(self):
        self.lines = SWEEP_JOBS["bump"]
        self.steps = steps(self.lines)
        self.text = "\n".join(self.lines)

    def step(self, name):
        return [s for s in self.steps if s["name"] == name][0]

    def test_it_sets_up_no_toolchain_and_starts_no_container(self):
        for step in self.steps:
            if step["uses"]:
                self.assertIn(step["uses"], ("actions/checkout@v4", "actions/download-artifact@v4"), step["name"])
        for script in run_scripts(self.lines):
            for word in ("docker", "npm ", "npx ", "pip ", "make ", "curl ", "wget ", "e2e-stack", "sdk-source-check"):
                self.assertNotIn(word, script)
            # No Go at all: `go get` downloads the candidate SDK and `go test`
            # runs it. Its go.mod and go.sum arrive as files instead.
            self.assertIsNone(re.search(r"(^|[\s;&|(])go\s", script))

    def test_every_command_it_runs_is_git_gh_or_this_repositorys_own(self):
        # Every command line, with its continuation lines folded in, starts
        # with one of these. `elif url=$(gh pr create ...)` is the one command
        # that hides behind a keyword, and it is `gh`.
        allowed = re.compile(
            r"^(set -euo pipefail$|if \[ |else$|elif url=\$\(gh pr create |fi$|\$SWEEP |git |gh |echo |cat |exit 1$|"
            r"push\(\) \{$|\}$|push |title=\$\(cat |num=\$\(cat |node scripts/readme-gateway-range\.mjs --write$|#)"
        )
        for step in self.steps:
            for script in step["scripts"]:
                folded = re.sub(r"\\\n\s*", "", script)
                for line in folded.splitlines():
                    line = line.strip()
                    if line:
                        self.assertRegex(line, allowed, "%s: %r" % (step["name"], line))

    def test_the_sdk_change_is_copied_in_from_the_legs_that_proved_it(self):
        self.assertIn("pattern: sweep-sdk-gomod-sdk-release-*", self.text)
        apply_step = self.step("Apply the change for this axis and nothing else")
        self.assertIn(
            "bump-sdk --decision /tmp/sweep/decision.json --tested /tmp/sweep/tested", apply_step["scripts"][0]
        )
        # ...which the read-only leg uploads only after its compat run passed.
        sdk = [s for s in steps(SWEEP_JOBS["sdk"]) if s["name"] == "Keep the go.mod and go.sum this leg proved"][0]
        self.assertIn("if: steps.compat.outcome == 'success' && matrix.sdk_id == 'sdk-release'", sdk["text"])
        self.assertIn("name: sweep-sdk-gomod-${{ matrix.id }}", sdk["text"])
        self.assertIn("backend/go.mod", sdk["text"])
        self.assertIn("backend/go.sum", sdk["text"])

    def test_the_checkout_keeps_no_credentials(self):
        checkout = self.steps[0]
        self.assertEqual(checkout["uses"], "actions/checkout@v4")
        self.assertIn("persist-credentials: false", checkout["text"])
        self.assertNotIn("token:", checkout["text"])

    def test_the_token_is_not_in_the_jobs_environment(self):
        env = job_env(self.lines)
        self.assertNotIn("GH_TOKEN", env)
        self.assertNotIn("github.token", env)
        # The one mention of the secret at job level is a comparison that
        # yields 'true' or 'false', never the value.
        mentions = [line.strip() for line in env.splitlines() if "secrets." in line and not line.strip().startswith("#")]
        self.assertEqual(mentions, ["HAS_SWEEP_TOKEN: ${{ secrets.SWEEP_TOKEN != '' }}"])

    def test_only_steps_that_push_or_call_gh_are_handed_the_token(self):
        holders = [step for step in self.steps if "secrets." in step["text"] or "github.token" in step["text"]]
        self.assertEqual(
            [step["name"] for step in holders],
            [
                "List open pull requests on this axis's branch",
                "Push the branch and open or rewrite the PR",
                "Close it",
            ],
        )
        for step in holders:
            self.assertIn("GH_TOKEN: ${{ secrets.SWEEP_TOKEN || github.token }}", step["env"])
            script = "\n".join(step["scripts"])
            self.assertTrue("gh " in script or "push " in script, step["name"])
            # Nothing of ours or anyone else's runs beside the token.
            for word in ("$SWEEP", "python", "node ", "git commit", "git add"):
                self.assertNotIn(word, script, step["name"])

    def test_the_steps_that_edit_and_commit_have_no_token(self):
        for name in (
            "Apply the change for this axis and nothing else",
            "Decide what happens to a PR this run does not propose",
        ):
            step = self.step(name)
            self.assertEqual(step["env"], "")
            self.assertNotIn("secrets.", step["text"])
            self.assertNotIn("github.token", step["text"])

    def test_the_readme_block_is_regenerated_only_where_the_script_exists(self):
        script = self.step("Apply the change for this axis and nothing else")["scripts"][0]
        self.assertIn("if [ -f scripts/readme-gateway-range.mjs ]; then", script)
        self.assertIn("node scripts/readme-gateway-range.mjs --write", script)
        # After the edit it restates, and before the guard that judges it.
        self.assertLess(script.index("bump-sdk"), script.index("readme-gateway-range.mjs --write"))
        self.assertLess(script.index("readme-gateway-range.mjs --write"), script.index("check-diff --axis"))


class PullRequests(unittest.TestCase):
    def setUp(self):
        self.steps = {step["name"]: step for step in steps(SWEEP_JOBS["bump"])}
        self.push = self.steps["Push the branch and open or rewrite the PR"]["scripts"][0]

    def test_which_pr_is_the_sweeps_own_is_decided_in_tested_code(self):
        listing = self.steps["List open pull requests on this axis's branch"]["scripts"][0]
        self.assertIn("isCrossRepository", listing)
        self.assertIn("headRefName", listing)
        self.assertIn("> /tmp/sweep/prs.json", listing)
        # No step picks a pull request out of `gh pr list` by itself.
        for step in self.steps.values():
            for script in step["scripts"]:
                self.assertNotIn("--jq", script)
        apply_script = self.steps["Apply the change for this axis and nothing else"]["scripts"][0]
        self.assertIn('--prs /tmp/sweep/prs.json --branch "$BRANCH"', apply_script)
        self.assertIn(
            "pr-close --axis", self.steps["Decide what happens to a PR this run does not propose"]["scripts"][0]
        )
        self.assertIn("num=$(cat /tmp/sweep/pr/number.txt)", self.push)
        self.assertIn("num=$(cat /tmp/sweep/close/number.txt)", self.steps["Close it"]["scripts"][0])

    def test_a_refused_pull_request_leaves_no_branch_behind_and_names_both_remedies(self):
        refused = self.push[self.push.index("gh pr create") :]
        self.assertIn('push origin --delete "$BRANCH"', refused)
        self.assertIn("exit 1", refused)
        self.assertLess(refused.index('push origin --delete "$BRANCH"'), refused.index("exit 1"))
        error = [line for line in refused.splitlines() if "::error" in line][0]
        self.assertIn("Allow GitHub Actions to create and approve pull requests", error)
        self.assertIn("SWEEP_TOKEN", error)
        self.assertIn("NO pull request was opened", refused)

    def test_the_header_says_what_must_be_true_before_a_pr_can_be_opened(self):
        header = SWEEP[: SWEEP.index("\nname: Compat sweep")]
        self.assertIn("BEFORE THIS WORKFLOW CAN OPEN A PULL REQUEST", header)
        self.assertIn("create and approve pull requests", header)
        self.assertIn("SWEEP_TOKEN", header)

    def test_the_token_reaches_git_through_the_environment_only(self):
        self.assertIn("-c credential.helper= ", self.push)
        self.assertIn('echo "password=${GH_TOKEN}"', self.push)
        self.assertNotIn("x-access-token:$", self.push)
        self.assertNotIn("extraheader", self.push)

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
        self.assertLess(script.index("check-diff --axis"), script.index("push --force origin"))

    def test_one_fixed_branch_per_axis(self):
        text = "\n".join(SWEEP_JOBS["bump"])
        self.assertIn("branch: compat-sweep/gateway", text)
        self.assertIn("branch: compat-sweep/sdk", text)


class SideEffects(unittest.TestCase):
    def test_issue_and_prs_only_from_main(self):
        self.assertIn(
            "if: ${{ !cancelled() && needs.report.result == 'success' && github.ref == 'refs/heads/main' }}",
            "\n".join(SWEEP_JOBS["bump"]),
        )
        report = SWEEP_JOBS["report"]
        step = report.index("      - name: Maintain the issue")
        self.assertIn("github.ref == 'refs/heads/main'", report[step + 1])

    def test_cancelling_a_run_stops_it_from_writing(self):
        # always() is true for a cancelled run as well, so Cancel would not
        # have stopped the issue or the PRs from being edited.
        for name in ("report", "bump"):
            condition = [line for line in SWEEP_JOBS[name] if line.startswith("    if:")][0]
            self.assertIn("!cancelled()", condition)
            self.assertNotIn("always()", condition)

    def test_a_dry_run_cannot_take_the_scheduled_sweeps_place_in_the_queue(self):
        self.assertIn(
            "  group: compat-sweep-${{ github.ref == 'refs/heads/main' && 'main' || github.run_id }}\n", SWEEP
        )
        self.assertIn("  cancel-in-progress: false\n", SWEEP)

    def test_the_report_is_told_when_it_is_a_dry_run(self):
        text = "\n".join(SWEEP_JOBS["report"])
        self.assertIn("DRY_RUN: ${{ github.ref != 'refs/heads/main' }}", text)
        self.assertIn('--dry-run "$DRY_RUN"', text)
        self.assertIn('--repo-url "$REPO_URL"', text)

    def test_the_sweep_token_is_optional(self):
        text = "\n".join(SWEEP_JOBS["bump"])
        self.assertEqual(text.count("secrets.SWEEP_TOKEN || github.token"), 3)

    def test_a_scheduled_run_sweeps_the_whole_range(self):
        # No default cap: an empty max_versions means every release from the
        # floor up, so a release cannot slide out of the window unseen.
        self.assertIn("          MAX_VERSIONS: ${{ inputs.max_versions }}", SWEEP_JOBS["plan"])
        dispatch = SWEEP[SWEEP.index("      max_versions:") : SWEEP.index("      include_head:")]
        self.assertIn('default: ""', dispatch)

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


class LegsThatCannotBeSetUp(unittest.TestCase):
    """A leg that cannot pull, start the gateway or start the BFF still reports.

    Those steps come before "Record result". If one of them failed the leg,
    nothing would be uploaded and a failure that repeats every week would
    read, every week, as "the leg did not report; re-run the sweep".
    """

    def test_every_setup_step_is_a_result_and_gates_the_next(self):
        chain = [
            ("Pull images", "pull", None),
            ("Start gateway stack", "stack", "pull"),
            ("Start the BFF", "bff", "stack"),
            ("Run compat suite", "compat", "bff"),
        ]
        for job in ("gateway", "sdk"):
            by_name = {step["name"]: step for step in steps(SWEEP_JOBS[job])}
            for name, step_id, needs in chain:
                text = by_name[name]["text"]
                with self.subTest(job=job, step=name):
                    self.assertIn("id: %s" % step_id, text)
                    self.assertIn("continue-on-error: true", text)
                    if needs:
                        self.assertIn("if: steps.%s.outcome == 'success'" % needs, text)
            record = by_name["Record result"]
            for flag in ('--pull "$PULL"', '--stack "$STACK"', '--bff "$BFF"', '--compat "$COMPAT"'):
                self.assertIn(flag, record["scripts"][0])
            for variable in ("PULL: ${{ steps.pull.outcome }}", "BFF: ${{ steps.bff.outcome }}"):
                self.assertIn(variable, record["env"])


class StackScript(unittest.TestCase):
    def test_reports_the_config_schema_the_gateway_accepted(self):
        self.assertIn('echo "config_schema=${RESOLVED_SCHEMA}" >> "$GITHUB_OUTPUT"', STACK)

    def test_prints_the_gateway_log_before_it_tears_a_failed_stack_down(self):
        attempt = STACK[STACK.index("try_schema() {") : STACK.index("\ndown() {")]
        self.assertLess(attempt.index("$COMPOSE logs"), attempt.index("$COMPOSE down -v"))
        self.assertLess(attempt.index('tail -n 120 <<<"$logs" >&2'), attempt.index("$COMPOSE down -v"))
        # Nothing asks for logs after try_schema has returned: by then the
        # containers are gone and the answer would be empty.
        up = STACK[STACK.index("\nup() {") : STACK.index("try_schema() {")]
        self.assertNotIn("$COMPOSE logs", up)

    def test_the_sweep_does_not_ask_a_stack_that_never_started_for_its_logs(self):
        for job in ("gateway", "sdk"):
            logs = [step for step in steps(SWEEP_JOBS[job]) if step["name"] == "Gateway logs"][0]
            self.assertIn(
                "if: always() && (steps.bff.outcome == 'failure' || steps.compat.outcome == 'failure')", logs["text"]
            )

    def test_the_sweep_reads_it_back(self):
        self.assertIn("CONFIG_SCHEMA: ${{ steps.stack.outputs.config_schema }}", "\n".join(SWEEP_JOBS["gateway"]))


if __name__ == "__main__":
    unittest.main()
