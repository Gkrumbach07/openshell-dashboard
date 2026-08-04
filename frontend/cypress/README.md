# Cypress Tests

## Directories

### `e2e/` — Stubbed UI tests
Uses fixture-based intercepts (`support/intercepts.ts`) to mock all API responses. Tests UI rendering, navigation, and interaction without a real backend.

Run: `npx cypress run` (uses `cypress.config.ts`)

### `e2e-integration/` — Integration tests
Hits the real BFF and gateway — no mocks. Verifies the full request path (UI → BFF → gRPC → gateway) returns correct data.

Run: `npx cypress run --config-file cypress.config.integration.ts`

Requires a running BFF + gateway (`make dev` or `OPENSHELL_GATEWAY_URL` pointing at a live gateway).

