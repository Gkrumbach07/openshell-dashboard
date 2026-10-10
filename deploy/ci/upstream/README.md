# Following upstream

Everything `.github/workflows/follow-upstream.yml` decides, and the pins
validation `ci.yml` runs on every PR, lives here as plain Python so it can be
run and tested without a runner, a network or a container. The decision behind
it is [ADR 0009](../../../docs/adrs/0009-console-release-policy.md), decisions
6 to 8.

Standard library only. Works on Python 3.9 and newer. The tests need `git`.

```bash
python3 -m unittest discover -s deploy/ci/upstream -v     # the tests
python3 deploy/ci/upstream/follow.py validate-pins        # check gateway-pins.json
python3 deploy/ci/upstream/follow.py format-pins          # rewrite it in canonical form after a hand edit
python3 deploy/ci/upstream/follow.py require-stable       # fail if it names a pre-release
python3 deploy/ci/upstream/follow.py plan --out /tmp/plan.json   # what is upstream ahead of this branch?
```

`plan` asks the real upstream (`git ls-remote`, and `docker buildx imagetools
inspect` for the target's image digests). It only reads; it starts nothing.

## One release per branch

`deploy/ci/gateway-pins.json` names the one OpenShell release a branch is
built on. The gateway and supervisor images and the Go SDK all come from that
release's tag and move together, in one commit.

| Branch | Pins | Who moves it |
|---|---|---|
| `main` | a stable release, `X.Y.Z` | the merge of `next` |
| `release/X.Y` | a stable release of the line before `main`'s | a person, for critical and security fixes |
| `next` | the upcoming release: a pre-release `X.Y.Z-pre.N`, then the stable release | this workflow |

`ci.yml` runs the compatibility suite against the pinned gateway for every
change, whichever of these it merges into. Its `pins a stable release` check
fails for a pull request into `main` or `release/**` whose pins name a
pre-release. That is what keeps `next` from merging early, and it is a check
of its own so that it is not read as a compatibility failure.

## What the workflow does, every hour

1. **Plan.** Read upstream's tags. Only `vX.Y.Z` and `vX.Y.Z-pre.N` count;
   `dev`, `vm-runtime` and anything else are ignored. The target is the newest
   stable release above the one `main` pins. If there is none, it is the newest
   pre-release that leads up to a release above it. If there is none of those
   either, there is nothing to do. Several stable releases waiting are not
   walked through: the branch goes straight to the newest. The target's image
   digests are resolved once, here, so check A tests what `next` pins.
2. **`next`.** Keep the branch in this shape:

   ```
   main ── fix: move to OpenShell X.Y.Z ── a person's commit ── another ...
   ```

   - No `next`: create it from `main` and make the pin move.
   - `main` moved: rebase `next` onto it. Not otherwise.
   - The target changed: make the move again on top, as an `amend!` commit, and
     fold it into the first commit with `git rebase --autosquash`. There is
     always one pin commit and it is always first. It is recognised by its
     `OpenShell-Release:` trailer.
   - Push with `--force-with-lease`, and keep the pull request `next` → `main`:
     a draft while the pin is a pre-release, ready for review once it is the
     stable release, titled `fix: move to OpenShell X.Y.Z`.
   - A stable target on a new minor: create `release/<old line>` from `main`
     first, if it does not exist.
   - Nothing ahead and nothing but the pin move on it, or its pull request
     merged: delete it.
3. **Check A.** Build the BFF from `main` as it is, start the target's gateway
   by digest, run the compatibility suite. A failure goes to one issue,
   labelled `compat-migrate`, rewritten in place and closed when it passes.
4. **Check B** has no job here. It is `ci.yml` running on the `next` pull
   request: the console built on the target's SDK against the target's gateway.

| | Console | Gateway | Tells you |
|---|---|---|---|
| check A | `main`, on the SDK it ships with | the target | whether a console that is installed today keeps working |
| check B | `next`, on the target's SDK | the target | whether the move will pass on release day |

## A pin move

`pinmove.py`, and nothing else, changes:

| File | What moves |
|---|---|
| `deploy/ci/gateway-pins.json` | `release`, `gateway_image`, `supervisor_image`, `sdk` |
| `backend/go.mod`, `backend/go.sum` | the SDK, with `go get <module>@<tag's commit>` and `go mod tidy`. Never `@latest` |
| `backend/pkg/models/gateway_release_line.go` | the built-in line, only when the minor changes |
| `README.md` | the generated block, with `scripts/readme-gateway-range.mjs --write` |

The workload image and the config schema are carried over. A release that
needs a new config schema fails the compatibility suite, and a person adds
the template.

## Conflicts

A conflict in a lock file is resolved by regenerating it: `backend/go.sum`
with `go mod tidy`, `frontend/package-lock.json` with `npm install
--package-lock-only --ignore-scripts`. Any other conflict aborts the rebase.
Nothing is pushed, so `next` is exactly as it was, and the pull request gets
one comment naming the files. The comment is not repeated while `next` and the
files in conflict stay the same.

To carry on, rebase `next` onto `main` by hand, resolve, and force-push. The
next run takes it from there.

## Who may write

| Job | Permissions | Runs |
|---|---|---|
| `plan` | `contents: read` | this directory's code, `git ls-remote`, registry lookups |
| `next` | `contents: write`, `pull-requests: write` | git, `go get`, `go mod tidy`, the README script, and for a lock file `npm install --package-lock-only --ignore-scripts`. No build, no test, no container |
| `check-a` | `contents: read` | upstream's gateway image, the BFF, the compat suite |
| `report` | `contents: read`, `issues: write` | this directory's code and `gh issue` |

In the `next` job the token is handed to two steps only: the one that lists
the pull requests from `next`, and `follow.py publish`, which runs `git push`
and `gh` with the arguments the tokenless step before it chose and refuses
anything else. The scripts it runs come from the commit the workflow runs at,
never from the tree it is changing. `tests/test_workflows.py` and
`tests/test_publish.py` enforce all of this.

Only a pull request whose head is `next` in **this** repository is ever
created, rewritten, commented on or closed. `gh pr list --head next` also
matches a fork's branch of the same name; `publish.py` picks ours.

## Settings it depends on

| | Without it |
|---|---|
| Secret `UPSTREAM_BOT_TOKEN`: a fine-grained or GitHub App token with Contents, Pull requests and Workflows read/write | The workflow's default token is used. CI then does not start on the `next` pull request by itself (close and reopen it). That token may never create or update a workflow file, so GitHub can also refuse the push of a `next` rebased onto a `main` that changed one; the run fails with a message that says so |
| Setting *Allow GitHub Actions to create and approve pull requests* (needed only with the default token) | The pull request cannot be opened. The run fails with a message that says so, and a `next` it had just created is deleted again |
| Variable `UPSTREAM_AUTOMERGE` = `true` | Nothing is merged automatically. With it, a ready `next` pull request on a stable release is set to merge by rebase once its required checks pass. The workflow only asks GitHub to turn auto-merge on and never merges a pull request itself, so this also needs *Allow auto-merge* and at least one required check on `main`: with nothing required there is nothing to wait for, and GitHub refuses |

Merging `next` into `main` cuts a patch release by itself once CI has passed
on `main` (`scripts/release/next-merge.mjs`, [docs/releasing.md](../../../docs/releasing.md)).

A manual run is a dry run unless its box is cleared, and a run from any branch
but `main` is always one: it prints what it would push, open and edit.

## Files

| File | What it decides |
|---|---|
| `versions.py` | Which tags are releases, how they order, which one is the target. |
| `pins.py` | Is `gateway-pins.json` well formed and in canonical form? Does it name a stable release? The move to another release. |
| `upstream.py` | What is learned from the network: tags and image digests. Tests replace it. |
| `plan.py` | The target and what moving to it would pin, as data for the other jobs. |
| `pinmove.py` | The pin move, in a working tree. Tests replace the commands it runs. |
| `nextbranch.py` | The git work on `next`: create, rebase, fold a new move into the pin commit, handle conflicts. |
| `publish.py` | Which pull request is ours and every step to take on GitHub (no token), and running those steps (token). |
| `report.py` | The commit message, the pull request, the conflict comment, check A's issue, the run summaries. |
| `follow.py` | The command line the workflows call. |
| `tests/` | `support.py` has the stand-in tools and a throwaway git repository; `fixtures/upstream.json` is a subset of upstream's real tags with the real ghcr.io digests of 2026-10-09. |

## Not done

- **The version of the release that follows a move is always a patch.** For a
  move to a new gateway minor it should be a minor (ADR 0009, decision 2). The
  pull request says so when it applies.
- **`release/<line>` is created, not maintained.** A commit that reaches `main`
  between its creation and the merge of `next` is not on it.
- **A silent drop is still invisible.** The compatibility suite proves what it
  varies. A release that silently drops a request field the suite does not
  vary would pass both checks; the field-by-field diff of the request messages
  that found the last one is not run automatically (ADR 0006, Consequences).
