# ADR 0005: Multi-Gateway — Request-Scoped Gateway in the BFF, Federated Auth Out of It

**Status:** Proposed
**Date:** 2026-09-10
**Authors:** Gage Krumbach

## Context

The dashboard is wired to exactly one gateway, at boot, in one place:
`OPENSHELL_GATEWAY_URL` → `newGatewayClients()` → a single
`openshell.ClientInterface` stored as `App.sdk`
(`backend/cmd/server/gateway_setup.go:32`, `backend/internal/api/app.go:28`).
68 handler call sites bind to that field implicitly. On the frontend the
same assumption appears three more times: a module-level `apiBasePath`
singleton (`frontend/src/api/client.ts:17`), query keys whose outermost axis
is `workspace` (`frontend/src/api/queryKeys.ts`), and a route table rooted at
`/workspaces/:workspace` (`frontend/src/app/AuthenticatedRoutes.tsx:132`).

Three facts make this worth revisiting now.

### 1. OpenShell itself is already multi-gateway

The CLI registers many gateways and switches between them
(`openshell gateway add` / `select` / `list`, `-g` per command,
`OPENSHELL_GATEWAY` env override). Registrations live at
`$XDG_CONFIG_HOME/openshell/gateways/<name>/metadata.json` (user) and
`/etc/openshell/gateways/<name>/metadata.json` (system), with an
`active_gateway` pointer. The vendored SDK exposes this directly in
`openshell/v1/gateway`: `Config{Name, Endpoint, AuthMode, Source, Dir,
OIDCIssuer, OIDCClientID, OIDCAudience, OIDCScopes}`, plus `NewClient(name)`,
`LoadConfig(name)` and `ListGateways()`. Auth modes are `plaintext`,
`cloudflare_jwt`, `oidc`, `mtls`.

**We do not need to invent a gateway registry.** Upstream has one, the SDK
reads it, and "surface the API as-is" applies to this too.

### 2. HyperShell already ships this dashboard, one instance per gateway

