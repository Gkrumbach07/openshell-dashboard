---
name: add-rpc
description: Add a new OpenShell gRPC RPC to the dashboard. Creates the gateway wrapper method, REST handler, frontend API hook, and TypeScript types. Use when adding a new API endpoint to the dashboard.
---

# Add RPC

Wire a new OpenShell gRPC RPC through the full stack: gateway wrapper → REST handler → API hook → types.

## Arguments

`$ARGUMENTS` — RPC name from `backend/proto/openshell.proto` (e.g., `CreateWorkspace`, `ListProviders`)

## Steps

### 1. Find the RPC in the proto

Read `backend/proto/openshell.proto` (or `inference.proto`). Find the request/response message types. Note workspace scoping and auth requirements.

### 2. Gateway wrapper

Add a method to the appropriate file in `backend/internal/gateway/`:

```go
// backend/internal/gateway/workspaces.go
func (c *Client) CreateWorkspace(ctx context.Context, name string, labels map[string]string) (*pb.Workspace, error) {
    resp, err := c.openshell.CreateWorkspace(ctx, &pb.CreateWorkspaceRequest{
        Name:   name,
        Labels: labels,
    })
    if err != nil {
        return nil, err
    }
    return resp.Workspace, nil
}
```

### 3. REST handler

Add a handler in `backend/internal/api/`:

```go
func (app *App) CreateWorkspaceHandler(w http.ResponseWriter, r *http.Request) {
    var req CreateWorkspaceRequest
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        app.badRequest(w, err)
        return
    }
    workspace, err := app.gateway.CreateWorkspace(r.Context(), req.Name, req.Labels)
    if err != nil {
        app.handleGRPCError(w, err)
        return
    }
    app.writeJSON(w, http.StatusCreated, workspace)
}
```

Register the route in `app.go`.

### 4. Frontend API function

Add to `frontend/src/api/`:

```typescript
export const createWorkspace = (name: string): Promise<Workspace> =>
  restCREATE('/api/v1/workspaces', { name });
```

### 5. Frontend hook

Add to `frontend/src/api/` or `frontend/src/pages/`:

```typescript
export const useCreateWorkspace = () =>
  useMutation({
    mutationFn: (name: string) => createWorkspace(name),
  });
```

### 6. TypeScript type

Add to `frontend/src/types/`:

```typescript
export type Workspace = {
  name: string;
  labels: Record<string, string>;
  createdAt: string;
};
```

### 7. Verify

```bash
cd backend && go build ./... && go test ./...
cd frontend && npm run typecheck
```
