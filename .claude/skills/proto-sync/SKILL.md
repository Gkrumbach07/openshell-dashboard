---
name: proto-sync
description: What to do after the pinned OpenShell Go SDK has moved to a new OpenShell release. Use when the OpenShell API has changed and the dashboard has to follow the new SDK, or when the SDK's surface needs auditing.
---

# SDK Sync

The BFF reaches the gateway through the OpenShell Go SDK, and this repository
holds no copy of the gateway's proto files and no generated stubs (ADR 0003).
So there is nothing to regenerate: when OpenShell changes, the pinned SDK
moves to the new release, and the handlers and models it affects are audited.

## Before you start

You do not move the SDK. It moves together with the gateway the branch pins,
to the commit of an upstream release tag, and a workflow makes that move
(ADR 0005, decision 7; hard facts 17 and 20 in
`.claude/rules/openshell-api.md`):

- `.github/workflows/follow-upstream.yml` reads upstream's tags every hour. It
  keeps the `next` branch one commit ahead of `main`: the pins file, `go.mod`,
  `go.sum`, the built-in release line when the minor changes, and the README's
  generated block, all moved to the upcoming release. `next` pins the newest
  pre-release until upstream cuts the stable release, then that.
- Never `go get ...@latest` or a branch. Never move the pins in a pull request
  of your own, never push to `next`, and never open its pull request.
- If no `next` exists, upstream has nothing ahead of `main`
  (`python3 deploy/ci/upstream/follow.py plan --out /tmp/plan.json` says what
  it sees). If one should exist and does not, stop and say so.

What this skill is for is the work a move leaves: the BFF does not build
against the new SDK, the compat suite fails on `next`, or a new capability is
worth exposing. All of it is done **on `next`**: branch from it, and open the
pull request into it. It cannot land on `main`, where the SDK is still the old
one.

## Steps

### 1. See what moved

```bash
git fetch origin
git log --oneline --reverse origin/main..origin/next   # the first line is the pin move
git diff origin/main origin/next -- deploy/ci/gateway-pins.json backend/go.mod
```

Then compare the two SDK versions:
- `sdk/go/openshell/v1/` for public client methods and resource shapes
- `sdk/go/openshell/v1/types/` for request/response field details
- `sdk/go/proto/sandboxv1/` only when the frontend policy protojson contract is involved

### 2. Branch from `next`

```bash
git checkout -b fix/sdk-<release> origin/next
```

### 3. Update call sites if the SDK shape changed

- Handlers should keep calling their injected `pkg/services` interface (`h.svc`), which wraps the SDK sub-client
- DTO shaping belongs in `backend/pkg/models/sdk_converters.go`
- Policy JSON compatibility belongs in `backend/pkg/models/policyproto.go`
- Test doubles live in `backend/pkg/handlers/mock_sdk_test.go`; `go vet` compiles them, so a changed SDK interface fails there even when `go build` passes
- Each of the three direct gRPC calls in `backend/pkg/clients` exists for a named gap in the SDK. Check whether the new SDK closes the gap, and delete the call if it does:
  - `rawexec.go`: an exec with stdin and without a terminal
  - `rawprovider.go` (with `rawprovider_allworkspaces.go`): the keys of the gateway's redacted `credentials` map, which the SDK's provider type drops
  - `rawprofile.go`: a profile endpoint in full, where the SDK's type keeps only the host, port and protocol

### 4. Check for new user-facing capabilities

Compare upstream capabilities with the dashboard surface to see whether we
should expose anything new. Prefer the SDK. If it is missing a feature, name
the exact gap before adding a direct gRPC call (ADR 0003, decision 4).

### 5. Prove both links

```bash
# Source link (SDK <-> BFF): no gateway involved.
cd backend && go build ./... && go vet ./... && go test ./...
```

The wire link (gateway <-> SDK) is proven by `backend/test/compat` against the
gateway the branch pins. CI runs it on the pull request. Locally (needs
Docker and `jq`), with nothing set it runs that same gateway, by digest:

```bash
make compat
```

### 6. Commit and open the pull request into `next`

```bash
git commit -s -m "fix(bff): follow the OpenShell <release> SDK"
gh pr create --base next
```

Do not touch `deploy/ci/gateway-pins.json`, the SDK line of `backend/go.mod`
or the README's generated block: the pin move owns them, and a commit on top
that edits the same lines stops the workflow from moving the pin again. The
workflow rebases `next` when `main` moves and force-pushes it, so rebase your
branch afterwards (`git fetch origin && git rebase --fork-point origin/next`).

Use `fix:` for what a user would notice breaking, `feat:` for a new
capability. The commits reach `main` as they are when `next` merges, on the
day upstream releases, and the release notes are written from their titles.
