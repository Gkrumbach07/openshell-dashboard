"""Wording of the issue, the summary and the PRs."""

import unittest

import candidates
import outcomes
import report
from tests import support

RUN_URL = "https://example.invalid/actions/runs/1"
REPO_URL = "https://example.invalid/owner/repo"


def decision_for(name):
    return support.run_scenario(name)[3]


class Issue(unittest.TestCase):
    def test_carries_the_marker_the_adr_and_the_run(self):
        _, body = report.render_issue(decision_for("newer-release-fails"), RUN_URL, REPO_URL)
        self.assertTrue(body.startswith(report.ISSUE_MARKER))
        self.assertIn(
            "[ADR 0006](https://example.invalid/owner/repo/blob/main/docs/adrs/0006-compat-links-and-sweep-axes.md)", body
        )
        self.assertIn("[Sweep run](%s)" % RUN_URL, body)

    def test_the_adr_link_is_absolute_wherever_github_does_not_rewrite_it(self):
        self.assertEqual(
            report.adr_link("https://github.com/o/r/"),
            "[ADR 0006](https://github.com/o/r/blob/main/docs/adrs/0006-compat-links-and-sweep-axes.md)",
        )
        # Without a repository (a local render) it falls back to the path.
        self.assertEqual(report.adr_link(), "[ADR 0006](docs/adrs/0006-compat-links-and-sweep-axes.md)")

    def test_states_the_derived_range_and_the_pin(self):
        _, body = report.render_issue(decision_for("newer-release-fails"), RUN_URL)
        self.assertIn("**Supported gateway range:** `0.1.0` to `0.1.2`, derived from the required lanes", body)
        self.assertIn("**SDK pin:** `v0.0.0-20260928030816-6648bd0c290e` (upstream v0.1.2).", body)

    def test_explains_both_axes_and_which_side_each_holds_still(self):
        _, body = report.render_issue(decision_for("newer-release-fails"), RUN_URL)
        self.assertIn("The SDK stays at the pin; only the gateway image changes.", body)
        self.assertIn("The gateways stay at the required lanes (`0.1.0` and `0.1.2`); only the SDK changes.", body)

    def test_tables_have_a_link_column_and_an_action_column(self):
        _, body = report.render_issue(decision_for("sdk-drops-floor"), RUN_URL)
        self.assertIn("| Gateway | Where | Result | Link that failed | What to do |", body)
        self.assertIn("| SDK | Result | Link that failed | What to do |", body)

    def test_stays_inside_the_issue_size_limit_with_a_huge_log(self):
        scenario, plan, _, _ = support.run_scenario("sdk-source-incompatible")
        huge = "x" * 500000
        legs = {
            "sdk-release-0.1.0": {"source": "failure", "source_log": huge},
            "sdk-release-0.1.2": {"source": "failure", "source_log": huge},
        }
        decision = outcomes.decide(plan, support.leg_results(plan, legs))
        _, body = report.render_issue(decision, RUN_URL)
        self.assertLess(len(body), 65536)
        self.assertTrue(scenario["description"])

    def test_a_pin_that_is_not_on_a_release_tag_is_called_out(self):
        decision = decision_for("newer-release-fails")
        decision["sdk_pin_tag"] = None
        _, body = report.render_issue(decision, RUN_URL)
        self.assertIn("The SDK pin is not the commit of an upstream release tag.", body)
        self.assertIn("(not on any upstream tag)", body)

    def test_a_pin_on_a_release_tag_gets_no_notice(self):
        _, body = report.render_issue(decision_for("newer-release-fails"), RUN_URL)
        self.assertNotIn("not the commit of an upstream release tag", body)

    def test_table_cells_cannot_break_the_table(self):
        rows = report._table(["a", "b"], [["x | y", "z"]])
        self.assertEqual(rows[-1], "| x / y | z |")


class Summary(unittest.TestCase):
    def test_says_what_the_run_will_do(self):
        summary = report.render_summary(decision_for("newer-release-passes"), RUN_URL)
        self.assertIn("issue: **close** | gateway PR: **open** | SDK PR: **open**", summary)

    def test_mentions_what_the_cap_left_out(self):
        scenario = support.fixture("scenarios/newer-release-passes.json")
        plan = candidates.build_plan(
            support.fixture("pins.json"), support.FakeUpstream(support.upstream_data(scenario["upstream"])), max_versions=1
        )
        decision = outcomes.decide(plan, support.leg_results(plan))
        summary = report.render_summary(decision)
        self.assertIn("Inside the supported range but NOT swept in this run: `0.1.1` and `0.1.0`.", summary)
        self.assertIn("this one cannot close the issue", summary)

    def test_a_dry_run_says_that_nothing_is_written(self):
        decision = decision_for("newer-release-passes")
        self.assertIn("**Dry run.** This run is not on `main`, so it writes nothing", report.render_summary(decision, dry_run=True))
        self.assertNotIn("Dry run", report.render_summary(decision))

    def test_says_why_the_issue_is_left_alone(self):
        summary = report.render_summary(decision_for("leg-did-not-report"))
        self.assertIn("The issue is left exactly as it is, open or not, because at least one leg did not report", summary)
        self.assertNotIn("left exactly as it is", report.render_summary(decision_for("newer-release-passes")))

    def test_says_when_head_was_not_probed(self):
        plan = candidates.build_plan(
            support.fixture("pins.json"), support.FakeUpstream(support.upstream_data()), include_head=False
        )
        summary = report.render_summary(outcomes.decide(plan, support.leg_results(plan)))
        self.assertIn("upstream HEAD was not probed in this run", summary)
        self.assertIn("include_head was off", summary)


