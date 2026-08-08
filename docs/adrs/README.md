# Architecture Decision Records

One decision per document. **Accepted** = in force; **Proposed** = decided
pending conditions. Open questions that haven't reached a decision are not
recorded here — an ADR appears when the decision does.

| ADR | Decision | Status |
|-----|----------|--------|
| [0001](0001-downstream-consumption.md) | Downstream consumption: npm package + a five-mechanism extension surface | Accepted |
| [0002](0002-auth-relay-only-bff.md) | Auth: relay-only BFF behind a fronting proxy (e.g. oauth2-proxy) | Accepted |
| [0003](0003-gateway-client-sdk-vs-stubs.md) | Gateway client: openshell-sdk-go over generated stubs | **Proposed** |

From here forward, ADRs are append-only: supersede, don't rewrite.
