# Compat sweep logic

Everything `.github/workflows/compat-sweep.yml` decides, and the pins
validation `ci.yml` runs on every PR, lives here as plain Python so it can be
run and tested without a runner, a network or a container. The decision
behind it is [ADR 0006](../../../docs/adrs/0006-compat-links-and-sweep-axes.md).

Standard library only. Works on Python 3.9 and newer.

```bash
python3 -m unittest discover -s deploy/ci/sweep -v     # the tests
python3 deploy/ci/sweep/sweep.py validate-pins          # check gateway-pins.json
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

## Files

| File | What it decides |
|---|---|
| `pins.py` | Is `gateway-pins.json` well formed? What range does it claim? The two edits a PR may make. |
| `upstream.py` | The only module that touches the network. Tests replace it. |
| `candidates.py` | What to test on each axis. |
| `sourcecheck.py` | The source link: `go get`, tidy, build, vet, test, stopping at the first failure. |
| `outcomes.py` | What the results mean: which link failed, whether a PR opens, what happens to the issue. |
| `report.py` | The issue, the step summary and the PR text. |
| `guard.py` | Refuses a pending change that leaves its axis. |
| `sweep.py` | The command line the workflows call. |
| `tests/fixtures/` | Upstream as it really was on 2026-10-05, plus one JSON file per scenario. |

## Adding a scenario

Copy a file in `tests/fixtures/scenarios/`. `upstream` adds tags, image
digests and SDK versions on top of `fixtures/upstream.json`; `legs` says what
each leg observed (anything not listed passed; `null` means the leg never
reported); `expect` is what the run must conclude. `tests/test_scenarios.py`
checks every file against its own `expect` block.
