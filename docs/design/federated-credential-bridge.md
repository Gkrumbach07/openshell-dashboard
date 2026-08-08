# Design Note: Federated Mode Credential Bridge Gap

**Status:** Open question — becomes an ADR when decided  
**Date:** 2026-08-05  
**Authors:** Gage Krumbach

## Context

In federated mode (RHOAI), kube-auth-proxy authenticates users and injects tokens via `x-forwarded-access-token`. The BFF forwards these to the OpenShell gateway. The gateway validates tokens against its configured OIDC JWKS.

The problem: OpenShift's default OAuth server issues **opaque tokens** (`sha256~...`), not JWTs. The gateway can't validate opaque tokens — it only supports OIDC JWT validation via JWKS.

This means the gateway's internal RBAC (workspace admin/user roles) doesn't work in federated mode when the cluster uses default OpenShift OAuth. Per-user workspace permissions are not enforced.

## Options Under Consideration

### Option A: Require external OIDC provider
RHOAI 3's `kube-auth-proxy` supports external OIDC providers (Keycloak, Entra ID). When configured, the tokens flowing through `x-forwarded-access-token` ARE JWTs that the gateway can validate. Gateway RBAC works natively.

- **Pro:** Zero code changes needed. The BFF's proxy-delegated pattern already works.
- **Con:** Adds an infrastructure requirement. Not all RHOAI deployments have external OIDC configured.
- **Evidence:** ACP team has a working Keycloak deployment. Gowtham (Heimdall team) has a learning path for external OIDC on ROSA. kube-auth-proxy supports OIDC since RHOAI 3.

### Option B: Gateway adds TokenReview support
The OpenShell gateway adds k8s TokenReview API support alongside OIDC JWKS validation. It validates opaque tokens by calling the k8s API, gets back user identity and groups, and maps to roles.

- **Pro:** Works with default OpenShift OAuth. No external IDP needed.
- **Con:** Requires upstream NVIDIA change. Brandon (ACP) confirmed the gateway SA needs `tokenreviews` RBAC.
- **Evidence:** Brandon's Slack message about "K8s service account token validation" and "needed for TokenReview RBAC."

### Option C: BFF enforces RBAC via SubjectAccessReview
The BFF validates user permissions via k8s SubjectAccessReview before forwarding to the gateway. The gateway runs with `allow_unauthenticated_users = true`. This is the model-registry pattern.

- **Pro:** Works today. No upstream changes needed.
- **Con:** Loses the gateway's internal role model. Duplicates authorization logic. Two sources of truth for "who can access what."

## Current State

For the Sept 15 beta, **Option A is the recommended path** — RHOAI customers deploying OpenShell will configure an external OIDC provider, which is increasingly the enterprise standard. The BFF code is already correct for this case.

Option B is the medium-term goal (gateway-native token validation). Option C is the fallback if neither A nor B is ready.

## Option D: Praxis / AI Gateway owns auth (emerging, Aug 2026)

The Red Hat AI Gateway is converging on **Praxis** — a single Rust-based data plane that owns auth, identity, policy, credential injection, and the agentic loop for all AI traffic in RHOAI. Under this architecture, OpenShell becomes a **terminal service** behind Praxis.

- Praxis authenticates users via OIDC (Keycloak), then forwards validated identity to the OpenShell gateway — the "OGX behind Praxis with forwarded identity, tenant, scope, and trace context" pattern.
- Credential injection (BYOK, per-destination SigV4/Azure AD/GCP Workload Identity, secret-manager integration) is Praxis's job, not the BFF's.
- Ann Marie Fred (Aug 5 Slack thread): "Users will need to use the same OIDC provider to log in to OpenShell and MaaS." Two proxy layers — Praxis for AI plane auth, OpenShell supervisor for per-sandbox policy.
- The opaque-token problem dissolves: Praxis owns auth for the AI plane, so the BFF never needs to validate tokens itself.

**Timeline:** Praxis targets RHOAI 3.6 (replacing IPP). OpenShell integration is "work on exactly how they integrate later" (Ann Marie). This option is not available for the Sep 15 beta but may define the long-term architecture.

