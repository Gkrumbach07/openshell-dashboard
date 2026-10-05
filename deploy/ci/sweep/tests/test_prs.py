"""The sweep's own pull requests: which one is it, and may this run close it?"""

import unittest

import outcomes
import prs
import report
from tests import support

RUN_URL = "https://example.invalid/actions/runs/1"


def pr(number, title="", branch=report.SDK_BRANCH, cross=False):
    return {"number": number, "title": title, "headRefName": branch, "isCrossRepository": cross}


def decision_for(name):
    return support.run_scenario(name)[3]


class OwnPullRequest(unittest.TestCase):
    """`gh pr list --head <branch>` matches the branch name in every fork."""

    def test_a_same_repository_pr_on_the_branch_is_ours(self):
        self.assertEqual(prs.own_pr([pr(90)], report.SDK_BRANCH)["number"], 90)

    def test_a_fork_pr_with_the_same_branch_name_is_never_ours(self):
        # Anyone can fork the repository and open a pull request from a
        # branch called compat-sweep/sdk; the name is public in the workflow.
        self.assertIsNone(prs.own_pr([pr(97, cross=True)], report.SDK_BRANCH))

    def test_a_newer_fork_pr_does_not_hide_ours(self):
        # gh lists newest first, so "the first one" used to be the outsider's.
        listed = [pr(97, cross=True), pr(96, cross=True), pr(90)]
        self.assertEqual(prs.own_pr(listed, report.SDK_BRANCH)["number"], 90)

    def test_an_entry_that_does_not_say_it_is_same_repository_is_not_ours(self):
        for entry in ({"number": 90, "headRefName": report.SDK_BRANCH}, pr(90, cross=None), pr(90, cross="false")):
            self.assertIsNone(prs.own_pr([entry], report.SDK_BRANCH))

    def test_a_pr_from_another_branch_is_not_ours(self):
        self.assertIsNone(prs.own_pr([pr(90, branch="compat-sweep/gateway")], report.SDK_BRANCH))
        self.assertIsNone(prs.own_pr([pr(90, branch="x/compat-sweep/sdk")], report.SDK_BRANCH))

    def test_nothing_listed(self):
        self.assertIsNone(prs.own_pr([], report.SDK_BRANCH))
        self.assertIsNone(prs.own_pr(None, report.SDK_BRANCH))

    def test_the_oldest_of_several_is_the_one_the_sweep_keeps_rewriting(self):
        self.assertEqual(prs.own_pr([pr(95), pr(90)], report.SDK_BRANCH)["number"], 90)


class ProposedRelease(unittest.TestCase):
    def test_reads_back_exactly_the_titles_the_sweep_writes(self):
        self.assertEqual(prs.proposed_release("sdk", report.SDK_TITLE % "v0.1.3"), "v0.1.3")
        self.assertEqual(prs.proposed_release("gateway", report.GATEWAY_TITLE % "0.1.3"), "0.1.3")

    def test_a_title_a_person_changed_names_nothing(self):
        for title in ("", None, "fix(sdk): move to the OpenShell SDK", "WIP " + report.SDK_TITLE % "v0.1.3", report.GATEWAY_TITLE % "0.1.3"):
            self.assertIsNone(prs.proposed_release("sdk", title))


class CloseDecision(unittest.TestCase):
    def test_no_pr_nothing_to_do(self):
        verdict = prs.close_decision("sdk", decision_for("sdk-source-incompatible"), None, RUN_URL)
        self.assertEqual((verdict["action"], verdict["number"], verdict["comment"]), ("none", None, ""))

    def test_the_gateway_axis_retests_everything_above_the_ceiling_so_it_may_close(self):
        decision = decision_for("newer-release-fails")
        self.assertEqual(decision["gateway"]["pr"], "close")
        verdict = prs.close_decision("gateway", decision, pr(88, report.GATEWAY_TITLE % "0.1.3", report.GATEWAY_BRANCH), RUN_URL)
        self.assertEqual((verdict["action"], verdict["number"]), ("close", 88))
        self.assertIn("tested every release above the ceiling again and no longer proposes this change", verdict["comment"])
        self.assertIn(RUN_URL, verdict["comment"])

    def test_the_sdk_pr_for_the_release_that_was_retested_is_closed(self):
        decision = decision_for("sdk-source-incompatible")
        self.assertEqual(decision["sdk"]["candidate"], "v0.1.3")
        verdict = prs.close_decision("sdk", decision, pr(90, report.SDK_TITLE % "v0.1.3"), RUN_URL)
        self.assertEqual(verdict["action"], "close")
        self.assertIn("retested the SDK at v0.1.3", verdict["comment"])

    def test_the_sdk_pr_for_an_older_release_is_left_open(self):
        # Only the newest release is tried. v0.1.3 passed last week; this
        # week v0.1.4 exists and fails. Nothing new is known about v0.1.3.
        decision = decision_for("newer-sdk-fails-older-pr-open")
        verdict = prs.close_decision("sdk", decision, pr(90, report.SDK_TITLE % "v0.1.3"), RUN_URL)
        self.assertEqual((verdict["action"], verdict["comment"]), ("leave", ""))
        self.assertIn("v0.1.3 was not retested", verdict["why"])

    def test_a_retitled_sdk_pr_is_left_to_the_person_who_retitled_it(self):
        decision = decision_for("newer-sdk-fails-older-pr-open")
        verdict = prs.close_decision("sdk", decision, pr(90, "my own SDK experiment"), RUN_URL)
        self.assertEqual(verdict["action"], "leave")
        self.assertIn("a person retitled it", verdict["why"])

    def test_when_the_pin_already_caught_up_the_sdk_pr_has_nothing_left_to_move(self):
        decision = decision_for("nothing-newer-released")
        self.assertIsNone(decision["sdk"]["candidate"])
        verdict = prs.close_decision("sdk", decision, pr(90, report.SDK_TITLE % "v0.1.2"), RUN_URL)
        self.assertEqual(verdict["action"], "close")
        self.assertIn("found nothing left to move", verdict["comment"])
        self.assertNotIn("a later sweep opens it again", verdict["comment"])

    def test_no_comment_claims_a_failure_the_run_did_not_see(self):
        # A gateway that did not start is not "it no longer passes".
        plan = support.run_scenario("sdk-drops-floor")[1]
        decision = outcomes.decide(plan, support.leg_results(plan, {"sdk-release-0.1.0": {"stack": "failure"}}))
        self.assertEqual(decision["sdk"]["pr"], "close")
        verdict = prs.close_decision("sdk", decision, pr(90, report.SDK_TITLE % "v0.1.3"), RUN_URL)
        self.assertNotIn("no longer passes", verdict["comment"])
        self.assertIn("or what could not be tested", verdict["comment"])


if __name__ == "__main__":
    unittest.main()
