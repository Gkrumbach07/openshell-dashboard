"""End-to-end decisions: fixture in, conclusion out.

Each file in fixtures/scenarios describes an upstream, what the legs observed
and what the run must conclude. The first test checks every scenario against
its own `expect` block; the classes after it pin down the rules that matter
most, in words.
"""

import unittest

import candidates
import guard
import outcomes
import pins
import prs
import report
from tests import support

RUN_URL = "https://example.invalid/actions/runs/1"
REPO_URL = "https://example.invalid/owner/repo"

# The cases the sweep was rebuilt for. Each must exist as a fixture.
REQUIRED_SCENARIOS = (
    "nothing-newer-released",
    "newer-release-passes",
    "newer-release-fails",
    "interior-release-fails",
    "only-dev-fails",
    "sdk-source-incompatible",
    "sdk-drops-floor",
    "sdk-passes-everywhere",
)

# One fixture per finding of the review of the first version (each file's
# description says what used to happen).
REVIEW_SCENARIOS = (
    "cap-cannot-hide-a-failing-release",
    "release-without-image-holds-the-ceiling",
    "narrowed-run-keeps-the-issue",
    "head-not-probed-keeps-the-issue",
    "sdk-could-not-be-fetched",
    "sdk-legs-disagree-on-source",
    "source-check-named-no-step",
    "advisory-lane-above-the-ceiling",
    "sdk-floor-fails-other-lane-unknown",
    "no-sdk-leg-reported",
    "sdk-pin-on-a-pre-release",
    "ceiling-target-below-a-missing-leg",
    "sdk-lane-missing-other-lane-fails",
    "newer-sdk-fails-older-pr-open",
    "image-could-not-be-pulled",
    "bff-did-not-start",
)


def decision_for(name):
    return support.run_scenario(name)[3]


