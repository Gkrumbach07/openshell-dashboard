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

### 4. RHOAI is a third deployment context, and it must not assume a singleton

RHOAI's OpenShell plan (design thread, Sept 2026) adds two more shapes:

| | Backend | Dashboard implication |
|---|---|---|
| **3.6 EA2** | Downstream image + Helm, **self-deployed by the customer**. No managed backend. | The UI ships with no backend of ours to point at. The gateway is user-deployed and outside our trust boundary. |
| **3.6 GA** | Managed, operator-owned; DSC flips it on and off, like other RHOAI components. | Standard managed-dependency pattern. |

The initial framing assumed one gateway per RHOAI deployment. That assumption
was pushed back on in review, and the pushback is right: per-project /
per-namespace topologies are exactly what HyperShell already builds, and a
cluster-wide singleton would foreclose them. **This ADR therefore treats
single-gateway as a configuration, never an architecture.**

It also surfaces a discovery question the other two contexts don't have.
EA2 has no registry to read: the candidate answer is a downstream label on
the customer's own gateway resource, which anyone can apply to anything. GA
would get the answer from the DSC. Neither resembles the OpenShell CLI's
on-disk layout. So **discovery is a separate axis from selection**, and the
registry in Layer 1 has to be pluggable across at least four sources: the
OpenShell CLI layout, an explicit env/flag, in-cluster Kubernetes discovery
(label or DSC), and the HyperShell fleet API.

A useful consequence of the per-namespace shape: if a gateway belongs to an
RHOAI project, "which gateway" is largely answered by "which project," and
the gateway dimension partly collapses onto a selector the user already
drives. That is worth designing toward rather than adding a second,
independent switcher.

### 5. RHOAI already has a house pattern for this, and one BFF is a direct precedent

`odh-dashboard` carries eleven Go BFFs. Reviewing them settles several
questions this ADR was treating as open.

**`model-registry` solves our exact problem.** It supports N registry
instances across N namespaces, and does it like this:

- **No backend address is configured at all.** Its Deployment sets no
  registry URL; the address is discovered per request by listing Kubernetes
  Services with `component=model-registry` and requiring a port named
  `http-api`/`https-api` (`shared_k8s_client.go:41-55`, `:83-92`).
- **The instance is a URL path segment**, the scope is a query param:
  `/api/v1/model_registry/:model_registry_id?namespace=X`.
- **Discovery runs on the user's token, not the BFF's.** Its ServiceAccount
  ClusterRole grants only `config.openshift.io/apiservers get` and
  `subjectaccessreviews create` — it cannot list Services. The user's own
  RBAC bounds what they can discover.

That last point answers the spoofable-label objection directly: **the label
filters, Kubernetes RBAC authorizes.** A rogue labelled Service in a
namespace the user cannot read is invisible to them; one in a namespace they
*can* read is a workload they could already run themselves. Label-based
discovery is safe precisely when it is not the BFF's service account doing
the looking.

**Two house rules are worth adopting wholesale.**

*Never a hardcoded backend address in production.* Every static backend flag
across these BFFs (`LLAMA_STACK_URL`, `EVAL_HUB_URL`, `MAAS_API_URL`) is
documented as a developer override and is absent from every shipped manifest;
production resolves the address from a CR status field, an operator-injected
ConfigMap, synthesized Service DNS, or a bootstrap discovery call. Our
`OPENSHELL_GATEWAY_URL` is the opposite, and deliberately so — HyperShell
pins it in its console Deployment as a contract. Both can hold: the env var
stays the explicit, highest-precedence source, and discovery fills in when
it is unset. That is the same `env → discovery → fallback` order every one of
these BFFs already uses.

*Validate a resolved endpoint before relaying a token to it.* `eval-hub`
refuses to forward a bearer unless the discovered host ends in
`.svc.cluster.local` and the Service name matches an expected prefix, with
the rationale stated inline: it "prevents SSRF if a malicious actor gains
write access to the discovery ConfigMap — the BFF will refuse to forward
bearer tokens to arbitrary endpoints." `autorag` does the same for
Secret-sourced URLs (scheme allowlist, no embedded credentials, no path or
query). **This is the precedented answer to the untrusted-gateway concern**,
and it applies whether the endpoint came from a label, a ConfigMap, or the
DSC.

