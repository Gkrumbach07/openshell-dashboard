#!/usr/bin/env bash
# Is COMMIT still the tip of BRANCH on REMOTE?
#
#   scripts/branch-tip.sh REMOTE BRANCH COMMIT
#   scripts/branch-tip.sh origin main "$GITHUB_SHA" | tee -a "$GITHUB_OUTPUT"
#
# ci.yml's promote-latest job asks this before it moves `latest`, because a
# workflow run is not always about the newest commit. A run can be re-run for
# thirty days and keeps the commit it was first started for, so "Re-run failed
# jobs" on last week's red run would otherwise finish green and point `latest`
# at last week's commit. `latest` must only ever move forward: a run that is no
# longer for the tip of main leaves it alone.
#
# It asks the remote, not the local checkout. The checkout is of COMMIT, so
# locally COMMIT always looks like the newest thing there is.
#
# Prints key=value lines for $GITHUB_OUTPUT and explains itself on stderr:
#
#   is_tip=true    COMMIT is what REMOTE's BRANCH points at
#   is_tip=false   BRANCH has moved on (or back); the caller stands down
#   tip=<sha>      what BRANCH points at
#
# Exits 1 when the remote cannot be read or has no such branch. That is not
# "false": nothing is known, so the caller should fail rather than quietly skip.
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "usage: $0 REMOTE BRANCH COMMIT" >&2
  exit 2
fi

remote="$1"
branch="$2"
commit="$3"

# --exit-code makes "no such branch" a failure instead of empty output.
if ! listing="$(git ls-remote --exit-code "$remote" "refs/heads/${branch}")"; then
  echo "::error::could not read refs/heads/${branch} from ${remote}, so it is not known" \
       "whether ${commit} is still its tip." >&2
  exit 1
fi
tip="${listing%%[[:space:]]*}"

if [ "$tip" = "$commit" ]; then
  echo "${commit} is the tip of ${branch}" >&2
  echo "is_tip=true"
else
  echo "::notice::${branch} is at ${tip}, and this run is for ${commit}. Standing down:" \
       "the run for ${tip} decides what happens next." >&2
  echo "is_tip=false"
fi
echo "tip=${tip}"