**Impact on our BFF:** Our relay-only design (ADR 0002) is already forward-compatible with Praxis. The BFF receives forwarded identity from Praxis the same way it receives `x-forwarded-access-token` from kube-auth-proxy.

## Gateway OIDC role mapping (how it works when it works)

The ACP team's verified ROSA deployment (12/12 e2e tests pass) shows the concrete mapping:

```toml
[openshell.gateway.oidc]
issuer      = "https://keycloak.example.com/realms/ambient-code"
audience    = "ambient-frontend"
roles_claim = "groups"          # reads JWT's "groups" array
admin_role  = "ambient-admins"  # groups contains this → platform_admin
user_role   = "ambient-users"   # groups contains this → authenticated user
```

Two-layer RBAC:
1. **Global role** (from JWT claims): `platform_admin` granted when `groups` array contains `admin_role` value
2. **Workspace role** (from membership records): gateway matches JWT `sub` claim against `WorkspaceMember.principal_subject` to determine per-workspace `admin` or `user` role

Unsolved: who manages `WorkspaceMember` records in RHOAI? Someone must call `AddWorkspaceMember(sub, role)` — this needs to map from OpenShift project RBAC or RHOAI group membership, and nobody has designed that mapping yet.

## Architecture thread outcomes (Aug 6-7, #team-openshell)

A cross-team thread (Gage, Gordon Sim, Mrunal Patel, Derek Carr, Jason Greene,
Jessica Forrester, Adel Zaalouk) reframed this gap. Key outcomes:

1. **Standalone UI first; embedding deferred.** Derek/Jason/Jessica: treat the
   OpenShell gateway as a distinct service ("like Argo," "like a model behind
   MaaS") with no required kube RBAC association. Deployment topologies (SAW
   40k gateways, non-SAW 100s per department, cross-cluster) must be
   documented before any embed-in-RHOAI-dashboard decision. The standalone
   dashboard — this repo — is the deliverable that makes sense today.
2. **Shared OIDC is the recommended deployment, not a requirement.** Mrunal:
   "OCP with external OIDC configured to use the same keycloak as the
   OpenShell gateway. We recommend that as the way to deploy." Without it,
   the standalone UI still works — the user just logs in separately.
3. **Same IdP ≠ same token.** Gordon: even with a shared provider, the
   dashboard and the gateway are separate OIDC clients with separate
   audiences. SSO removes the second login page; it does not remove the
   second token. Two concrete mechanisms for the embedded/federated case:
   - **Dedicated proxy flow** (works today): an oauth2-proxy instance for
     the OpenShell BFF, configured against the shared IdP with its own
     `client_id`/audience, injects the gateway-scoped JWT. Keycloak SSO
     makes the second flow invisible to the user. (This is the relay-only
     shape of ADR 0002 — the secure-agent-workspace pattern already runs
     exactly this.)
   - **Token exchange** (not built): swap the incoming dashboard token for a
     gateway-scoped token via RFC 8693 (RHAISTRAT-2183, in Refinement). The
     cleaner long-term pattern; blocked on platform support, and per ADR
     0003 it lands in the proxy/platform layer, not in the BFF.
4. **The spike Mrunal called for is unowned** as of Aug 7.

Implication for this repo: the relay-only architecture (ADR 0002)
already covers both mechanisms — both deliver a gateway-scoped JWT in
`x-forwarded-access-token`, which is all the BFF ever reads. No BFF
rearchitecting is required for either outcome.

## No Decision Yet

This ADR documents the gap and options. A decision will be made based on:
1. Whether the beta deployment requires supporting default OpenShift OAuth
2. Whether the gateway adds TokenReview support before the beta
3. Feedback from the ACP team on their production auth architecture
4. Timeline for Praxis integration with OpenShell (Option D)
5. The deployment-topology documentation Derek/Mrunal called for (Aug 7) —
   embedding decisions, and therefore the federated auth mechanism, wait on it
