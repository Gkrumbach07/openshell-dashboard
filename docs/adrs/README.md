# Architecture Decision Records

One decision per document. **Accepted** = in force; **Proposed** = decided
pending conditions. Open questions that haven't reached a decision are not
recorded here — an ADR appears when the decision does.

| ADR | Decision | Status |
|-----|----------|--------|
| [0001](0001-downstream-consumption.md) | Downstream consumption: npm package + a five-mechanism extension surface | Accepted |
| [0002](0002-auth-relay-only-bff.md) | Auth: relay-only BFF behind a fronting proxy (e.g. oauth2-proxy) | Accepted |
| [0003](0003-gateway-client-sdk-vs-stubs.md) | Gateway client: openshell-sdk-go over generated stubs | Accepted |
| [0004](0004-downstream-consumption-i18n.md) | Amends 0001: i18n as sixth extension mechanism | Accepted |
| [0005](0005-gateway-version-compatibility.md) | Gateway compatibility: pin a supported range, never track `latest` | Accepted |
| [0006](0006-compat-links-and-sweep-axes.md) | Amends 0005: three links proven separately, two sweep axes, no `dev` pins | Accepted |
| [0007](0007-releases-are-cut-by-hand.md) | Releases are cut by hand with a chosen type; a merged compat-sweep bump is the one automatic patch | Accepted |
| [0008](0008-retire-the-npm-package.md) | Amends 0001 and 0004: the npm package is retired; the dashboard ships as a container image and a Helm chart | Accepted |
| [0009](0009-console-release-policy.md) | Amends 0005, 0006 and 0007: the console shares the gateway's minor release line; the compatibility notice compares release lines | Accepted |

From here forward, ADRs are append-only: supersede, don't rewrite.
