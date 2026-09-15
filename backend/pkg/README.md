# pkg — the importable surface

Everything here is public API for downstream consumers. It was moved out of
`internal/` so a downstream BFF can import and extend it rather than proxy to it,
which is the precondition ODH-ADR-0001 names:

> There needs to be public (not in `/internal`) interfaces and models upstream.
> Public interfaces, models, etc. live in `/pkg`

| Package | What a consumer uses it for |
|---|---|
| `api` | `NewApp`, `Routes()`, `AuthConfigResponse` — the whole OpenShell REST surface |
| `auth` | `New`, `Config` — bearer extraction middleware (relay-only, ADR 0002) |
| `models` | DTOs shared with the frontend, and the `FromSDK*` converters |
| `sdkclient` | `ContextAuthProvider` for building a gateway client; the raw-exec escape hatch |

## Fronting several gateways from one process

An `App` is bound to one gateway by the SDK client passed to `NewApp`. **N gateways
is N Apps**, mounted by id — not a per-request client factory.

That works because auth is *already* per-request: `sdkclient.ContextAuthProvider`
reads the bearer off the request context on every gRPC call, so a per-gateway
client still forwards each caller's own token. Only the gateway *endpoint* is
fixed per client.

```go
mux := chi.NewRouter()
for id, gw := range installs {
    app := api.NewApp(
        gw.SDKClient,                        // one client per gateway
        gw.Uploader,
        auth.New(auth.Config{TokenHeader: "..."}),
        "",                                  // API only — no console assets
        api.AuthConfigResponse{ /* ... */ },
    )
    mux.Mount("/openshell/"+id, http.StripPrefix("/openshell/"+id, app.Routes()))
}
```

Passing `staticDir: ""` gives an API-only surface: the standalone console's static
file serving is skipped, which is what an embedding host wants since it renders the
UI from the npm package instead.

`pkg/api/embedding_test.go` pins both behaviours.

## Stability

These paths are imported by downstream modules, so treat renames here as breaking
changes and pin by version or commit SHA per ODH-ADR-0001's versioning section.