**The other conventions are consistent across all eleven:**

- `--auth-method=user_token`, `--auth-token-header=x-forwarded-access-token`,
  empty prefix — the same header and shape this BFF already uses.
- The BFF's ServiceAccount reads *configuration only*. `core-bff`'s Role
  covers ConfigMaps, `odhdashboardconfigs`, `odhapplications`; `mlflow`'s adds
  its own CR; `data-registry`'s adds ConfigMaps. None can touch user
  workloads.
- Discovery source varies by module and is the module's own choice: label
  selector (model-registry), ConfigMap (data-registry), cluster-scoped CR
  (mlflow), the DSC's `status.release.name` (maas). All use
  `env override → discovery → fallback` precedence.
- Enable/disable is not a DSC watch. The operator renders a ConfigMap
  (`MF_REMOTES_CONFIG`) listing `{service{name,namespace,port,tls}, path}`
  per module; the dashboard proxies to each entry's in-cluster Service.

**Direction of travel matters here.** The older per-module BFFs default to
`--auth-method=internal` — the BFF's own ServiceAccount plus Kubernetes user
impersonation. The newer `distributions/core-bff`, which its README describes
as replacing Fastify across RHOAI and RHAII, has **dropped `internal`
entirely**: only `disabled` and `user_token`. Relay-only is not an outlier
here; it is where the platform is heading.

One cautionary precedent: `mlflow` hard-fails when a second CR appears
(`mlflow_cr.go:69-71`, `Limit: 2` purely to detect N>1), and its escape-hatch
env var is not wired in the manifest — so a second instance degrades the
module to 503 until someone edits the Deployment. That is the cost of
treating single-instance as an architecture, in a shipping component.

### 6. mTLS does not survive the move to a fleet dashboard

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
  `{name, endpoint, tls, default}`, behind a **`GatewaySource` interface** so
  discovery can vary per deployment without touching handlers. Four sources,
  in rough order of arrival: the explicit env/flag one
  (`OPENSHELL_GATEWAY_URL`, which keeps today's behavior as the single
  default entry), the OpenShell CLI layout via
  `sdk/go openshell/v1/gateway.ListGateways()` / `LoadConfig()`, in-cluster
  Kubernetes discovery for RHOAI (label or DSC), and the HyperShell fleet
  API. Only the first two are in scope now; the interface is what keeps the
  other two from becoming a rewrite.
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
  endpoints and any credential material stay server-side. Instance-as-path-
  segment matches `model-registry`'s shipping convention, so this is the
  house pattern rather than a new one.
- **Any Kubernetes-discovery source must query with the caller's token, not
  a BFF ServiceAccount** — following `model-registry`, whose SA deliberately
  cannot list Services. This keeps discovery bounded by the user's own RBAC
  and preserves ADR 0002: the BFF still holds no identity that a gateway
  could ever see. Where a source genuinely needs the BFF's own identity
  (reading the DSC, as `maas` does), the ServiceAccount stays
  configuration-scoped and is never used on an outbound gateway call.
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

## The trust boundary when the gateway is not ours

EA2's self-deploy model raises a question worth answering precisely, because
the review thread guessed at it: *how risky is it that the BFF may route
through a gateway we don't manage?*

**What the BFF would hand a rogue gateway.** Exactly one thing: the end
user's bearer, verbatim, on every RPC. The BFF holds no credential of its
own — no service account, no static token, no ambient identity (ADR 0002),
and `sdkclient.ContextAuthProvider` reads only the per-request context. The
mTLS material is not at risk either: the client *certificate* is presented,
the private key never leaves the process, so a hostile endpoint learns
nothing replayable from it.

**So the blast radius is decided entirely by the token's `aud`.** This is the
question for architects, and it has a concrete answer either way:

- If the relayed token is **audience-scoped to that gateway** — HyperShell's
  model, one Keycloak client per gateway — a rogue gateway harvests a
  credential useful only against itself. The exposure is bounded to what the
  user already granted it.
