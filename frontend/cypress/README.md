# Cypress Tests

## Directories

### `e2e/` — Stubbed UI tests
Uses fixture-based intercepts (`support/intercepts.ts`) to mock all API responses. Tests UI rendering, navigation, and interaction without a real backend.

Run: `npm start` in one terminal, then `npm run e2e` (or `npm run e2e:open`) in `frontend/`

### Integration tests live in Go, not here
Tests of the API against a real gateway are HTTP assertions with no browser
interaction, so they are the Go suite in `backend/test/compat`: it runs against
the real OpenShell gateway this branch pins, without paying for Chrome, an npm
install and a frontend dev server.

Run: `make compat` ([docs/development.md](../../docs/development.md#the-compat-suite)).
Cypress keeps the stubbed UI suite above.