class EveryScenario(unittest.TestCase):
    def test_required_scenarios_exist(self):
        for name in REQUIRED_SCENARIOS + REVIEW_SCENARIOS:
            self.assertIn(name, support.scenario_names())

    def test_each_scenario_reaches_its_expected_conclusion(self):
        for name in support.scenario_names():
            scenario, _, _, decision = support.run_scenario(name)
            expect = scenario["expect"]
            title, issue = report.render_issue(decision, RUN_URL)
            summary = report.render_summary(decision, RUN_URL)
            with self.subTest(scenario=name):
                self.assertEqual(decision["issue"]["action"], expect["issue_action"])
                self.assertEqual(decision["gateway"]["pr"], expect["gateway_pr"])
                self.assertEqual(decision["sdk"]["pr"], expect["sdk_pr"])
                self.assertEqual(decision["incomplete"], expect["incomplete"])
                self.assertEqual(
                    {row["version"]: row["status"] for row in decision["gateway"]["rows"]},
                    expect["gateway_statuses"],
                )
                self.assertEqual(
                    {row["label"]: row["status"] for row in decision["sdk"]["rows"]}, expect["sdk_statuses"]
                )
                if "gateway_bump" in expect:
                    self.assertEqual(decision["gateway"]["bump"]["version"], expect["gateway_bump"])
                if "sdk_bump" in expect:
                    self.assertEqual(decision["sdk"]["bump"]["version"], expect["sdk_bump"])
                if "title_is" in expect:
                    self.assertEqual(title, expect["title_is"])
                for text in expect.get("title_contains", []):
                    self.assertIn(text, title)
                for text in expect.get("title_lacks", []):
                    self.assertNotIn(text, title)
                for text in expect.get("issue_contains", []):
                    self.assertIn(text, issue)
                for text in expect.get("issue_lacks", []):
                    self.assertNotIn(text, issue)
                for text in expect.get("summary_contains", []):
                    self.assertIn(text, summary)
                for text in expect.get("summary_lacks", []):
                    self.assertNotIn(text, summary)
                if "sdk_candidate" in expect:
                    self.assertEqual(decision["sdk"]["candidate"], expect["sdk_candidate"])

    def test_no_row_sends_the_reader_to_a_pr_the_run_does_not_open(self):
        # The report is written before the PR job runs and may be read after
        # that job failed, so it never says a pull request exists; and a row
        # may only mention this run's PR job when this run proposes something.
        for name in support.scenario_names():
            decision = decision_for(name)
            summary = report.render_summary(decision, RUN_URL)
            with self.subTest(scenario=name):
                self.assertNotRegex(summary, r"(?i)merge (the|that) PR\b")
                for axis, branch in (("gateway", report.GATEWAY_BRANCH), ("sdk", report.SDK_BRANCH)):
                    promised = "opens or rewrites the pull request on `%s`" % branch in summary
                    self.assertEqual(promised, decision[axis]["pr"] == "open", axis)
                    if promised:
                        self.assertIn("If it failed or did not run, no pull request was opened", summary)

    def test_links_work_where_the_text_is_rendered(self):
        # An issue, a pull request and a step summary are not rendered files:
        # a repository-relative link there resolves against the page and 404s.
        absolute = "(%s/blob/main/docs/adrs/0006-compat-links-and-sweep-axes.md)" % REPO_URL
        for name in support.scenario_names():
            decision = decision_for(name)
            texts = [report.render_issue(decision, RUN_URL, REPO_URL)[1], report.render_summary(decision, RUN_URL, REPO_URL)]
            for axis in ("gateway", "sdk"):
                if decision[axis]["bump"]:
                    texts.append(report.render_pr(axis, decision, RUN_URL, repo_url=REPO_URL)["body"])
            with self.subTest(scenario=name):
                for text in texts:
                    self.assertIn(absolute, text)
                    self.assertNotIn("](docs/", text)

    def test_an_incomplete_run_is_exactly_one_with_a_silent_leg_or_an_unknown_row(self):
        for name in support.scenario_names():
            scenario, plan, results, decision = support.run_scenario(name)
            planned = [c["id"] for c in plan["gateway"]["candidates"]] + [leg["id"] for leg in plan["sdk"]["legs"]]
            silent = set(planned) - set(result["id"] for result in results)
            unknown = [r for r in decision["gateway"]["rows"] + decision["sdk"]["rows"] if r["status"] in outcomes.UNKNOWN]
            with self.subTest(scenario=name):
                self.assertEqual(decision["incomplete"], bool(silent or unknown))
                if decision["incomplete"]:
                    # Unknown closes nothing.
                    self.assertNotEqual(decision["issue"]["action"], "close")

    def test_a_pr_is_open_exactly_when_there_is_a_bump(self):
        for name in support.scenario_names():
            decision = decision_for(name)
            with self.subTest(scenario=name):
                for axis in ("gateway", "sdk"):
                    self.assertEqual(decision[axis]["pr"] == "open", decision[axis]["bump"] is not None)

    def test_head_is_never_a_bump_target(self):
        # dev and @latest are early warning, whatever they report.
        for name in support.scenario_names():
            decision = decision_for(name)
            with self.subTest(scenario=name):
                for row in decision["gateway"]["rows"] + decision["sdk"]["rows"]:
                    if row["early_warning"]:
                        self.assertNotEqual(row["status"], outcomes.BUMP)
                if decision["gateway"]["bump"]:
                    self.assertIsNotNone(pins.parse_release(decision["gateway"]["bump"]["version"]))
                if decision["sdk"]["bump"]:
                    self.assertIsNotNone(decision["sdk"]["bump"]["tag"])

    def test_every_row_that_needs_attention_names_its_link_and_an_action(self):
        for name in support.scenario_names():
            decision = decision_for(name)
            _, issue = report.render_issue(decision, RUN_URL)
            with self.subTest(scenario=name):
                for row in decision["gateway"]["rows"]:
                    if row["status"] in outcomes.NEEDS_ATTENTION:
                        self.assertTrue(report._gateway_link(row).strip())
                        self.assertGreater(len(report._gateway_action(row, decision)), 40)
                        self.assertIn(report._gateway_action(row, decision), issue)
                for row in decision["sdk"]["rows"]:
                    if row["status"] in outcomes.NEEDS_ATTENTION:
                        self.assertTrue(report._sdk_link(row).strip())
                        self.assertGreater(len(report._sdk_action(row, decision)), 40)
                        self.assertIn(report._sdk_action(row, decision), issue)

    def test_a_wire_failure_is_never_called_source_and_the_reverse(self):
        for name in support.scenario_names():
            decision = decision_for(name)
            with self.subTest(scenario=name):
                for row in decision["gateway"]["rows"]:
                    # The gateway axis never changes the SDK, so it cannot find a source problem.
                    self.assertNotEqual(row["status"], outcomes.SOURCE)
                    self.assertNotEqual(report._gateway_link(row), report.SOURCE_LINK)
                for row in decision["sdk"]["rows"]:
                    if row["status"] == outcomes.SOURCE:
                        self.assertEqual(report._sdk_link(row), report.SOURCE_LINK)
                    if row["status"] == outcomes.WIRE:
                        self.assertEqual(report._sdk_link(row), report.WIRE_LINK)


class NothingNewerReleased(unittest.TestCase):
    def test_leaves_nothing_open(self):
        decision = decision_for("nothing-newer-released")
        self.assertEqual(decision["issue"]["action"], "close")
        self.assertEqual((decision["gateway"]["pr"], decision["sdk"]["pr"]), ("close", "close"))
        self.assertEqual(decision["counts"], {"outstanding": 0, "early_warning": 0, "missing": 0})
        self.assertIsNone(decision["gateway"]["bump"])
        self.assertIsNone(decision["sdk"]["bump"])


class NewerReleasePasses(unittest.TestCase):
    def setUp(self):
        self.decision = decision_for("newer-release-passes")
        self.before = support.fixture("pins.json")

    def test_the_gateway_pr_changes_the_pins_file_and_only_the_ceiling_lane(self):
        bump = self.decision["gateway"]["bump"]
        after = pins.move_ceiling(
            self.before, bump["version"], bump["gateway_image"], bump["supervisor_image"], bump["config_schema"]
        )
        self.assertEqual(guard.check_changes("gateway", [guard.PINS_FILE], self.before, after), [])
        self.assertEqual(pins.supported_range(after), ("0.1.0", "0.1.3"))
        self.assertEqual(after["sdk"], self.before["sdk"])
        self.assertEqual(after["lanes"][1], self.before["lanes"][1])

    def test_the_new_lane_is_pinned_at_the_digest_that_was_tested(self):
        bump = self.decision["gateway"]["bump"]
        self.assertEqual(bump["gateway_image"], "ghcr.io/nvidia/openshell/gateway:0.1.3@sha256:" + "13" * 32)
        self.assertEqual(bump["supervisor_image"], "ghcr.io/nvidia/openshell/supervisor:0.1.3@sha256:" + "31" * 32)
        self.assertEqual(bump["from"], "0.1.2")

    def test_each_pr_says_the_other_axis_proposes_a_change_too(self):
        for axis in ("gateway", "sdk"):
            body = report.render_pr(axis, self.decision, RUN_URL)["body"]
            self.assertIn("The other axis proposes a change too", body)
            self.assertIn("not the two together", body)


