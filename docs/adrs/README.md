# Architecture Decision Records

Each document states decisions that are in force.

| ADR | Decision |
|-----|----------|
| [0001](0001-standalone-application.md) | A standalone application, shipped as a container image and a Helm chart |
| [0002](0002-auth-relay-only-bff.md) | Authentication: a relay-only BFF behind an authenticating proxy |
| [0003](0003-gateway-api-openshell-sdk.md) | Gateway API: the OpenShell Go SDK, surfaced as it is |
| [0004](0004-frontend.md) | Frontend: PatternFly 6, one API client, feature flags and an i18n facade |
| [0005](0005-gateway-compatibility-and-releases.md) | Gateway compatibility and releases |

To change a decision, edit its ADR in the pull request that changes the decision. Git holds the history.
