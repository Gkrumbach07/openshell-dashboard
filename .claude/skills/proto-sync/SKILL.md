---
name: proto-sync
description: Legacy alias for the SDK update workflow. Use when upstream OpenShell API definitions have changed and the dashboard needs to bump or audit the vendored Go SDK.
---

# SDK Sync

This repo no longer copies upstream proto files or regenerates local stubs.
When OpenShell changes upstream, update the pinned Go SDK version and audit the
affected handlers/models instead.

> **Note:** `proto-sync` remains only as a discoverable alias for older prompts.
> The live workflow is SDK-first per ADR 0003.

## Steps

### 1. Inspect upstream changes

```bash
git -C ../OpenShell fetch upstream main
```

Then compare the pinned SDK version against upstream:
- `sdk/go/openshell/v1/` for public client methods and resource shapes
- `sdk/go/openshell/v1/types/` for request/response field details
- `sdk/go/proto/sandboxv1/` only when the frontend policy protojson contract is involved

### 2. Bump the vendored SDK

```bash
cd backend
go get github.com/NVIDIA/OpenShell/sdk/go@<version-or-commit>
go mod tidy
```

### 3. Update call sites if the SDK shape changed

- Handlers should keep calling `app.sdk.<SubClient>()...`
- DTO shaping belongs in `backend/internal/models/sdk_converters.go`
- Policy JSON compatibility belongs in `backend/internal/models/policyproto.go`
- Only keep `backend/internal/sdkclient/rawexec.go` if the public SDK still lacks non-TTY stdin exec

### 4. Check for new user-facing capabilities

Compare upstream capabilities with the dashboard surface to see whether we
should expose anything new. Prefer the public SDK. If a feature is missing in
the SDK, document the exact gap before adding any workaround.

### 5. Commit

```bash
git add backend/go.mod backend/go.sum
git commit -m "build: bump OpenShell Go SDK"
```