class NewerReleaseFails(unittest.TestCase):
    def test_reported_as_wire_with_no_gateway_pr(self):
        decision = decision_for("newer-release-fails")
        row = decision["gateway"]["rows"][0]
        self.assertEqual((row["version"], row["status"], row["position"]), ("0.1.3", "wire", "above"))
        self.assertEqual(report._gateway_link(row), "wire: gateway<->SDK")
        self.assertIsNone(decision["gateway"]["bump"])
        self.assertEqual(decision["gateway"]["pr"], "close")

    def test_the_sdk_axis_is_judged_on_its_own(self):
        # The same run may still move the SDK: a different link, a different PR.
        decision = decision_for("newer-release-fails")
        self.assertEqual(decision["sdk"]["pr"], "open")


class InteriorReleaseFails(unittest.TestCase):
    def test_reported_as_a_broken_promise_inside_the_range(self):
        decision = decision_for("interior-release-fails")
        row = [r for r in decision["gateway"]["rows"] if r["version"] == "0.1.1"][0]
        self.assertEqual((row["status"], row["position"]), ("wire", "in_range"))
        title, body = report.render_issue(decision)
        self.assertEqual(title, "Compat sweep: gateway 0.1.1 fails inside the supported range (wire)")
        self.assertIn("Gateway `0.1.1`, in the range: compat suite FAILED. Link: **wire: gateway<->SDK**.", body)

    def test_a_failing_required_lane_says_ci_is_red(self):
        scenario = support.fixture("scenarios/interior-release-fails.json")
        plan = support.run_scenario("interior-release-fails")[1]
        results = support.leg_results(plan, {"gateway-0.1.0": {"compat": "failure"}})
        decision = outcomes.decide(plan, results)
        self.assertIn("It is a required lane, so CI on main is red too.", report.render_issue(decision)[1])
        self.assertTrue(scenario["description"])

    def test_a_repushed_lane_that_fails_does_not_claim_ci_is_red(self):
        # CI pulls the pinned digest; the sweep pulled what the tag resolves to now.
        data = support.upstream_data({"images": {"gateway:0.1.2": "sha256:" + "ff" * 32}})
        plan = candidates.build_plan(support.fixture("pins.json"), support.FakeUpstream(data))
        decision = outcomes.decide(plan, support.leg_results(plan, {"gateway-0.1.2": {"compat": "failure"}}))
        body = report.render_issue(decision)[1]
        self.assertIn("Upstream re-pushed this release", body)
        self.assertIn("CI, which pulls the pinned digest, may still be green", body)
        self.assertNotIn("CI on main is red too", body)
        self.assertIn("Upstream re-pushed release `0.1.2`", body)

    def test_a_repushed_lane_that_passes_is_still_mentioned(self):
        data = support.upstream_data({"images": {"gateway:0.1.2": "sha256:" + "ff" * 32}})
        plan = candidates.build_plan(support.fixture("pins.json"), support.FakeUpstream(data))
        decision = outcomes.decide(plan, support.leg_results(plan))
        self.assertEqual(decision["issue"]["action"], "close")
        self.assertIn("Upstream re-pushed release `0.1.2`", report.render_summary(decision))


class OnlyDevFails(unittest.TestCase):
    def setUp(self):
        self.decision = decision_for("only-dev-fails")

    def test_is_an_early_warning_not_a_migration(self):
        self.assertEqual(self.decision["counts"], {"outstanding": 0, "early_warning": 1, "missing": 0})
        title, body = report.render_issue(self.decision)
        self.assertEqual(title, "Compat sweep: early warning from upstream HEAD")
        self.assertNotIn("release", title)
        self.assertIn("- gateway `dev`: compat suite FAILED (wire: gateway<->SDK)", body)

    def test_opens_no_pr_and_pins_nothing(self):
        self.assertIsNone(self.decision["gateway"]["bump"])
        self.assertIsNone(self.decision["sdk"]["bump"])
        self.assertEqual((self.decision["gateway"]["pr"], self.decision["sdk"]["pr"]), ("close", "close"))

    def test_a_passing_dev_and_a_passing_latest_open_nothing_either(self):
        plan = support.run_scenario("only-dev-fails")[1]
        decision = outcomes.decide(plan, support.leg_results(plan))
        self.assertEqual(decision["issue"]["action"], "close")
        self.assertEqual((decision["gateway"]["pr"], decision["sdk"]["pr"]), ("close", "close"))
        latest = decision["sdk"]["rows"][0]
        self.assertEqual((latest["kind"], latest["status"]), ("latest", "ok"))


