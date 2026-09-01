---
name: add-rpc
description: Add a new OpenShell API capability to the dashboard using the vendored Go SDK. Updates the handler, models, frontend API hook, and types. Use when adding a new endpoint to the dashboard.
---

# Add API Capability

Wire a new OpenShell gateway capability through the full stack: SDK surface check
→ models/request shape → REST handler → route → frontend API function → hook →
types.

## Arguments

`$ARGUMENTS` — SDK method or gateway capability name. Example:
`CreateWorkspace`, `ListProviders`, `GetInferenceRoute`

## Steps

### 1. Find the capability in the SDK

Read the vendored SDK surface described in `.claude/rules/openshell-api.md`.
Start with `openshell/v1/` and `types/` in the pinned module version. Note:
- Which SDK sub-client owns the capability (`Sandboxes()`, `Workspaces()`, `Providers()`, `Exec()`, `Inference()`, `Policy()`, `Services()`, ...)
- Workspace scoping
- Whether the API addresses a sandbox by name or UUID
- Secret-bearing fields or write-only fields that must not be sent back to the frontend
- Whether the public SDK is actually missing what you need; if so, document the gap before adding any escape hatch

### 2. Update models / request parsing

If the gateway response needs JSON shaping, add or extend DTO converters in
`backend/internal/models/`. Never serialize SDK objects directly.

```go
func FromSDKWorkspace(ws *openshell.Workspace) Workspace { ... }
```

For request bodies:
- Simple request structs live in the handler file.
- Complex SDK-building logic lives in `models/sdk_converters.go` or
  `models/builders.go`.
- Policy payloads must keep using `ParseSDKPolicy` / `marshalSDKPolicy` so the
  frontend's protojson contract stays intact.

### 3. REST handler

Add a handler in `backend/internal/api/`. Use package-level helpers from `respond.go`:

```go
// backend/internal/api/workspaces_handler.go
func (app *App) CreateWorkspace(w http.ResponseWriter, r *http.Request) {
    var body CreateWorkspaceRequest
    if !decodeBody(w, r, &body) {
        return
    }
    if !validDNS1123(body.Name) {
        writeError(w, http.StatusBadRequest, "invalid_name", "name must be a valid DNS-1123 label")
        return
    }
    workspace, err := app.sdk.Workspaces().Create(r.Context(), body.Name, body.Labels)
    if err != nil {
        writeSDKError(w, err)
        return
    }
    writeJSON(w, http.StatusCreated, models.FromSDKWorkspace(workspace))
}
```

Key patterns:
- No `Handler` suffix on method names
- `decodeBody(w, r, &dst)` for request parsing (returns false on error, writes response itself)
- `writeSDKError(w, err)` for gateway/SDK errors
- `writeJSON(w, statusCode, models.FromSDK*(...))` when returning SDK resources
- `validDNS1123(name)` for resource name validation

Register the route in `app.go`:

```go
r.Post("/workspaces", app.CreateWorkspace)
```

### 4. Frontend types

Add to `frontend/src/types/`:

```typescript
export type Workspace = {
  name: string;
  labels: Record<string, string>;
  createdAt: string;
};
```

### 5. Frontend API function

Add to the appropriate file in `frontend/src/api/`. Use `get`, `post`, `put`, `del` from `./client`:

```typescript
import { post } from './client';
import type { Workspace } from '../types/workspace';

export const createWorkspace = (name: string): Promise<Workspace> =>
  post<Workspace>('/api/v1/workspaces', { name });
```

### 6. Frontend hook

Add query/mutation hooks using the centralized `queryKeys` from `./queryKeys`:

```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createWorkspace } from './workspaces';
import { workspaceKeys } from './queryKeys';

export const useCreateWorkspace = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => createWorkspace(name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: workspaceKeys.all }),
  });
};
```

For query hooks, use `queryKeys` factories. Check `queryKeys.ts` for available keys — not all resources have a `list()` method (e.g., `workspaceKeys` has `all`, `detail(name)`, `members(workspace)` but no `list()`):

```typescript
export const useWorkspaces = () =>
  useQuery({
    queryKey: workspaceKeys.all,
    queryFn: () => listWorkspaces(),
  });
```

### 7. Update test doubles

Add the needed behavior to `backend/internal/api/mock_sdk_test.go`. Extend the
relevant mock SDK sub-client instead of inventing a parallel interface layer.

### 8. Verify

```bash
cd backend && go build ./... && go test ./...
cd frontend && npm run typecheck
```
