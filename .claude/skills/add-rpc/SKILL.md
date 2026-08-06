---
name: add-rpc
description: Add a new OpenShell gRPC RPC to the dashboard. Creates the gateway wrapper method, REST handler, frontend API hook, and TypeScript types. Use when adding a new API endpoint to the dashboard.
---

# Add RPC

Wire a new OpenShell gRPC RPC through the full stack: gateway wrapper → Interface update → models DTO → REST handler → route → frontend API function → hook → types.

## Arguments

`$ARGUMENTS` — RPC name from `backend/proto/openshell.proto` (or `inference.proto`). Example: `CreateWorkspace`, `ListProviders`

## Steps

### 1. Find the RPC in the proto

Read `backend/proto/openshell.proto` (or `inference.proto`). Find the request/response message types. Note:
- Workspace scoping (does the request have a `workspace` field?)
- Auth requirements (check `authorization` option: `workspace_role` vs `global_role`)
- Whether it uses `sandbox_id` (UUID) vs `name` (see `.claude/rules/openshell-api.md` rule 6)
- Secret fields annotated with `[(openshell.options.v1.secret) = true]`

### 2. Gateway wrapper

Add a method to the appropriate file in `backend/internal/gateway/`. Use the correct generated package (`openshellv1`, `datamodelv1`, `sandboxv1`, `inferencev1`):

```go
// backend/internal/gateway/workspaces.go
func (c *Client) CreateWorkspace(ctx context.Context, name string, labels map[string]string) (*datamodelv1.Workspace, error) {
    resp, err := c.openshell.CreateWorkspace(ctx, &openshellv1.CreateWorkspaceRequest{
        Name:   name,
        Labels: labels,
    })
    if err != nil {
        return nil, err
    }
    return resp.Workspace, nil
}
```

### 3. Update gateway Interface

Add the method signature to `backend/internal/gateway/interface.go`. This is required for test mocking:

```go
CreateWorkspace(ctx context.Context, name string, labels map[string]string) (*datamodelv1.Workspace, error)
```

### 4. Add models DTO

Add a `From*()` function in `backend/internal/models/` to convert the proto response to a JSON-safe DTO. **Never serialize proto types directly** — always go through models:

```go
// backend/internal/models/models.go
type Workspace struct {
    Name      string            `json:"name"`
    Labels    map[string]string `json:"labels"`
    CreatedAt string            `json:"createdAt"`
}

func FromWorkspace(w *datamodelv1.Workspace) Workspace {
    return Workspace{
        Name:      w.Metadata.Name,
        Labels:    w.Metadata.Labels,
        CreatedAt: w.Metadata.CreatedAtMs, // convert as needed
    }
}
```

For request bodies, add a request struct and builder if needed:

```go
type CreateWorkspaceRequest struct {
    Name   string            `json:"name"`
    Labels map[string]string `json:"labels"`
}
```

### 5. REST handler

Add a handler in `backend/internal/api/`. Use package-level helpers from `respond.go`:

```go
// backend/internal/api/workspaces_handler.go
func (app *App) CreateWorkspace(w http.ResponseWriter, r *http.Request) {
    var body models.CreateWorkspaceRequest
    if !decodeBody(w, r, &body) {
        return
    }
    if !validDNS1123(body.Name) {
        writeError(w, http.StatusBadRequest, "invalid_name", "name must be a valid DNS-1123 label")
        return
    }
    workspace, err := app.gateway.CreateWorkspace(r.Context(), body.Name, body.Labels)
    if err != nil {
        writeGrpcError(w, err)
        return
    }
    writeJSON(w, http.StatusCreated, models.FromWorkspace(workspace))
}
```

Key patterns:
- No `Handler` suffix on method names
- `decodeBody(w, r, &dst)` for request parsing (returns false on error, writes response itself)
- `writeGrpcError(w, err)` for gateway errors
- `writeJSON(w, statusCode, models.From*(...))` — always convert through models
- `validDNS1123(name)` for resource name validation

Register the route in `app.go`:

```go
r.Post("/api/v1/workspaces", app.CreateWorkspace)
```

### 6. Frontend types

Add to `frontend/src/types/`:

```typescript
export type Workspace = {
  name: string;
  labels: Record<string, string>;
  createdAt: string;
};
```

### 7. Frontend API function

Add to the appropriate file in `frontend/src/api/`. Use `get`, `post`, `put`, `del` from `./client`:

```typescript
import { post } from './client';
import type { Workspace } from '../types/workspace';

export const createWorkspace = (name: string): Promise<Workspace> =>
  post<Workspace>('/api/v1/workspaces', { name });
```

### 8. Frontend hook

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

For query hooks, use `queryKeys` factories:

```typescript
export const useWorkspaces = () =>
  useQuery({
    queryKey: workspaceKeys.list(),
    queryFn: () => listWorkspaces(),
  });
```

### 9. Update test mock

Add the new method to `backend/internal/api/mock_gateway_test.go`.

### 10. Verify

```bash
cd backend && go build ./... && go test ./...
cd frontend && npm run typecheck
```