- If RHOAI relays a **broadly-scoped token** (a cluster or RHOAI-wide user
  token), a rogue gateway harvests a credential valid against other APIs.
  That is a genuine credential-exfiltration path, and no amount of BFF
  hardening fixes it — the fix is audience scoping at the IdP.

Relay-only is what keeps this bounded rather than catastrophic: there is no
service account to steal, and the BFF authorizes nothing. But "no service
account" is not itself the mitigation; **audience scoping is.**

Two concrete gaps in the current code, independent of RHOAI:

1. **Plaintext downgrade leaks the bearer.** `RequireTLS` is derived from the
   URL scheme (`gateway_setup.go:33`), so a bare `host:port` or `grpc://`
   gateway URL makes `RequireTransportSecurity()` return false and gRPC will
   ship the user's token in cleartext. Acceptable for `AUTH_DISABLED` dev;
   not acceptable when a customer supplies the URL. The BFF should refuse a
   plaintext gateway URL whenever auth is enabled.
2. **No CA pinning by default.** An empty `GATEWAY_CA_CERT` with a `grpcs://`
   address falls back to system roots, so any publicly-trusted certificate is
   accepted and "is this the right gateway" is answered by DNS alone.
3. **No endpoint validation before the token goes out.** Whatever address is
   configured receives the user's bearer on the first RPC. Once a gateway
   address can come from discovery rather than a trusted operator, that
   becomes an SSRF-shaped hole, and `eval-hub`'s host-and-name check is the
   pattern to copy: a discovered endpoint must look like what we expect
   before any bearer reaches it. An explicitly configured
   `OPENSHELL_GATEWAY_URL` is a deliberate operator choice and needs no such
   gate; a discovered one does.

**On label-based discovery.** A label is only as trustworthy as write access
to the object carrying it, so label-scraping is not an authorization
mechanism. But RHOAI has already solved this, and the answer is narrower
than "don't use labels": **the label filters, Kubernetes RBAC authorizes.**
`model-registry` lists labelled Services with the *caller's* token — its own
ServiceAccount cannot list Services at all — so a user only ever discovers
instances in namespaces they can already read. A rogue labelled gateway is
then either invisible to them, or sits in a namespace where they could
already run the same workload themselves.

What must not be built is discovery performed with the BFF's ServiceAccount,
which would let a label in any namespace surface a gateway to a user who
could not otherwise see it.

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
- RHOAI 3.6 EA2 can ship a UI against a self-deployed gateway without the
  dashboard hard-coding a singleton, and GA can supply the same registry from
  the DSC — the same code path, a different `GatewaySource`.
- Three hardening items fall out of the trust-boundary analysis and should
  land regardless of this ADR's fate: refuse plaintext gateway URLs when auth
  is enabled, make CA pinning expressible per gateway, and validate any
  *discovered* endpoint before relaying a bearer to it.
- The decisive security question — whether the relayed token is
  audience-scoped per gateway — is not ours to answer alone. It belongs in
  the RHOAI architecture review, and this ADR should not be accepted for the
  RHOAI context until it is settled.
- Nothing in Layer 1 diverges from RHOAI's BFF conventions: same token
  header, same instance-as-path-segment routing, same
  `env → discovery → fallback` precedence, same rule that the BFF's own
  identity is configuration-scoped. The multi-gateway work is a normal
  instance of a pattern the platform already runs eleven times.

## References

- [OpenShell — Manage Gateways](https://docs.nvidia.com/openshell/sandboxes/manage-gateways)
- SDK `openshell/v1/gateway` — `Config`, `NewClient`, `ListGateways`
- [openshift-online/hypershell](https://github.com/openshift-online/hypershell)
  — `specs/platform/openshell-gateway-console.spec.md`,
  `openshell-gateway-keycloak.spec.md`,
  `openshell-gateway-service-accounts.spec.md`
- ADR 0001 (downstream consumption), ADR 0002 (relay-only auth),
  ADR 0003 (SDK over stubs)
