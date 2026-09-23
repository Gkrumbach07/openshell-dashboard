# Cypress Tests

## Directories

### `e2e/` — Stubbed UI tests
Uses fixture-based intercepts (`support/intercepts.ts`) to mock all API responses. Tests UI rendering, navigation, and interaction without a real backend.

Run: `npx cypress run` (uses `cypress.config.ts`)

### Integration tests live in Go, not here
The former `e2e-integration/` suite was pure `cy.request()` HTTP assertions with
no browser interaction, so it moved to `backend/test/compat` where it runs
against a matrix of real gateway versions without paying for Chrome, an npm
install and a frontend dev server.

Run: `make compat` (see the repo README). Cypress keeps the stubbed UI suite
above, which is what it is actually good at.

