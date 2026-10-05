#!/usr/bin/env bash
# Prints the version that was released from a commit, or nothing when none was.
#
#   deploy/ci/released-version.sh <commit>     (run from the repository root)
#
# publish.yml uses the answer to decide whether that commit's image gets a
# version tag, so "released" has to mean more than "tagged".
#
# semantic-release tags the commit vX.Y.Z and pushes the tag BEFORE it runs
# `npm publish` and creates the GitHub release. When one of those fails the
# run is red, but the tag stays. Run it again and it finds the tag, concludes
# there is nothing to release and exits 0. A lookup by tag alone would then
# report a release that npm and GitHub never received, and the image would be
# tagged X.Y.Z for it. No later run publishes X.Y.Z either, because the tag
# exists.
#
# So a tag only counts once npm has the version and GitHub has the release. If
# either is missing this fails and says how to finish the release by hand. If
# it cannot find out (registry or API unreachable) it also fails, and says so:
# it never reports a release it could not confirm.
#
# Both are asked several times before a "no" is believed, because this runs
# seconds after the publish and a registry may take a moment to show a new
# version. RELEASE_CHECK_ATTEMPTS and RELEASE_CHECK_INTERVAL (seconds) set how
# often and how far apart; the defaults wait up to about two minutes.
#
# Needs git, jq, npm and gh. gh needs GH_TOKEN and GITHUB_REPOSITORY, as in a
# workflow. Reading a public package from npm needs no credentials.
set -euo pipefail

sha=${1:?usage: released-version.sh <commit>}
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY must name the repository, e.g. owner/name}"
attempts=${RELEASE_CHECK_ATTEMPTS:-12}
interval=${RELEASE_CHECK_INTERVAL:-10}

tag=$(git tag --points-at "$sha" --list 'v[0-9]*' --sort=-v:refname | head -n 1)
if [ -z "$tag" ]; then
  echo "No release was cut from $sha." >&2
  exit 0
fi
version=${tag#v}
package=$(jq -er '.name' frontend/package.json)

# Each check sets its variable to yes, no or unknown. "unknown" is anything
# that is not a clear answer; it must never be read as either of the others.
on_npm=unknown
on_github=unknown
detail=''

check_npm() {
  local out rc
  out=$(npm view "$package@$version" version --json 2>/dev/null) && rc=0 || rc=$?
  if [ "$rc" = 0 ] && [ "$(jq -r 'strings' <<<"$out" 2>/dev/null)" = "$version" ]; then
    on_npm=yes
  elif [ "$rc" = 0 ] && [ -z "$out" ]; then
    # Older npm CLIs print nothing, and exit 0, for a version that is not there.
    on_npm=no
  elif [ "$(jq -r '.error.code? // empty' <<<"$out" 2>/dev/null)" = E404 ]; then
    on_npm=no
  else
    on_npm=unknown
    detail="npm view exited $rc"
  fi
}

check_github() {
  local out rc
  out=$(gh release view "$tag" --repo "$GITHUB_REPOSITORY" --json tagName --jq '.tagName' 2>&1) && rc=0 || rc=$?
  if [ "$rc" = 0 ] && [ "$out" = "$tag" ]; then
    on_github=yes
  elif grep -qiE 'release not found|HTTP 404' <<<"$out"; then
    on_github=no
  else
    on_github=unknown
    detail="gh exited $rc: $out"
  fi
}

for attempt in $(seq 1 "$attempts"); do
  check_npm
  check_github
  if [ "$on_npm" = yes ] && [ "$on_github" = yes ]; then
    echo "Released $tag from $sha: $package@$version is on npm and GitHub has the release." >&2
    echo "$version"
    exit 0
  fi
  if [ "$attempt" != "$attempts" ]; then
    echo "Not confirmed yet (npm: $on_npm, GitHub release: $on_github); asking again in ${interval}s." >&2
    sleep "$interval"
  fi
done

fail() {
  # ::error:: makes the line an annotation on the workflow run.
  echo "::error::$1" >&2
  exit 1
}

if [ "$on_npm" = unknown ] || [ "$on_github" = unknown ]; then
  fail "Tag $tag exists, but the release could not be confirmed (npm: $on_npm, GitHub release: $on_github; $detail). Nothing was tagged. Run this job again."
fi
if [ "$on_npm" = no ]; then
  # Nothing reached npm, so the release can simply be cut again. The GitHub
  # plugin runs after the npm one, so there is no GitHub release either unless
  # somebody made one by hand.
  fail "Release $version is only half done: tag $tag exists, but npm has no $package@$version. semantic-release pushed the tag and then failed, and it will not publish this version while the tag exists. Check with 'npm view $package@$version version' that it really is missing. If it is, delete the tag and its note and run this workflow again:  git push origin :refs/tags/$tag :refs/notes/semantic-release-$tag"
fi
# npm refuses to take the same version twice, so here the tag has to stay.
fail "Release $version is only half done: npm has $package@$version, but GitHub has no release for $tag. Do NOT delete the tag: npm will not accept $version a second time. Create the release by hand, then re-run this job:  gh release create $tag --repo $GITHUB_REPOSITORY --verify-tag --generate-notes --latest=false"