[`openshift-online/hypershell`](https://github.com/openshift-online/hypershell)
provisions OpenShell gateways at scale across clusters and clouds. Its domain
model is `Gateway`, `GatewayNetwork`, `GatewayRelease`, `ManagedCluster`,
`ManagedDatabase`, served from `/api/hypershell/v1/gateways` over a
PostgreSQL-backed API server, reconciled into Kubernetes by a control plane.
A `Gateway` row carries `namespace`, `route_address`, `console_address`,
`oidc` (JSON), `phase`, `status`, `active_sandbox_count`.

There are no CRDs: PostgreSQL is the source of truth and the control plane
reconciles plain Kubernetes objects off gRPC watch streams.

`GET /api/hypershell/v1/gateways` is already a complete gateway-switcher data
source — RBAC-filtered server-side (`plugins/gateways/handler.go:195-225`),
paginated, with generated Go and TypeScript clients. The readiness gates to
copy rather than reinvent are `phase === "Running" && route_address` for
connectable, and non-empty `console_address` for console-reachable.

Its `specs/platform/openshell-gateway-console.spec.md` deploys **our image**
as the per-gateway console: the control plane pins
`quay.io/gkrumbach07/openshell-dashboard@sha256:…` as `defaultConsoleImage`
(`components/control-plane/internal/gateway/config.go:32`) and runs one
dashboard + oauth2-proxy pod in each gateway namespace
(`openshell-<id-hex-8>`), reachable at `console-<ns>.<base-domain>`, wired
with `OPENSHELL_GATEWAY_URL=grpcs://openshell-gateway.<ns>.svc.cluster.local:8080`,
mTLS via `GATEWAY_CA_CERT`/`GATEWAY_CLIENT_CERT`/`GATEWAY_CLIENT_KEY`, and
`AUTH_TOKEN_HEADER=X-Forwarded-Access-Token`. That spec names our env-var and
header contract as an upstream dependency.

So "multiple gateways" already has a shipping answer: **N dashboards, one per
gateway**, with the fleet console link-ing out to `console_address`. The
question this ADR answers is whether *one* dashboard should span many.

### 3. The blocker is the token, not the plumbing

HyperShell provisions one Keycloak client per gateway (`{name}-{id}`) with
`aud = {name}-{id}` and **`fullScopeAllowed = false`**, explicitly so that
"a token obtained for `gw-alpha` contains only `gw-alpha`'s roles and
audience — never `gw-beta`'s"
(`specs/platform/openshell-gateway-keycloak.spec.md:127`). The console gets a
second client `{name}-{id}-console` whose mappers still target the gateway
client. Service accounts are the same: *"Can one set of client credentials
cover multiple gateways? No."*

ADR 0002 says the BFF never terminates auth, never validates tokens, has no
ambient identity, and that token exchange (RFC 8693) — if it materializes —
"lands in the proxy/platform layer, not in the BFF."

These compose to one hard consequence: **a single browser session cannot hold
a single bearer that N gateways will accept.** Multi-gateway means N tokens,
and minting them is a proxy/IdP concern. HyperShell lists "a central console
with single sign-on across all gateways (one login, token exchange for each
`aud`)" as explicitly out of scope.

### 4. mTLS does not survive the move to a fleet dashboard

Each gateway is reachable two ways, and they are not interchangeable:

| From | Address | Auth |
|---|---|---|
| In-cluster (today's console) | `grpcs://openshell-gateway.<ns>.svc.cluster.local:8080` | mTLS client cert from that namespace's `openshell-client-tls`, plus the relayed bearer |
| External (CLI, SDK) | `grpcs://gw-<ns>.<base-domain>:443` | Bearer only — the shared ingress strips mTLS, and `client_ca_path` is deliberately removed on routed gateways |

The in-cluster client certs are **per-namespace**, so a dashboard living in one
namespace cannot use that path to reach any other gateway. A fleet dashboard
must therefore use the external `route_address`, which means bearer-only auth
and no mTLS — reinforcing that the token is the whole problem.

(Note `:50051` is our default alone; HyperShell serves `:8080` in-cluster and
`:443` externally, and always overrides `OPENSHELL_GATEWAY_URL`.)

## Decision

Split the problem in two, and only take the half we own.

### Layer 1 — make the gateway a request-scoped dimension (do this)

The gateway stops being a boot-time constant and becomes a routing parameter,
without touching the auth model. With one configured gateway the behavior is
byte-identical to today, so the HyperShell image contract keeps working.

**Backend**

- Introduce a `GatewayRegistry` built at boot: named entries of
  `{name, endpoint, tls, default}`. Populate it from the OpenShell layout via
  `sdk/go openshell/v1/gateway.ListGateways()` / `LoadConfig()`, plus an
  explicit env/file override for containers. `OPENSHELL_GATEWAY_URL` remains
  supported and defines the single default entry.
- Replace `App.sdk openshell.ClientInterface` (`internal/api/app.go:28`) with
  a resolver — `app.gw(r)` returning the `ClientInterface` and
  `StdinExecer` for the request's gateway. Clients stay per-gateway
  singletons created once and cached; `sdkclient.ContextAuthProvider` is
  unchanged, still forwarding the per-request bearer. This is a mechanical
  change across 68 call sites in 13 handler files, and one test helper
  (`newTestAppWithSDK`, `mock_sdk_test.go:612`).
- Route under `/api/v1/gateways/{gateway}/…`, keeping the existing
  `/api/v1/…` paths as an alias resolving to the default gateway. Add
  `GET /api/v1/gateways` returning `{name, status, default}` per entry —
  endpoints and any credential material stay server-side.
- `useTLS` is currently decided once at boot and baked into both clients
  (`gateway_setup.go:33`); it becomes per-entry.

**Frontend**

- Gateway becomes the outermost URL segment (`/g/:gateway/workspaces/…`),
  mirroring how `workspace` is already threaded — a URL param passed as an
  explicit prop, not a context, so `src/pages/` stays context-free per
  ADR 0001.
- Insert the gateway segment into all 28 query keys **before** `workspace`,
  so `sandboxKeys.scope()` keeps working as a prefix-invalidation handle.
  The seven constant-key globals (`['gateway']`, `authKeys.config`,
  `authKeys.whoami`, `policyKeys.global`, `policyKeys.draftSummary`,
  `settingsKeys.global`, `workspaceKeys.all`) are the real correctness risk:
  today two gateways would show each other's version, settings and policy.
- `client.ts`'s four module-level `let`s become per-gateway state behind a
  resolver. Fix the two raw `fetch` calls that already bypass `apiBasePath`
  (`sandboxes.ts:299`, `:321`) and the WebSocket URL pinned to
  `window.location.host` (`SandboxTerminalTab.tsx:64`).
- `GET /api/v1/auth/config` currently gates the entire app
  (`AppRoutes.tsx:33`) but carries per-gateway values (`features`,
  `adminRole`, `logoutUrl`). Split it: a gateway-independent bootstrap
  (`authDisabled` + the gateway list) that the shell can render a picker
  from, and a per-gateway config fetched after selection.
- Add a gateway switcher to the masthead and make the About modal name the
  connected gateway.

### Layer 2 — federated auth, deliberately outside the BFF

Three options were considered for spanning gateways in one session:

| | Approach | Verdict |
|---|---|---|
| **a** | **Link-out.** A fleet view lists gateways; each opens its own dashboard origin with its own oauth2-proxy session. | **Adopt.** Zero auth work, works today, is what HyperShell already does. Costs N logins and forbids cross-gateway views. |
| **b** | **One dashboard, N tokens via RFC 8693 token exchange** at the proxy, selecting the `aud`-correct token per request. | **Defer.** Requires Keycloak token exchange, a per-gateway header or sidecar exchange service, and reverses HyperShell's stated isolation non-goal. Not ours to decide unilaterally. |
| **c** | **Read-only fleet aggregation against the HyperShell API** (`/api/hypershell/v1/gateways`) rather than N OpenShell gateways. | **Adopt for fleet views.** `phase`, `status`, `active_sandbox_count`, `console_address` already live in HyperShell's DB, so a cross-gateway overview needs one audience, not N. Drill-down hands off to (a). |
| **d** | **Per-gateway service-account credentials.** HyperShell's `/gateways/{id}/service_accounts` already mints `hs-sa-*` client-credentials clients returning `connection.{issuer, token_endpoint, client_id, audience, gateway_endpoint}` and a one-time secret. | **Reject.** It is exactly the ambient identity ADR 0002 forbids: the dashboard would act as itself, not as the user, and the gateway's RBAC would see one principal for every human. Correct for CI, wrong for a console. |

**We adopt (a) + (c) and defer (b).** Layer 1 is worth doing regardless: it is
what makes (a) ergonomic, (c) possible, and (b) a configuration change rather
than a rewrite.

### Conditions before Layer 2(b) is reconsidered

1. HyperShell reverses the "no central console" non-goal, or accepts a
   token-exchange design in its proxy layer.
2. The exchange lives in the proxy/platform, per ADR 0002 — the BFF gains no
   JWT parsing, no JWKS, no credential brokering.
3. Per-gateway isolation (`fullScopeAllowed = false`) survives: N narrow
   tokens, never one wide one.

## Alternatives considered

**Keep one gateway per dashboard instance forever.** This is the status quo
and it is genuinely coherent — it is also the only reason the current auth
model is as simple as it is. Rejected as the *only* answer because a fleet
operator running dozens of gateways has no cross-gateway view at all, and
because Layer 1 costs little and breaks nothing.

**Per-request client construction.** Dial the gateway on each request from a
client-supplied endpoint. Rejected: it makes the BFF an open gRPC proxy
(SSRF), discards connection pooling, and puts endpoint trust in the browser.

**Gateway as a React context.** Rejected: `src/pages/index.ts` states that
pages require no external context, and the published npm surface would break.
Threading a prop matches how `workspace` already works.

**A BFF-side gateway credential store.** Rejected outright by ADR 0002 — no
server-side state, no credential brokering.

## Consequences

- With one configured gateway nothing changes: same routes, same env vars,
  same container contract HyperShell pins.
- `App.sdk` as a field is gone; every handler goes through a resolver. This
  is the largest mechanical diff and should land on its own.
- Query-key collisions across gateways get fixed as part of the same change
  or not at all — a half-migration is worse than none.
- The `/api/v1/…` alias must be kept for as long as the published npm client
  and the HyperShell console image contract depend on it.
- Embedding our pages in HyperShell's fleet console (the point of ADR 0001)
  is blocked on a separate stack question, not on architecture — there is no
  Module Federation or iframe anywhere in that repo, only workspace packages
  and an external `consoleUrl` hyperlink. Their console is React 19 +
  `react-router` v8 + PatternFly 6.6 + **react-intl**, while our
  `peerDependencies` pin `react ^18.3.1`, `react-router-dom ^6.30.0` and
  i18next/react-i18next (ADR 0004). Widening the React peer, decoupling pages
  from router v6, and reconciling two i18n runtimes is a distinct task from
  this ADR. The natural landing spot is a fourth tab beside their existing
  `connection | details | service-accounts` gateway detail tabs.
- "Multiple gateways" and "single sign-on across gateways" are now separable:
  we ship the first without waiting on the second.

## References

- [OpenShell — Manage Gateways](https://docs.nvidia.com/openshell/sandboxes/manage-gateways)
- SDK `openshell/v1/gateway` — `Config`, `NewClient`, `ListGateways`
- [openshift-online/hypershell](https://github.com/openshift-online/hypershell)
  — `specs/platform/openshell-gateway-console.spec.md`,
  `openshell-gateway-keycloak.spec.md`,
  `openshell-gateway-service-accounts.spec.md`
- ADR 0001 (downstream consumption), ADR 0002 (relay-only auth),
  ADR 0003 (SDK over stubs)
