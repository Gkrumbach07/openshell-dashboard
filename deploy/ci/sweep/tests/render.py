"""Print what a sweep would report for a fixture scenario.

    python3 deploy/ci/sweep/tests/render.py                       # list scenarios
    python3 deploy/ci/sweep/tests/render.py sdk-source-incompatible
    python3 deploy/ci/sweep/tests/render.py newer-release-passes --pr gateway

For reading the wording without waiting for a real sweep. Not a test.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import report  # noqa: E402
from tests import support  # noqa: E402

REPO_URL = "https://github.com/Gkrumbach07/openshell-dashboard"
RUN_URL = REPO_URL + "/actions/runs/0"


def main(argv):
    if not argv:
        print("\n".join(support.scenario_names()))
        return 0
    scenario, _, _, decision = support.run_scenario(argv[0])
    if "--pr" in argv:
        axis = argv[argv.index("--pr") + 1]
        if not decision[axis]["bump"]:
            print("This scenario proposes nothing on the %s axis, so there is no PR text." % axis)
            return 1
        text = report.render_pr(axis, decision, RUN_URL, has_sweep_token=False, repo_url=REPO_URL)
        print("TITLE: %s\n\n%s\n--- commit message ---\n%s" % (text["title"], text["body"], text["commit"]))
        return 0
    print("SCENARIO: %s\n" % scenario["description"])
    print(
        "issue: %s | gateway PR: %s | SDK PR: %s\n"
        % (decision["issue"]["action"], decision["gateway"]["pr"], decision["sdk"]["pr"])
    )
    title, body = report.render_issue(decision, RUN_URL, REPO_URL)
    if decision["issue"]["action"] == "upsert":
        print("ISSUE TITLE: %s\n\n%s" % (title, body))
    else:
        print("No issue is written for this run. Step summary:\n\n%s" % report.render_summary(decision, RUN_URL, REPO_URL))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