class SdkSourceIncompatible(unittest.TestCase):
    def setUp(self):
        self.scenario, _, self.results, self.decision = support.run_scenario("sdk-source-incompatible")
        self.title, self.body = report.render_issue(self.decision, RUN_URL)

    def test_the_compiler_text_is_carried_into_the_report(self):
        log = self.scenario["legs"]["sdk-release-0.1.0"]["source_log"]
        for line in log.strip().splitlines():
            self.assertIn(line, self.body)
        self.assertIn("```text", self.body)

    def test_it_is_a_source_migration_and_explicitly_not_a_gateway_problem(self):
        row = self.decision["sdk"]["rows"][0]
        self.assertEqual(row["status"], "source")
        self.assertEqual(report._sdk_link(row), "source: SDK<->BFF")
        self.assertIn("NOT a gateway problem: no gateway was contacted", self.body)
        self.assertEqual(self.title, "Compat sweep: SDK v0.1.3 needs a source migration")
        # #75 reported exactly this as "3 release(s) need migration".
        self.assertNotIn("release(s) need migration", self.title + self.body)

    def test_no_gateway_row_is_blamed(self):
        for row in self.decision["gateway"]["rows"]:
            self.assertIn(row["status"], ("ok", "bump"))
        self.assertEqual(self.decision["counts"]["outstanding"], 1)

    def test_no_sdk_pr(self):
        self.assertIsNone(self.decision["sdk"]["bump"])
        self.assertEqual(self.decision["sdk"]["pr"], "close")

    def test_the_gateways_were_never_reached(self):
        for result in self.results:
            if result["axis"] == "sdk":
                self.assertEqual(result["outcome"], "source_incompatible")

    def test_a_leg_that_cannot_build_speaks_for_the_sdk_when_no_leg_contradicts_it(self):
        plan = support.run_scenario("sdk-source-incompatible")[1]
        legs = {
            "sdk-release-0.1.0": {"source": "failure", "source_step": "vet", "source_log": "vet: boom"},
            "sdk-release-0.1.2": None,
        }
        decision = outcomes.decide(plan, support.leg_results(plan, legs))
        row = decision["sdk"]["rows"][0]
        self.assertEqual((row["status"], row["source_step"]), ("source", "vet"))
        self.assertIn("`go vet ./...` failed", report.render_issue(decision)[1])
        # ...but the other leg still did not report, so the run is not complete.
        self.assertTrue(decision["incomplete"])

    def test_a_leg_that_passed_the_same_check_contradicts_it(self):
        # The source check is the same commands on the same SDK on every leg.
        plan = support.run_scenario("sdk-source-incompatible")[1]
        legs = {"sdk-release-0.1.0": {"source": "failure", "source_step": "vet", "source_log": "vet: boom"}}
        decision = outcomes.decide(plan, support.leg_results(plan, legs))
        row = decision["sdk"]["rows"][0]
        self.assertEqual(row["status"], "flaky")
        self.assertEqual(decision["sdk"]["pr"], "skip")
        self.assertNotIn("source migration", decision["issue"]["title"])

    def test_a_long_log_keeps_its_start_and_its_end(self):
        log = "FIRST LINE\n" + "x" * 50000 + "\nLAST LINE"
        clipped = report.clip(log)
        self.assertLess(len(clipped), report.LOG_BUDGET + 200)
        self.assertTrue(clipped.startswith("FIRST LINE"))
        self.assertTrue(clipped.endswith("LAST LINE"))
        self.assertIn("characters cut", clipped)

    def test_a_log_cannot_break_out_of_its_code_fence(self):
        self.assertNotIn("```", report.clip("before\n```\nafter"))

    def test_at_head_it_is_only_an_early_warning(self):
        plan = support.run_scenario("only-dev-fails")[1]
        legs = {
            "sdk-latest-0.1.0": {"source": "failure", "source_log": "undefined: openshell.Foo"},
            "sdk-latest-0.1.2": {"source": "failure", "source_log": "undefined: openshell.Foo"},
        }
        decision = outcomes.decide(plan, support.leg_results(plan, legs))
        title, body = report.render_issue(decision)
        self.assertEqual(title, "Compat sweep: early warning from upstream HEAD")
        self.assertIn("the next release will need this source migration", body)
        self.assertIn("undefined: openshell.Foo", body)
        self.assertEqual(decision["sdk"]["pr"], "close")


