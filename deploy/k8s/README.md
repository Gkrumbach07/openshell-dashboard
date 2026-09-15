# Embedded deployment

Deploys this dashboard's BFF into a cluster so an embedding host — RHOAI's
OpenShell router, for example — can proxy to it.

```bash
kustomize build deploy/k8s | oc apply -f -
```

## One install, one gateway

`OPENSHELL_GATEWAY_URL` is a single endpoint and the SDK client is built once at
startup, so this package serves exactly one gateway. Several gateways means
several copies of it, each in its own namespace with its own `params.env`. The
embedding host lists them all and routes per gateway.

## What to set in `params.env`

| Key | Notes |
|---|---|
| `dashboard-image` | BFF + static frontend image |
| `gateway-url` | gRPC endpoint of **this install's** gateway |
| `oidc-issuer` | Must equal the gateway's `--oidc-issuer` |
| `oidc-client-id` | Public PKCE client the browser signs in with |
| `oidc-audience` | Must equal the gateway's `--oidc-audience` |

The three `oidc-*` values are advertised on the public `/api/v1/auth/config` so
an embedding host knows where to send the user to sign in, per gateway. The BFF
never uses them itself — it runs no flow and validates nothing (ADR 0002). They
are non-secret client metadata; **never put a client secret in them.**

They are also a second copy of values the gateway holds. If they drift from the
gateway's own flags, tokens get minted for an issuer or audience the gateway
rejects, and the only symptom is a refusal several hops downstream. Set them
from the same source you configured the gateway with.

## Why there is no Route

The BFF terminates no authentication. ADR 0002's deployment invariant is that
the fronting proxy must be the **sole network path** to it — here that proxy is
the embedding host's OpenShell router, which strips the host's own credentials
and forwards only the OpenShell bearer.

So the Service is ClusterIP and a NetworkPolicy restricts ingress to the
embedding host's namespace — **edit `networkpolicy.yaml`** to match yours
(`redhat-ods-applications` for RHOAI, `opendatahub` for ODH). Adding a Route
without also putting oauth2-proxy in front would expose a service that accepts
any bearer it is handed.

To run the standalone console alongside the embedded one, deploy oauth2-proxy in
this namespace, point the Route at the proxy rather than at this Service, and
widen the NetworkPolicy to admit the ingress namespace on the proxy's port only.

## TLS

The Service carries the OpenShift serving-cert annotation, so the BFF listens on
8443 with a cert signed by the cluster service CA. The embedding host already
trusts that CA, so no certificate distribution is needed. If you switch to plain
HTTP, the host must then either trust a custom CA or skip verification — prefer
keeping TLS.

## Pointing RHOAI at it

Set `OPENSHELL_GATEWAYS` on the agent-ops module with one entry per install:

```json
[
  {
    "id": "prod",
    "name": "Production",
    "bffUrl": "https://openshell-dashboard.openshell.svc.cluster.local:8443"
  }
]
```

`id` must be a DNS-1123 label — it becomes a URL path segment. `consoleUrl` is
optional and only used to link out to the standalone console for capabilities
the embedding cannot carry, such as the terminal.
