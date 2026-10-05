# Compat sweep logic

Everything `.github/workflows/compat-sweep.yml` decides, and the pins
validation `ci.yml` runs on every PR, lives here as plain Python so it can be
run and tested without a runner, a network or a container. The decision
behind it is [ADR 0006](../../../docs/adrs/0006-compat-links-and-sweep-axes.md).

Standard library only. Works on Python 3.9 and newer.

```bash
python3 -m unittest discover -s deploy/ci/sweep -v     # the tests
python3 deploy/ci/sweep/sweep.py validate-pins          # check gateway-pins.json
python3 deploy/ci/sweep/sweep.py format-pins            # rewrite it in canonical form after a hand edit
python3 deploy/ci/sweep/sweep.py range                  # {"floor": ..., "ceiling": ..., "sdk": ...}
python3 deploy/ci/sweep/tests/render.py                 # list the fixture scenarios
python3 deploy/ci/sweep/tests/render.py sdk-drops-floor # read the report a scenario produces
```

`sweep.py plan --out /tmp/plan.json` asks the real upstream (git, ghcr.io, the
Go module proxy) what a sweep would test today. It only reads; it starts
nothing.

## The two axes

| | Held still | Varies | Proves | PR changes |
|---|---|---|---|---|
| **gateway axis** | the SDK pin in `backend/go.mod` | the gateway image | wire: gateway<->SDK | `deploy/ci/gateway-pins.json` only (the ceiling lane) |
| **sdk axis** | the required lanes | the SDK | source: SDK<->BFF, then wire on every lane | `backend/go.mod`, `backend/go.sum`, the `sdk` field |

Upstream HEAD is probed on both (`dev` gateway, `sdk@latest`) as early warning
and is never pinned.

Either PR also regenerates the block of `README.md` that restates the range
and the SDK pin, where the repository has `scripts/readme-gateway-range.mjs`.
The guard accepts a README change that is confined to that block (between the
`<!-- gateway-range:begin ... -->` and `<!-- gateway-range:end -->` markers)
and refuses any other.

Merging either one cuts a patch release by itself, once CI has passed on
`main`: the range the artifacts declare, or the SDK the BFF is built against,
changed. It is the one automatic release (every other release is cut by hand,
see `docs/releasing.md` and ADR 0007). `publish.yml` recognises a sweep pull
request by the branch it was merged from and by the one-axis guard passing on
the merged commit, not by its title, so a sweep pull request that someone
added other changes to is not released automatically. The titles are `fix:`
commits (`fix(compat): support gateway X`,
`fix(sdk): move to the OpenShell SDK at vX`) so that the release notes list
them under Bug Fixes.

## Before the sweep can open a pull request

One of these has to be true. The first was enabled on 2026-10-05:

- the repository setting **Settings > Actions > General > Workflow
  permissions > Allow GitHub Actions to create and approve pull requests** is
  enabled; or
- the repository has a secret **`SWEEP_TOKEN`**: a fine-grained or GitHub App
  token with Contents and Pull requests read/write on this repository.

Without either, a run that has something to propose pushes its branch, is
refused the pull request, deletes the branch again and fails with a message
that names both. The report never says a pull request exists: it says which
job opens it and to merge it only if that job succeeded. With the setting
alone, CI does not start on the pull request by itself (its body says what to
press); with `SWEEP_TOKEN` it does.

## What a run covers

- **Every release above the ceiling, always.** The ceiling moves only through
  an unbroken run of passes, and never past a release that failed or that the
  run has no result for.
- **Every release from the floor to the ceiling**, on a scheduled run.
  `max_versions` (manual runs) narrows that to the newest N at or below the
  ceiling. It cannot remove a release above the ceiling.
- **Upstream HEAD**, unless `include_head` is off.

A run that left part of the range out, or did not probe HEAD, reports what it
saw but never closes the issue.

## What a result can be

A leg reports the first thing that stopped it, so a failure that repeats is a
row that says what failed rather than "the leg did not report":

| A leg observed | Means | The row says |
|---|---|---|
| compat suite passed / failed | the wire link holds / does not | passes / **wire** |
| `go build`, `go vet` or `go test` failed (SDK axis) | the BFF's source does not fit the SDK | **source** |
| `go get` or `go mod tidy` failed (SDK axis) | the SDK could not be fetched or resolved: the network as often as the SDK | not a result yet; re-run |
| an image could not be pulled, the gateway did not start, the BFF did not start | no request reached the gateway | could not be tested |
| nothing (the leg died, or its source check named no step) | unknown | no result; the run is red |
| the same source check failed on one leg and passed on another | unknown: not a property of the SDK | legs disagree; the run is red |

Unknown is never read as a pass or a failure. It closes nothing and proposes
nothing that depends on it.

## Who may write

The gateway and SDK legs run upstream images and the candidate SDK's code
with a read-only token. The `bump` job holds `contents: write` and therefore
runs nothing it did not get from this repository's checkout: no Go, no
container. The SDK PR's `go.mod` and `go.sum` are the files the passing legs
uploaded, copied in by `sweep.py bump-sdk --tested` and checked as data (same
on every leg, the decided version, no new `replace` or `exclude`). The token
is handed only to the steps that call `gh` or `git push`. `tests/test_workflows.py`
enforces all of this.

Only a pull request whose head branch is in **this** repository is ever
rewritten or closed. `gh pr list --head` also matches a fork's branch of the
same name; `prs.py` picks the sweep's own.

## Files

| File | What it decides |
|---|---|
| `pins.py` | Is `gateway-pins.json` well formed and in canonical form? What range does it claim? The two edits a PR may make. |
| `upstream.py` | What the sweep learns from the network: tags, image digests, SDK versions. Tests replace it. |
| `candidates.py` | What to test on each axis. |
| `sourcecheck.py` | The source link: `go get`, tidy, build, vet, test, stopping at the first failure. Run only by the read-only SDK legs. Tests replace the command runner. |
| `outcomes.py` | What the results mean: which link failed, whether a PR opens, what happens to the issue. |
| `report.py` | The issue, the step summary and the PR text. |
| `prs.py` | Which open pull request is the sweep's own, and whether this run may close it. |
| `guard.py` | Refuses a pending change that leaves its axis. |
| `sweep.py` | The command line the workflows call. |
| `tests/fixtures/` | `upstream.json`: a subset of upstream's real tags with the real ghcr.io digests of 2026-10-05. `scenarios/`: one JSON file per scenario. `malformed/`, `noncanonical/`: pins files that must be refused. |

## Adding a scenario

Copy a file in `tests/fixtures/scenarios/`. `upstream` adds tags, image
digests and SDK versions on top of `fixtures/upstream.json`; `inputs` are the
workflow's inputs (`max_versions`, `include_head`, `since`); `legs` names the
step each leg failed at (`source`, `pull`, `stack`, `bff`, `compat` — anything
not listed passed; `null` means the leg never reported); `expect` is what the
run must conclude. `tests/test_scenarios.py` checks every file against its own
`expect` block.

## Not done yet

The gateway axis runs the compat suite and nothing else. A release that
silently drops a request field the suite does not vary would still pass, the
way nothing run against gateway 0.0.116 caught dashboard v0.3.0 sending every
request to the `default` workspace. What found that was a field-by-field diff
of the request messages between the gateway's proto tag and the SDK's proto.
Running that diff on the gateway axis is not implemented (ADR 0006,
Consequences).
