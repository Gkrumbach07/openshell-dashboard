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
`backend/pkg/models/`. Never serialize SDK objects directly.

```go
func FromSDKWorkspace(ws *openshell.Workspace) Workspace { ... }
```

For request bodies:
- Simple request structs live in the handler file.
- Complex SDK-building logic lives in `models/sdk_converters.go` or
  `models/builders.go`.
- Policy payloads must keep using `ParseSDKPolicy` / `marshalSDKPolicy` so the
  frontend's protojson contract stays intact.

### 3. Service interface

Handlers never hold the SDK client directly — they depend on a narrow
interface in `backend/pkg/services/`, which is the seam downstream swaps to
layer custom behavior on top of the upstream default. For most resources the
interface just embeds the SDK's sub-client:

```go
// backend/pkg/services/workspace.go
type WorkspaceServiceInterface interface {
    openshell.WorkspaceInterface
}
```

Add a method to the interface only when the BFF needs behavior the SDK
sub-client does not expose (see `TemplateService.CreateSandboxFromTemplate`,
which reaches a top-level client method).

### 4. REST handler

Add the method to the resource's handler struct in `backend/pkg/handlers/`.
Handlers call `h.svc` and the exported helpers from `pkg/apiutils`:

```go
// backend/pkg/handlers/workspaces_handler.go
func (h *WorkspacesHandler) CreateWorkspace(w http.ResponseWriter, r *http.Request) {
    var body CreateWorkspaceRequest
    if !apiutils.DecodeBody(w, r, &body) {
        return
    }
    if !apiutils.ValidDNS1123(body.Name) {
        apiutils.WriteError(w, http.StatusBadRequest, apiutils.InvalidName, "name must be a valid DNS-1123 label")
        return
    }
    workspace, err := h.svc.Create(r.Context(), body.Name, body.Labels)
    if err != nil {
        apiutils.WriteSDKError(w, err)
        return
    }
    apiutils.WriteJSON(w, http.StatusCreated, models.FromSDKWorkspace(workspace))
}
```

Key patterns:
- No `Handler` suffix on method names (the struct carries it, not the method)
- URL params come from `r.PathValue("workspace")` — chi populates these via
  `SetPathValue`, so do not import chi in a handler
- `apiutils.DecodeBody(w, r, &dst)` for request parsing (returns false on error,
  writes the response itself)
- `apiutils.WriteSDKError(w, err)` for gateway/SDK errors
- `apiutils.WriteJSON(w, statusCode, models.FromSDK*(...))` when returning SDK resources
- `apiutils.ValidDNS1123(name)` for resource name validation
- Error codes are `apiutils.ResponseCode` constants, never bare strings — add a
  new constant to `pkg/apiutils/respond.go` rather than inlining a literal

Register the route in `backend/pkg/server/app.go`:

```go
r.Post("/workspaces", app.workspaces.CreateWorkspace)
```

If the resource has no handler struct yet, add one plus its constructor, and
wire it in `NewApp`.

### 5. Frontend types

Add to `frontend/src/types/`:

```typescript
export type Workspace = {
  name: string;
  labels: Record<string, string>;
  createdAt: string;
};
```

### 6. Frontend API function

Add to the appropriate file in `frontend/src/api/`. Use `get`, `post`, `put`, `del` from `./client`:

```typescript
import { post } from './client';
import type { Workspace } from '../types/workspace';

export const createWorkspace = (name: string): Promise<Workspace> =>
  post<Workspace>('/api/v1/workspaces', { name });
```

### 7. Frontend hook

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

### 8. Update test doubles

Add the needed behavior to `backend/pkg/handlers/mock_sdk_test.go`. Extend the
relevant mock SDK sub-client instead of inventing a parallel interface layer.

### 9. Verify

```bash
cd backend && go build ./... && go test ./...
cd frontend && npm run typecheck
```