class SourceStepThatIsNotASourceProblem(unittest.TestCase):
    """`go get` and `go mod tidy` fail on the network as often as on the SDK."""

    def test_a_fetch_failure_is_not_called_a_source_migration(self):
        decision = decision_for("sdk-could-not-be-fetched")
        row = decision["sdk"]["rows"][0]
        self.assertEqual((row["status"], row["source_step"]), ("unresolved", "get"))
        self.assertEqual(report._sdk_link(row), "none tested: the SDK did not resolve")
        self.assertNotEqual(report._sdk_link(row), report.SOURCE_LINK)
        # It still reaches a person: if it repeats, the output says why.
        self.assertEqual(decision["issue"]["action"], "upsert")
        self.assertEqual(decision["counts"]["outstanding"], 1)

    def test_an_open_sdk_pr_survives_a_fetch_failure(self):
        self.assertEqual(decision_for("sdk-could-not-be-fetched")["sdk"]["pr"], "skip")

    def test_tidy_is_treated_like_get(self):
        plan = support.run_scenario("sdk-could-not-be-fetched")[1]
        legs = {name: {"source": "failure", "source_step": "tidy", "source_log": "x"} for name in ("sdk-release-0.1.0", "sdk-release-0.1.2")}
        row = outcomes.decide(plan, support.leg_results(plan, legs))["sdk"]["rows"][0]
        self.assertEqual(row["status"], "unresolved")
        self.assertIn("`go mod tidy` failed", report._sdk_result(row))

    def test_a_real_compile_failure_outweighs_a_fetch_failure_on_another_leg(self):
        plan = support.run_scenario("sdk-could-not-be-fetched")[1]
        legs = {
            "sdk-release-0.1.0": {"source": "failure", "source_step": "get", "source_log": "i/o timeout"},
            "sdk-release-0.1.2": {"source": "failure", "source_step": "build", "source_log": "undefined: x"},
        }
        row = outcomes.decide(plan, support.leg_results(plan, legs))["sdk"]["rows"][0]
        self.assertEqual((row["status"], row["source_step"], row["source_log"]), ("source", "build", "undefined: x"))

    def test_at_head_it_is_only_an_early_warning(self):
        plan = support.run_scenario("only-dev-fails")[1]
        legs = {name: {"source": "failure", "source_step": "get", "source_log": "i/o timeout"} for name in ("sdk-latest-0.1.0", "sdk-latest-0.1.2")}
        decision = outcomes.decide(plan, support.leg_results(plan, legs))
        self.assertEqual(decision["issue"]["title"], "Compat sweep: early warning from upstream HEAD")
        self.assertIn("Early warning only: nothing to merge. Not a result yet", report.render_issue(decision)[1])

    def test_a_step_the_check_does_not_have_is_not_a_result(self):
        for step in ("", "compile", None):
            self.assertEqual(outcomes.sdk_leg_outcome("failure", step, "skipped", "skipped", "skipped", "skipped"), "no_result")


class SdkDropsFloor(unittest.TestCase):
    def setUp(self):
        self.decision = decision_for("sdk-drops-floor")
        self.row = self.decision["sdk"]["rows"][0]

    def test_reported_as_dropping_the_floor(self):
        self.assertEqual(self.row["status"], "wire")
        self.assertEqual(self.row["dropped"], ["0.1.0"])
        self.assertTrue(self.row["drops_floor"])
        self.assertIn("This SDK would drop gateway 0.1.0, the floor", report._sdk_action(self.row, self.decision))

    def test_no_pr_a_person_decides(self):
        self.assertIsNone(self.decision["sdk"]["bump"])
        self.assertEqual(self.decision["sdk"]["pr"], "close")
        self.assertIn("a person decides", report._sdk_action(self.row, self.decision))

    def test_dropping_a_lane_that_is_not_the_floor_reads_differently(self):
        plan = support.run_scenario("sdk-drops-floor")[1]
        decision = outcomes.decide(plan, support.leg_results(plan, {"sdk-release-0.1.2": {"compat": "failure"}}))
        row = decision["sdk"]["rows"][0]
        self.assertFalse(row["drops_floor"])
        self.assertIn("would drop gateway 0.1.2, which we support", report._sdk_action(row, decision))
        self.assertIsNone(decision["sdk"]["bump"])

    def test_failing_every_lane_is_not_a_bump_at_all(self):
        plan = support.run_scenario("sdk-drops-floor")[1]
        legs = {"sdk-release-0.1.0": {"compat": "failure"}, "sdk-release-0.1.2": {"compat": "failure"}}
        decision = outcomes.decide(plan, support.leg_results(plan, legs))
        row = decision["sdk"]["rows"][0]
        self.assertIn("works with none of the gateways we support", report._sdk_action(row, decision))

    def test_a_gateway_that_did_not_start_is_inconclusive_not_a_drop(self):
        plan = support.run_scenario("sdk-drops-floor")[1]
        decision = outcomes.decide(plan, support.leg_results(plan, {"sdk-release-0.1.0": {"stack": "failure"}}))
        row = decision["sdk"]["rows"][0]
        self.assertEqual((row["status"], row["dropped"]), ("stack", []))
        self.assertIsNone(decision["sdk"]["bump"])
        self.assertIn("Inconclusive", report._sdk_action(row, decision))


class SdkPassesEverywhere(unittest.TestCase):
    def setUp(self):
        self.decision = decision_for("sdk-passes-everywhere")
        self.before = support.fixture("pins.json")

    def test_the_bump_is_the_release_tag_commit(self):
        bump = self.decision["sdk"]["bump"]
        self.assertEqual(bump["tag"], "v0.1.3")
        self.assertEqual(bump["version"], "v0.0.0-20261012090000-a0130000a013")
        self.assertEqual(bump["lanes"], ["0.1.0", "0.1.2"])
        self.assertEqual(bump["from"], self.before["sdk"])

    def test_the_sdk_pr_changes_go_mod_go_sum_and_the_sdk_field_only(self):
        after = pins.set_sdk(self.before, self.decision["sdk"]["bump"]["version"])
        changed = [guard.GO_MOD, guard.GO_SUM, guard.PINS_FILE]
        self.assertEqual(guard.check_changes("sdk", changed, self.before, after), [])
        self.assertEqual(after["lanes"], self.before["lanes"])
        self.assertEqual(pins.supported_range(after), pins.supported_range(self.before))

    def test_no_gateway_pr_in_the_same_run(self):
        self.assertIsNone(self.decision["gateway"]["bump"])


