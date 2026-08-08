---
name: proto-sync
description: Sync proto files from NVIDIA/OpenShell and regenerate Go stubs. Use when OpenShell proto definitions have changed upstream and the dashboard needs to be updated.
---

# Proto Sync

Sync proto files from the upstream OpenShell repo and regenerate Go stubs.

> **Note:** ADR 0005 proposes migrating the BFF to `openshell-sdk-go` (PR #2). If that lands, this skill retires — `backend/proto/` and `backend/gen/` go away, and API updates become an SDK version bump. Until then, this is the process.

## Steps

### 1. Fetch latest protos

```bash
cd backend
for proto in openshell datamodel sandbox inference options; do
  gh api "repos/NVIDIA/OpenShell/contents/proto/${proto}.proto?ref=main" \
    --jq '.content' | base64 -d > proto/${proto}.proto
done
```

### 2. Regenerate Go stubs

```bash
make proto
```

This runs `protoc` with `protoc-gen-go` and `protoc-gen-go-grpc` to regenerate `backend/gen/`.

### 3. Check for breaking changes

```bash
go build ./...
```

If the build fails, some RPC signatures changed. Update the affected wrapper methods in `internal/gateway/`.

### 4. Check for new RPCs we should wrap

Compare the new proto against `internal/gateway/` to see if any new user-facing RPCs were added that we should surface. Refer to `brain/openshell-dashboard/api-surface.md` for the prioritized scope.

### 5. Commit

```bash
git add backend/proto/ backend/gen/
git commit -m "sync: update proto files from NVIDIA/OpenShell"
```
