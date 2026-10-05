#!/usr/bin/env bash
# Tests for released-version.sh. Run by the check-scripts job in ci.yml:
#
#   deploy/ci/released-version.test.sh
#
# It builds a throwaway git repository with one tagged and one untagged commit
# and puts stand-ins for `npm` and `gh` first on PATH. Nothing here reaches the
# network, npm, GitHub or this repository's own tags.
set -euo pipefail

script=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/released-version.sh
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

mkdir -p "$work/bin" "$work/repo/frontend"
cd "$work/repo"
git init -q .
# Identity and signing are set here so that a developer's own git configuration
# (a signing key, say) cannot make these two commits and the tag fail.
commit() {
  git -c user.name=test -c user.email=test@example.invalid -c commit.gpgsign=false commit -q "$@"
}
commit --allow-empty -m "a commit no release was cut from"
untagged=$(git rev-parse HEAD)
echo '{"name":"openshell-dashboard"}' >frontend/package.json
git add frontend/package.json
commit -m "the released commit"
tagged=$(git rev-parse HEAD)
git -c tag.gpgsign=false tag v0.2.1

# Stand-in for: npm view <package>@<version> version --json
# STUB_NPM picks the answer. "late" is a registry that only shows the version
# from the third time it is asked.
cat >"$work/bin/npm" <<'EOF'
#!/usr/bin/env bash
echo "npm $*" >>"$STUB_CALLS"
version=${2#*@}
case "$STUB_NPM" in
  present) printf '"%s"\n' "$version" ;;
  missing)
    echo '{"error":{"code":"E404","summary":"No match found for version"}}'
    exit 1
    ;;
  missing-silent) exit 0 ;;
  broken)
    echo '{"error":{"code":"ETIMEDOUT","summary":"request failed"}}'
    exit 1
    ;;
  late)
    if [ "$(grep -c '^npm ' "$STUB_CALLS")" -ge 3 ]; then
      printf '"%s"\n' "$version"
    else
      echo '{"error":{"code":"E404","summary":"No match found for version"}}'
      exit 1
    fi
    ;;
esac
EOF

# Stand-in for: gh release view <tag> --repo <repo> --json tagName --jq .tagName
cat >"$work/bin/gh" <<'EOF'
#!/usr/bin/env bash
echo "gh $*" >>"$STUB_CALLS"
case "$STUB_GH" in
  present) echo "$3" ;;
  missing)
    echo "release not found" >&2
    exit 1
    ;;
  broken)
    echo "error connecting to api.github.com" >&2
    exit 1
    ;;
esac
EOF
chmod +x "$work/bin/npm" "$work/bin/gh"

export PATH="$work/bin:$PATH"
export GITHUB_REPOSITORY=example/openshell-dashboard
export STUB_CALLS="$work/calls"
export RELEASE_CHECK_INTERVAL=0

failures=0
# expect <name> <commit> <npm answer> <gh answer> <attempts> <exit code> <stdout> [<text that must be in stderr>]
expect() {
  local name=$1 commit=$2 want_rc=$6 want_out=$7 want_err=${8:-}
  local out rc
  : >"$STUB_CALLS"
  out=$(STUB_NPM=$3 STUB_GH=$4 RELEASE_CHECK_ATTEMPTS=$5 "$script" "$commit" 2>"$work/stderr") && rc=0 || rc=$?
  if [ "$rc" != "$want_rc" ] || [ "$out" != "$want_out" ] ||
    { [ -n "$want_err" ] && ! grep -qF -- "$want_err" "$work/stderr"; }; then
    failures=$((failures + 1))
    echo "FAIL  $name"
    echo "      exit $rc (want $want_rc), stdout '$out' (want '$want_out')${want_err:+, stderr must contain '$want_err'}"
    sed 's/^/      stderr: /' "$work/stderr"
  else
    echo "ok    $name"
  fi
}

# No tag on the commit: nothing was released, and npm and GitHub are not asked.
expect "no tag: no version, exit 0" "$untagged" broken broken 1 0 ""
if [ -s "$STUB_CALLS" ]; then
  failures=$((failures + 1))
  echo "FAIL  no tag: npm or gh was called: $(cat "$STUB_CALLS")"
fi

expect "tag, npm has it, GitHub has it: the version" "$tagged" present present 1 0 "0.2.1"

# The half-finished release this script exists for: the tag is there, the
# publish failed. It must not report a version, and must say how to recover.
expect "tag only (npm says E404): refused, delete the tag" "$tagged" missing missing 1 1 "" \
  "git push origin :refs/tags/v0.2.1 :refs/notes/semantic-release-v0.2.1"
expect "tag only (npm prints nothing): refused" "$tagged" missing-silent missing 1 1 "" \
  "npm has no openshell-dashboard@0.2.1"

# On npm but no GitHub release: deleting the tag would be wrong here.
expect "npm has it, GitHub does not: refused, keep the tag" "$tagged" present missing 1 1 "" \
  "Do NOT delete the tag"
expect "npm has it, GitHub does not: says how to create the release" "$tagged" present missing 1 1 "" \
  "gh release create v0.2.1 --repo example/openshell-dashboard --verify-tag"

# Not being able to ask is not an answer in either direction.
expect "npm unreachable: refused as unconfirmed, not as missing" "$tagged" broken present 1 1 "" \
  "could not be confirmed"
expect "GitHub unreachable: refused as unconfirmed" "$tagged" present broken 1 1 "" \
  "could not be confirmed"

# A registry that needs a moment is asked again rather than believed at once.
expect "npm shows the version on the third ask: the version" "$tagged" late present 5 0 "0.2.1"
expect "npm would show it on the third ask, but only two are allowed: refused" "$tagged" late present 2 1 ""

if [ "$failures" != 0 ]; then
  echo "$failures check(s) failed"
  exit 1
fi
echo "all checks passed"