class IncompleteRuns(unittest.TestCase):
    def test_a_missing_leg_closes_nothing_and_opens_nothing(self):
        decision = decision_for("leg-did-not-report")
        self.assertTrue(decision["incomplete"])
        self.assertEqual(decision["issue"]["action"], "keep")
        self.assertEqual(decision["gateway"]["pr"], "skip")
        self.assertIsNone(decision["gateway"]["bump"])

    def test_no_results_at_all_touches_nothing(self):
        plan = support.run_scenario("newer-release-passes")[1]
        decision = outcomes.decide(plan, [])
        self.assertTrue(decision["incomplete"])
        self.assertEqual(decision["issue"]["action"], "keep")
        self.assertEqual((decision["gateway"]["pr"], decision["sdk"]["pr"]), ("skip", "skip"))

    def test_a_known_failure_is_still_reported_when_another_leg_is_missing(self):
        plan = support.run_scenario("newer-release-passes")[1]
        legs = {"gateway-0.1.1": {"compat": "failure"}, "gateway-0.1.3": None}
        decision = outcomes.decide(plan, support.leg_results(plan, legs))
        self.assertEqual(decision["issue"]["action"], "upsert")
        self.assertTrue(decision["incomplete"])
        self.assertIn("This run is INCOMPLETE", report.render_issue(decision)[1])

    def test_a_failing_lane_settles_the_sdk_even_when_another_lane_is_missing(self):
        plan = support.run_scenario("newer-release-passes")[1]
        legs = {"sdk-release-0.1.0": {"compat": "failure"}, "sdk-release-0.1.2": None}
        decision = outcomes.decide(plan, support.leg_results(plan, legs))
        row = decision["sdk"]["rows"][0]
        self.assertEqual((row["status"], row["drops_floor"]), ("wire", True))
        self.assertEqual(decision["sdk"]["pr"], "close")
        self.assertIn("gateway 0.1.2 no result", report.render_issue(decision)[1])

    def test_a_missing_sdk_leg_holds_the_sdk_pr(self):
        plan = support.run_scenario("newer-release-passes")[1]
        decision = outcomes.decide(plan, support.leg_results(plan, {"sdk-release-0.1.0": None}))
        self.assertEqual(decision["sdk"]["pr"], "skip")
        self.assertIsNone(decision["sdk"]["bump"])
        # The gateway axis has all its results and is unaffected.
        self.assertEqual(decision["gateway"]["pr"], "open")


class NarrowedRuns(unittest.TestCase):
    """A run that did not look at everything reports what it saw and closes nothing."""

    def test_a_narrowed_run_still_reports_what_it_finds(self):
        plan = support.run_scenario("narrowed-run-keeps-the-issue")[1]
        decision = outcomes.decide(plan, support.leg_results(plan, {"gateway-0.1.2": {"compat": "failure"}}))
        self.assertEqual(decision["issue"]["action"], "upsert")

    def test_a_scheduled_run_is_never_narrowed(self):
        # No cap and HEAD probed: nothing in or above the range is left out.
        plan = support.run_scenario("nothing-newer-released")[1]
        self.assertEqual(plan["inputs"], {"max_versions": None, "include_head": True, "since": None})
        self.assertEqual(outcomes._narrowed(plan), [])
        self.assertEqual(decision_for("nothing-newer-released")["issue"]["action"], "close")

    def test_a_cap_that_leaves_nothing_in_the_range_out_narrows_nothing(self):
        plan = candidates.build_plan(
            support.fixture("pins.json"), support.FakeUpstream(support.upstream_data()), max_versions=3
        )
        self.assertEqual(plan["gateway"]["not_swept"], [])
        self.assertEqual(outcomes.decide(plan, support.leg_results(plan))["issue"]["action"], "close")

    def test_what_since_leaves_out_below_the_floor_narrows_nothing(self):
        plan = candidates.build_plan(
            support.fixture("pins.json"), support.FakeUpstream(support.upstream_data()), max_versions=3, since="0.0.115"
        )
        self.assertEqual(plan["gateway"]["not_swept"], ["0.0.116", "0.0.115"])
        decision = outcomes.decide(plan, support.leg_results(plan))
        self.assertEqual(decision["issue"]["action"], "close")
        self.assertIn("Also left out by max_versions: `0.0.116` and `0.0.115`.", report.render_summary(decision))


