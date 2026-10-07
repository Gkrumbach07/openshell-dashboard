# Policy file fixtures

Policy files copied unchanged from
[NVIDIA/OpenShell](https://github.com/NVIDIA/OpenShell) at tag `v0.1.2`, under
the paths they have there. `policyFile.spec.ts` reads them to check that the
dashboard understands every field upstream's own policies use and loses none
of them between a file, the API and a file again.

These are every file at the tag that is a sandbox policy, found by content
(`network_policies:`, `filesystem_policy:` or `network_middlewares:` at the
start of a line) and by name. Helm and Kubernetes manifests with "policy" in
their name are a different kind of file and are not here.

| Here | Upstream |
|------|----------|
| `examples/**` | The policies of the examples: `sandbox-policy-quickstart`, `governance-interceptor`, `local-inference`, `policy-advisor`, `supervisor-middleware-content-guard`, `transparent-tcp-redis`, and the templates of `agent-driven-policy-management` and `multi-agent-notepad`. |
| `crates/openshell-policy/testdata/mcp-version-profiles.yaml` | The file upstream's own round-trip test reads: an MCP endpoint that lists its protocol revisions out of order. |
| `crates/openshell-prover/testdata/*.yaml`, `crates/openshell-prover-cli/tests/fixtures/*.yaml` | What the policy prover is tested with. |
| `crates/openshell-supervisor-network/testdata/sandbox-policy.yaml` | What the supervisor's network policy engine is tested with. |
| `crates/openshell-driver-mxc/examples/**` | Filesystem-only policies for the Windows driver. Their paths are Windows paths. |
| `e2e/**`, `scripts/agents/gator/policy.yaml` | Policies of upstream's end-to-end tests and of its `gator` agent. |
| `docs/policy-schema-full-example.yaml` | The "Full Example" of `docs/how-it-works/policies/schema.mdx`, which is the reference for the schema. |

One of them is not a policy file as it is, which is why it is here:

- `e2e/mcp-conformance/policy-template.yaml` has `${...}` placeholders where
  YAML structure goes, and is not YAML until they are filled in. It is refused.

The other templates (`*.template.yaml`) are YAML as they are, with their
placeholders inside strings, and are read like any other policy.

To refresh them, copy the same paths from the tag the SDK pin in
`backend/go.mod` corresponds to, and look for policy files that are new. Do
not edit them.
