# Dex configuration for the RHOAI/OpenShell double-auth POC

[`config.yaml.example`](config.yaml.example) is a sanitized snapshot of the Dex configuration running in the `openshell` namespace on the ROSA POC cluster. It captures the important identity boundaries:

- Dex delegates primary authentication to OpenShift through the `openshift` connector.
- `openshell-dashboard` is a confidential client for the standalone dashboard's oauth2-proxy.
- `openshell-cli` is a public CLI client.
- `openshell-rhoai-embed` is a separate public PKCE client used by the RHOAI browser to obtain OpenShell Token B.
- The RHOAI callback and silent-callback routes are registered explicitly.

The checked-in file contains no credentials. The live POC currently renders the complete Dex document into a ConfigMap, including client secrets. That was expedient for the demo but should not be copied into production. Render it into a Secret instead, or use a secret-aware deployment mechanism.

## Render and install safely

Set the two values without committing them, render into a temporary file, and create a Kubernetes Secret:

```bash
read -rsp 'OpenShift OAuth client secret: ' OPENSHIFT_OAUTH_CLIENT_SECRET
echo
read -rsp 'OpenShell dashboard client secret: ' OPENSHELL_DASHBOARD_CLIENT_SECRET
echo
export OPENSHIFT_OAUTH_CLIENT_SECRET OPENSHELL_DASHBOARD_CLIENT_SECRET

DEX_RENDERED_CONFIG="$(mktemp)"
trap 'rm -f "$DEX_RENDERED_CONFIG"' EXIT
envsubst < deploy/openshift/dex/config.yaml.example > "$DEX_RENDERED_CONFIG"

oc -n openshell create secret generic dex-config \
  --from-file=config.yaml="$DEX_RENDERED_CONFIG" \
  --dry-run=client -o yaml | oc apply -f -
```

Mount the Secret at `/etc/dex/config.yaml` and start Dex with:

```text
dex serve /etc/dex/config.yaml
```

The live POC uses Dex `v2.41.1` on port `5556`, an edge-terminated OpenShift Route named `dex`, and an in-memory store. Replace the hard-coded ROSA hosts and API issuer before using this example on another cluster.

## Configure authorization claims

Keep token audience validation separate from authorization. The gateway validates
Token B's `aud` claim against `openshell-dashboard`, but it must read roles from
the `groups` claim. Do **not** configure `roles_claim = "aud"`; a single-audience
token encodes `aud` as a string while a cross-client token can encode it as an
array, causing identical users to receive different authorization results.

Create explicit OpenShift groups and assign users according to the access they
need:

```bash
oc adm groups new openshell-users
oc adm groups new openshell-admins
oc adm groups add-users openshell-users <user>
oc adm groups add-users openshell-admins <admin-user>
```

Configure the OpenShell gateway to consume those groups:

```toml
[openshell.gateway.auth]
allow_unauthenticated_users = false

[openshell.gateway.oidc]
issuer      = "https://<dex-host>"
audience    = "openshell-dashboard"
roles_claim = "groups"
admin_role  = "openshell-admins"
user_role   = "openshell-users"
```

An admin role implicitly satisfies user-level methods. OpenShift `cluster-admin`
is not automatically an OpenShell role: add the user to `openshell-admins`, or
build a separate OpenShift authorization integration.

The embedded RHOAI client must request both the group claim and the gateway
audience:

```text
OPENSHELL_OIDC_SCOPE="openid profile email groups audience:server:client_id:openshell-dashboard"
OPENSHELL_OIDC_AUDIENCE="openshell-dashboard"
```

The standalone oauth2-proxy must forward the OIDC access token using the header
expected by the relay BFF:

```text
--scope="openid profile email groups"
--pass-access-token=true
--set-xauthrequest=true
```

`--pass-authorization-header=true` is not a substitute: it can forward the ID
token in `Authorization`, while the embedded integration forwards Token B's
access token through `x-forwarded-access-token`.

## Security invariants

- Never commit either client secret or rendered configuration.
- Keep `openshell-rhoai-embed` public; browser clients cannot hold a secret.
- Restrict redirect URIs and allowed origins to the exact dashboard hosts.
- The Token B issuer and audience must match what the OpenShell gateway validates.
- Read authorization roles from an explicit group/roles claim, never from `aud`.
- Disable unauthenticated gateway users in every shared or cluster deployment.
- Use durable Dex storage and trusted cluster certificates outside this POC.
