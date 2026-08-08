# Architecture Decision Records

One decision per document. **Accepted** = in force; **Proposed** = decided
pending conditions. Open questions that
haven't reached a decision are not recorded here — an ADR appears when the
decision does.

| ADR | Decision | Status |
|-----|----------|--------|
| [0001](0001-npm-package-consumption-model.md) | Standalone repo, consumed downstream as an npm package | Accepted |
| [0002](0002-auth-relay-only-bff.md) | Auth: relay-only BFF behind a fronting proxy (e.g. oauth2-proxy) | Accepted |
| [0003](0003-bff-scope-boundary.md) | BFF scope: three jobs and a never-list | Accepted |
| [0004](0004-extension-surface.md) | Extension surface: five mechanisms, zero co-located CSS | Accepted |
| [0005](0005-surface-the-api-as-is.md) | Surface the upstream API as-is — no invented endpoints or abstractions | Accepted |
| [0006](0006-gateway-client-sdk-vs-stubs.md) | Gateway client: openshell-sdk-go over generated stubs | **Proposed** |

Numbering was reset on 2026-08-07 while the project was pre-1.0 and this set
unmerged; earlier drafts were consolidated into these six (ADR 0002's History
section preserves the auth evolution). From here forward, ADRs are
append-only: supersede, don't rewrite.