class GatewayPr(unittest.TestCase):
    def setUp(self):
        self.text = report.render_pr("gateway", decision_for("sdk-source-incompatible"), RUN_URL)

    def test_title_is_a_commit_type_that_cuts_a_release(self):
        # A moved ceiling changes the range every released artifact declares.
        # `ci` (type or scope) releases nothing, so the title is a fix.
        self.assertEqual(self.text["title"], "fix(compat): support gateway 0.1.3")
        self.assertEqual(self.text["commit"].splitlines()[0], "fix(compat): support gateway 0.1.3")
        self.assertIn("**Merging this cuts a release.**", self.text["body"])

    def test_the_readme_block_is_mentioned_exactly_when_it_changed(self):
        decision = decision_for("sdk-source-incompatible")
        with_block = report.render_pr("gateway", decision, RUN_URL, readme_block=True)
        self.assertIn(
            "`deploy/ci/gateway-pins.json`, and the generated range block of `README.md`, which restates the range "
            "and the SDK pin from that file. Nothing else.",
            with_block["body"],
        )
        self.assertIn("regenerates the range block of README.md", " ".join(with_block["commit"].split()))
        self.assertNotIn("README", self.text["body"])
        self.assertNotIn("README", self.text["commit"])

    def test_body_says_what_was_proven_and_exactly_what_changes(self):
        body = self.text["body"]
        self.assertIn("gateway axis", body)
        self.assertIn("passes `backend/test/compat` against gateway `0.1.3`", body)
        self.assertIn("`deploy/ci/gateway-pins.json` only.", body)
        self.assertIn("The ceiling lane moves from `0.1.2` to `0.1.3`", body)
        self.assertIn("the SDK pin does not move on this axis", body)
        self.assertIn("Supported range after merge: `0.1.0` to `0.1.3`.", body)
        self.assertIn("ghcr.io/nvidia/openshell/gateway:0.1.3@sha256:" + "13" * 32, body)
        self.assertIn("Never merged automatically.", body)

    def test_commit_message_starts_with_the_title(self):
        lines = self.text["commit"].splitlines()
        self.assertEqual(lines[0], self.text["title"])
        self.assertEqual(lines[1], "")
        self.assertIn("The floor lane (0.1.0) and the SDK pin are unchanged.", " ".join(self.text["commit"].split()))

    def test_commit_message_is_wrapped(self):
        for axis, scenario in (("gateway", "sdk-source-incompatible"), ("sdk", "sdk-passes-everywhere")):
            commit = report.render_pr(axis, decision_for(scenario), RUN_URL)["commit"]
            self.assertLessEqual(max(len(line) for line in commit.splitlines()), 72)

    def test_no_note_about_the_other_axis_when_it_has_no_pr(self):
        self.assertNotIn("The other axis has a PR too", self.text["body"])


class SdkPr(unittest.TestCase):
    def setUp(self):
        self.text = report.render_pr("sdk", decision_for("sdk-passes-everywhere"), RUN_URL)

    def test_title_is_a_commit_type_that_cuts_a_release(self):
        # The published BFF is built against the SDK, so moving it is released.
        self.assertEqual(self.text["title"], "fix(sdk): move to the OpenShell SDK at v0.1.3")
        self.assertIn("**Merging this cuts a release.**", self.text["body"])

    def test_no_title_uses_a_type_or_scope_that_releases_nothing(self):
        for title in (report.GATEWAY_TITLE % "0.1.3", report.SDK_TITLE % "v0.1.3"):
            self.assertRegex(title, r"^fix\((compat|sdk)\): ")
            self.assertNotRegex(title, r"^(ci|build|chore|docs|test|refactor)\b")
            self.assertNotIn("(ci)", title)

    def test_body_says_the_files_were_copied_not_rebuilt(self):
        self.assertIn("copied in unchanged. Nothing was built or run by the job that opened this PR.", self.text["body"])

    def test_body_names_both_links_and_exactly_what_changes(self):
        body = self.text["body"]
        self.assertIn("SDK axis", body)
        self.assertIn("the source link (SDK<->BFF): `go build ./...`, `go vet ./...` and `go test ./...` pass", body)
        self.assertIn("the wire link (gateway<->SDK): `backend/test/compat` passes against every required lane, `0.1.0` and `0.1.2`", body)
        self.assertIn("`backend/go.mod`, `backend/go.sum` and the `sdk` field of `deploy/ci/gateway-pins.json` only.", body)
        self.assertIn("No gateway image moves on this axis, so the supported range stays `0.1.0` to `0.1.2`.", body)
        self.assertIn("`v0.0.0-20261012090000-a0130000a013`", body)


class CiNote(unittest.TestCase):
    def test_without_the_secret_the_pr_says_how_to_start_ci(self):
        body = report.render_pr("sdk", decision_for("sdk-passes-everywhere"), RUN_URL, has_sweep_token=False)["body"]
        self.assertIn("CI does not start by itself on this PR.", body)
        self.assertIn("Approve workflows to run", body)
        self.assertIn("close and reopen the PR", body)
        self.assertIn("`SWEEP_TOKEN`", body)

    def test_with_the_secret_it_says_ci_runs(self):
        body = report.render_pr("sdk", decision_for("sdk-passes-everywhere"), RUN_URL, has_sweep_token=True)["body"]
        self.assertIn("Opened with the `SWEEP_TOKEN` secret", body)
        self.assertNotIn("CI does not start by itself", body)


if __name__ == "__main__":
    unittest.main()
