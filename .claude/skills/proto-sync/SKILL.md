---
name: proto-sync
description: Legacy alias for the SDK update workflow. Use when upstream OpenShell API definitions have changed and the dashboard needs to move or audit the vendored Go SDK.
---

# SDK Sync

This repo no longer copies upstream proto files or regenerates local stubs.
When OpenShell changes upstream, move the pinned Go SDK to the new release and
audit the affected handlers/models instead.

> **Note:** `proto-sync` remains only as a discoverable alias for older prompts.
> The live workflow is SDK-first per ADR 0003.

## Before you start

Moving the SDK is not a routine dependency update (ADR 0006):

- The pin is the commit of an upstream **release tag**. Never `@latest`, a
  branch, or a pre-release tag such as `v0.1.3-pre.4`.
- It moves in a PR of its own. Do not change a gateway lane in
  `deploy/ci/gateway-pins.json` in the same PR.
- Check whether it is already done. The weekly compat sweep tries the newest
  release's SDK against every supported gateway and opens a PR on the
  `compat-sweep/sdk` branch when it passes. Use this skill when the sweep's
  issue reports a **source migration** (the BFF does not build against the new
  SDK), or when you are asked for a specific release.

## Steps

### 1. Inspect upstream changes

```bash
git -C ../OpenShell fetch upstream main --tags
```

Then compare the pinned SDK version against the target release tag:
- `sdk/go/openshell/v1/` for public client methods and resource shapes
- `sdk/go/openshell/v1/types/` for request/response field details
- `sdk/go/proto/sandboxv1/` only when the frontend policy protojson contract is involved

### 2. Move the SDK to the release tag's commit

```bash
# The commit the release tag points at (take the ^{} line when the tag has one).
git ls-remote --tags https://github.com/NVIDIA/OpenShell.git 'v0.1.*'

cd backend
go get github.com/NVIDIA/OpenShell/sdk/go@<release-tag-commit>
go mod tidy
```

Write the resulting version into the `sdk` field of
`deploy/ci/gateway-pins.json` as well. CI fails when it differs from go.mod:

```bash
python3 deploy/ci/sweep/sweep.py validate-pins --go-mod backend/go.mod
```

### 3. Update call sites if the SDK shape changed

- Handlers should keep calling their injected `pkg/services` interface (`h.svc`), which wraps the SDK sub-client
- DTO shaping belongs in `backend/pkg/models/sdk_converters.go`
- Policy JSON compatibility belongs in `backend/pkg/models/policyproto.go`
- Only keep `backend/pkg/clients/rawexec.go` if the public SDK still lacks non-TTY stdin exec

### 4. Check for new user-facing capabilities

Compare upstream capabilities with the dashboard surface to see whether we
should expose anything new. Prefer the public SDK. If a feature is missing in
the SDK, document the exact gap before adding any workaround.

### 5. Prove both links

```bash
# Source link (SDK <-> BFF): no gateway involved.
cd backend && go build ./... && go vet ./... && go test ./...
```

The wire link (gateway <-> SDK) is proven by `backend/test/compat` against
every required lane in `deploy/ci/gateway-pins.json`. CI runs them all on the
PR. Locally, one lane at a time (needs Docker):

```bash
python3 deploy/ci/sweep/sweep.py range      # prints the floor and the ceiling
OPENSHELL_VERSION=<floor> make compat
OPENSHELL_VERSION=<ceiling> make compat
```

A new SDK that fails the floor lane would drop a gateway we support. Stop and
raise it: that is a decision about the supported range, not part of a bump.

### 6. Commit

```bash
git add backend/go.mod backend/go.sum deploy/ci/gateway-pins.json
git commit -s -m "build(sdk): move the OpenShell SDK to <release tag>"
```

Use `fix:` or `feat:` instead only when the move comes with a user-facing
change; those types cut a release.