class CeilingRules(unittest.TestCase):
    def test_the_ceiling_never_moves_past_a_failing_release(self):
        decision = decision_for("ceiling-held-by-failing-release")
        rows = {row["version"]: row for row in decision["gateway"]["rows"]}
        self.assertEqual(rows["0.1.4"]["status"], "held")
        self.assertEqual(rows["0.1.4"]["held_by"], "0.1.3")
        self.assertIsNone(decision["gateway"]["bump"])

    def test_the_ceiling_moves_to_the_newest_of_an_unbroken_run(self):
        plan = support.run_scenario("ceiling-held-by-failing-release")[1]
        decision = outcomes.decide(plan, support.leg_results(plan))
        rows = {row["version"]: row for row in decision["gateway"]["rows"]}
        self.assertEqual(decision["gateway"]["bump"]["version"], "0.1.4")
        self.assertEqual((rows["0.1.4"]["status"], rows["0.1.3"]["status"]), ("bump", "ok"))
        self.assertIn("The ceiling moves past it to 0.1.4.", report.render_summary(decision))

    def test_the_ceiling_stops_below_the_first_failure(self):
        plan = support.run_scenario("ceiling-held-by-failing-release")[1]
        decision = outcomes.decide(plan, support.leg_results(plan, {"gateway-0.1.4": {"compat": "failure"}}))
        self.assertEqual(decision["gateway"]["bump"]["version"], "0.1.3")
        self.assertEqual(decision["issue"]["action"], "upsert")

    def test_a_failing_release_holds_the_ceiling_however_many_pass_above_it(self):
        # The default run of the scenario that used to close the issue and
        # open a PR for 0.1.8: five releases above the one that fails.
        scenario = support.fixture("scenarios/cap-cannot-hide-a-failing-release.json")
        for cap in (None, 1, 5):
            plan = candidates.build_plan(
                support.fixture("pins.json"),
                support.FakeUpstream(support.upstream_data(scenario["upstream"])),
                max_versions=cap,
            )
            decision = outcomes.decide(plan, support.leg_results(plan, scenario["legs"]))
            with self.subTest(max_versions=cap):
                self.assertIsNone(decision["gateway"]["bump"])
                self.assertEqual(decision["gateway"]["pr"], "close")
                self.assertEqual(decision["issue"]["action"], "upsert")
                rows = {row["version"]: row for row in decision["gateway"]["rows"]}
                self.assertEqual(rows["0.1.3"]["status"], "wire")
                self.assertEqual((rows["0.1.8"]["status"], rows["0.1.8"]["held_by"]), ("held", "0.1.3"))

    def test_a_release_without_an_image_holds_the_ceiling_only_above_itself(self):
        # 0.1.3 passes, 0.1.4 has no image, 0.1.5 passes: the ceiling moves to
        # 0.1.3 and no further, and the issue is not closed over the hole.
        patch = {"tags": [], "images": {}, "sdk": {}}
        for n in (3, 4, 5):
            commit = ("d%03d0000" % n) * 5
            patch["tags"].append("%s\trefs/tags/v0.1.%d" % (commit, n))
            patch["sdk"][commit] = "v0.0.0-202611%02d090000-%s" % (n, commit[:12])
            if n != 4:
                patch["images"]["gateway:0.1.%d" % n] = "sha256:" + "%02d" % n * 32
                patch["images"]["supervisor:0.1.%d" % n] = "sha256:" + "%02d" % (n + 50) * 32
        patch["sdk"]["latest"] = patch["sdk"][("d0050000") * 5]
        plan = candidates.build_plan(support.fixture("pins.json"), support.FakeUpstream(support.upstream_data(patch)))
        decision = outcomes.decide(plan, support.leg_results(plan))
        rows = {row["version"]: row for row in decision["gateway"]["rows"]}
        self.assertEqual(decision["gateway"]["bump"]["version"], "0.1.3")
        self.assertEqual(decision["gateway"]["pr"], "open")
        self.assertEqual((rows["0.1.5"]["status"], rows["0.1.5"]["held_by"], rows["0.1.5"]["held_why"]), ("held", "0.1.4", "unswept"))
        self.assertEqual(decision["issue"]["action"], "keep")

    def test_a_plan_that_left_a_release_above_the_ceiling_out_proposes_nothing(self):
        # candidates.py never does this; decide() must not depend on that.
        plan = support.run_scenario("ceiling-held-by-failing-release")[1]
        plan["gateway"]["candidates"] = [c for c in plan["gateway"]["candidates"] if c["version"] != "0.1.3"]
        plan["gateway"]["not_swept"] = ["0.1.3"]
        decision = outcomes.decide(plan, support.leg_results(plan))
        rows = {row["version"]: row for row in decision["gateway"]["rows"]}
        self.assertIsNone(decision["gateway"]["bump"])
        self.assertEqual(decision["gateway"]["pr"], "skip")
        self.assertEqual((rows["0.1.4"]["status"], rows["0.1.4"]["held_by"]), ("held", "0.1.3"))
        self.assertEqual(decision["issue"]["action"], "keep")

    def test_a_gateway_that_could_not_be_set_up_holds_the_ceiling_too(self):
        plan = support.run_scenario("ceiling-held-by-failing-release")[1]
        for step in ("pull", "stack", "bff"):
            decision = outcomes.decide(plan, support.leg_results(plan, {"gateway-0.1.3": {step: "failure"}}))
            rows = {row["version"]: row for row in decision["gateway"]["rows"]}
            with self.subTest(step=step):
                self.assertEqual(rows["0.1.3"]["status"], "stack")
                self.assertEqual((rows["0.1.4"]["status"], rows["0.1.4"]["held_why"]), ("held", "setup"))
                self.assertIsNone(decision["gateway"]["bump"])

    def test_a_long_title_is_cut_before_github_refuses_it(self):
        plan = support.run_scenario("cap-cannot-hide-a-failing-release")[1]
        legs = {c["id"]: {"compat": "failure"} for c in plan["gateway"]["candidates"]}
        for n in range(40):
            plan["gateway"]["candidates"].append(dict(plan["gateway"]["candidates"][0], id="gateway-0.9.%d" % n, version="0.9.%d" % n))
            legs["gateway-0.9.%d" % n] = {"compat": "failure"}
        title = outcomes.decide(plan, support.leg_results(plan, legs))["issue"]["title"]
        self.assertLessEqual(len(title), outcomes.TITLE_LIMIT)
        self.assertTrue(title.endswith(" ..."))

    def test_a_release_below_the_floor_is_informational(self):
        decision = decision_for("probe-below-the-floor")
        row = [r for r in decision["gateway"]["rows"] if r["version"] == "0.0.116"][0]
        self.assertEqual((row["position"], row["status"], row["outcome"]), ("below", "info", "incompatible"))
        self.assertEqual(decision["counts"]["outstanding"], 0)

    def test_a_passing_release_below_the_floor_never_opens_a_pr(self):
        plan = support.run_scenario("probe-below-the-floor")[1]
        decision = outcomes.decide(plan, support.leg_results(plan))
        self.assertIsNone(decision["gateway"]["bump"])
        self.assertIn("the floor could be lowered by adding a required lane", report.render_summary(decision))


