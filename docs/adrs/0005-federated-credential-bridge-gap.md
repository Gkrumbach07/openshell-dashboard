# ADR 0005: Federated Mode Credential Bridge Gap

**Status:** Open (unresolved)  
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

## No Decision Yet

This ADR documents the gap and options. A decision will be made based on:
1. Whether the beta deployment requires supporting default OpenShift OAuth
2. Whether the gateway adds TokenReview support before the beta
3. Feedback from the ACP team on their production auth architecture
