# Cypress Tests

## Directories

### `e2e/` — Stubbed UI tests
Uses fixture-based intercepts (`support/intercepts.ts`) to mock all API responses. Tests UI rendering, navigation, and interaction without a real backend.

Run: `npx cypress run` (uses `cypress.config.ts`)

### `e2e-integration/` — Integration tests
Hits the real BFF and gateway — no mocks. Verifies the full request path (UI → BFF → gRPC → gateway) returns correct data.

`workspace-scoping.cy.ts` is the one spec that leaves the `default` workspace: it creates a sandbox in a second workspace and asserts it is listed there and not in `default`. Keep it. A dashboard whose SDK gateway 0.0.116 cannot scope passes every other spec here, because that gateway ignores the workspace without an error and runs everything in `default`.

Run: `npx cypress run --config-file cypress.config.integration.ts`

Requires a running gateway, a BFF pointed at it, and the dev server pointed at that BFF. This line supports gateway 0.0.116 only, and the specs assert its behaviour (for example that the template routes answer `501`), so run them against that gateway — the one CI uses, pinned by digest in `deploy/ci/gateway-pins.json`:

```bash
deploy/ci/e2e-stack.sh up        # gateway 0.0.116: gRPC :8080, health :50052
(cd backend && AUTH_DISABLED=true OPENSHELL_GATEWAY_URL=localhost:8080 PORT=9080 go run ./cmd/server) &
(cd frontend && BFF_URL=http://localhost:9080 npm start) &
(cd frontend && npx cypress run --config-file cypress.config.integration.ts)
deploy/ci/e2e-stack.sh down
```

The stack script needs the Docker host's filesystem. On Linux that is your machine; with colima on macOS prefix it with `OPENSHELL_HOST_EXEC="colima ssh --"` (see the script's header).

The sandbox image the specs use comes from the same pins file, through `cypress.config.integration.ts`.