class SdkPullRequests(unittest.TestCase):
    """What a run that does not propose the SDK change does with the open PR."""

    def pr(self, tag):
        return {"number": 91, "title": report.SDK_TITLE % tag, "headRefName": report.SDK_BRANCH, "isCrossRepository": False}

    def test_a_pr_for_a_release_this_run_did_not_retest_is_left_open(self):
        decision = decision_for("newer-sdk-fails-older-pr-open")
        self.assertEqual(decision["sdk"]["pr"], "close")
        verdict = prs.close_decision("sdk", decision, self.pr("v0.1.3"), RUN_URL)
        self.assertEqual(verdict["action"], "leave")
        self.assertEqual(verdict["comment"], "")
        self.assertIn("it proposes the SDK at v0.1.3; this run tried the newer v0.1.4, which did not pass", verdict["why"])
        self.assertIn("v0.1.3 was not retested", verdict["why"])

    def test_a_pr_for_the_release_this_run_retested_is_closed(self):
        decision = decision_for("newer-sdk-fails-older-pr-open")
        verdict = prs.close_decision("sdk", decision, self.pr("v0.1.4"), RUN_URL)
        self.assertEqual((verdict["action"], verdict["number"]), ("close", 91))
        self.assertIn("retested the SDK at v0.1.4 and no longer proposes this change", verdict["comment"])
        self.assertIn(RUN_URL, verdict["comment"])


class LegOutcomes(unittest.TestCase):
    def test_gateway_leg(self):
        self.assertEqual(outcomes.gateway_leg_outcome("success", "success", "success", "success"), "compatible")
        self.assertEqual(outcomes.gateway_leg_outcome("success", "success", "success", "failure"), "incompatible")
        # No stack means the suite never ran, whatever its step says.
        self.assertEqual(outcomes.gateway_leg_outcome("success", "failure", "skipped", "skipped"), "stack_failed")
        self.assertEqual(outcomes.gateway_leg_outcome("success", "skipped", "skipped", "skipped"), "stack_failed")

    def test_the_first_step_that_did_not_succeed_names_what_happened(self):
        self.assertEqual(outcomes.gateway_leg_outcome("failure", "skipped", "skipped", "skipped"), "pull_failed")
        self.assertEqual(outcomes.gateway_leg_outcome("success", "success", "failure", "skipped"), "bff_failed")
        # None of them is a compat result, whatever the later steps claim.
        for outcome in ("pull_failed", "stack_failed", "bff_failed"):
            self.assertIn(outcome, outcomes.SETUP_FAILED)
        self.assertEqual(outcomes.gateway_leg_outcome("failure", "success", "success", "success"), "pull_failed")

    def test_sdk_leg(self):
        ok = ("success", "", "success", "success", "success")
        self.assertEqual(outcomes.sdk_leg_outcome(*ok, "success"), "compatible")
        self.assertEqual(outcomes.sdk_leg_outcome(*ok, "failure"), "incompatible")
        self.assertEqual(outcomes.sdk_leg_outcome("success", "", "success", "failure", "skipped", "skipped"), "stack_failed")
        self.assertEqual(outcomes.sdk_leg_outcome("success", "", "failure", "skipped", "skipped", "skipped"), "pull_failed")
        self.assertEqual(outcomes.sdk_leg_outcome("success", "", "success", "success", "failure", "skipped"), "bff_failed")

    def test_a_build_failure_is_never_a_gateway_outcome(self):
        for step in outcomes.PROVE_STEPS:
            for stack in ("success", "failure", "skipped"):
                for compat in ("success", "failure", "skipped"):
                    self.assertEqual(
                        outcomes.sdk_leg_outcome("failure", step, "success", stack, "success", compat), "source_incompatible"
                    )

    def test_a_fetch_failure_is_neither_a_build_failure_nor_a_gateway_outcome(self):
        for step in outcomes.RESOLVE_STEPS:
            self.assertEqual(
                outcomes.sdk_leg_outcome("failure", step, "skipped", "skipped", "skipped", "skipped"), "sdk_unresolved"
            )


if __name__ == "__main__":
    unittest.main()
