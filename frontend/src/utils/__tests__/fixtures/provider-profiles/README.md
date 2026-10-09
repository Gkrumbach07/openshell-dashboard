# Provider profile fixtures

Provider profile files copied unchanged from
[NVIDIA/OpenShell](https://github.com/NVIDIA/OpenShell) at tag `v0.1.3`, under
the paths they have there. `profileFile.spec.ts` reads them to check that the
dashboard understands every field upstream's own profiles use and loses none
of them between a file, the API and a file again.

| Here | Upstream |
|------|----------|
| `providers/*.yaml` | `providers/*.yaml`: the example profiles an operator imports. Upstream ships no profile inside the gateway; these are what its own tests load. |
| `examples/**` | `examples/governance-interceptor/profiles/{github,slack}.yaml`, `examples/spiffe-token-exchange-demo/provider-profile.yaml`, `examples/spiffe-token-grant-demo/provider-profile.yaml`, `examples/provider-managed-files/acme-config.yaml`, which sets `files` |
| `docs/profile-schema.yaml` | The field map in `docs/how-it-works/providers/profiles.mdx` ("Profile Schema"), which sets every field of the schema once, except the experimental `files`. |

Two of them are not importable as they are, which is why they are here:

- The governance-interceptor profiles have no `id`, which a profile file has to
  have. As files to import they are refused.
- The SPIFFE demo profiles set `tls: none`, which is not a TLS mode `v0.1.3`
  knows. It is sent on as an unknown value for the gateway to refuse, the way
  the CLI sends it.

To refresh them, copy the same paths from the tag the SDK pin in
`backend/go.mod` corresponds to. Do not edit them.
