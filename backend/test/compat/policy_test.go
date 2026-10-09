//go:build compat

package compat

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"reflect"
	"strings"
	"testing"
)

// policyRevision and policyView mirror models.PolicyRevision and
// models.SandboxPolicyView.
type policyRevision struct {
	PolicyHash string          `json:"policyHash"`
	Status     string          `json:"status"`
	LoadError  string          `json:"loadError"`
	Policy     json.RawMessage `json:"policy"`
	Version    uint32          `json:"version"`
}

type policyView struct {
	Latest        *policyRevision  `json:"latest"`
	Revisions     []policyRevision `json:"revisions"`
	ActiveVersion uint32           `json:"activeVersion"`
}

// policyUpdateResult mirrors models.PolicyUpdateResult.
type policyUpdateResult struct {
	PolicyHash string `json:"policyHash"`
	Version    uint32 `json:"version"`
}

// knownLoadStatus lists the PolicyLoadStatus spellings the frontend renders.
// UNSPECIFIED is deliberately absent: the BFF falls back to it when the SDK
// hands over a status it does not know, so seeing it here means the enum
// changed.
var knownLoadStatus = map[string]bool{
	"PENDING":    true,
	"LOADED":     true,
	"FAILED":     true,
	"SUPERSEDED": true,
}

// policyWith returns the base policy with the given network rules and with
// overrides applied to its top-level sections.
func policyWith(networkPolicies map[string]any, overrides map[string]any) map[string]any {
	p := basePolicy()
	p["networkPolicies"] = networkPolicies
	for k, v := range overrides {
		if v == nil {
			delete(p, k)
			continue
		}
		p[k] = v
	}
	return p
}

func networkRule(name, host string) map[string]any {
	return map[string]any{
		"name": name,
		"endpoints": []map[string]any{{
			"host":        host,
			"port":        443,
			"protocol":    "rest",
			"access":      "NETWORK_ACCESS_PRESET_READ_ONLY",
			"enforcement": "NETWORK_ENFORCEMENT_MODE_ENFORCE",
		}},
	}
}

// TestSandboxPolicy covers the Policy tab: the revision history and updating a
// live sandbox's network policies through UpdateConfig, guarded by the
// sandbox's resource version.
func TestSandboxPolicy(t *testing.T) {
	requireSandboxes(t)
	ws := newWorkspace(t)
	name := randName("pl")
	createSandbox(t, ws, name, nil)
	waitForPhase(t, ws, name, "READY")
	policyPath := sandboxPath(ws, name) + "/policy"

	view := func(t *testing.T) policyView {
		t.Helper()
		var v policyView
		mustJSON(t, http.MethodGet, policyPath, nil, &v, http.StatusOK)
		if v.Latest == nil {
			t.Fatalf("policy view has no latest revision [gateway %s]", gatewayVersion)
		}
		for _, r := range append([]policyRevision{*v.Latest}, v.Revisions...) {
			if !knownLoadStatus[r.Status] {
				t.Errorf("revision %d has status %q, not a PolicyLoadStatus the UI knows "+
					"(PENDING|LOADED|FAILED|SUPERSEDED) [gateway %s]", r.Version, r.Status, gatewayVersion)
			}
		}
		return v
	}
	versions := func(v policyView) []uint32 {
		out := make([]uint32, 0, len(v.Revisions))
		for _, r := range v.Revisions {
			out = append(out, r.Version)
		}
		return out
	}

	t.Run("initial revision", func(t *testing.T) {
		v := view(t)
		if v.Latest.Version != 1 || len(v.Revisions) != 1 || v.Revisions[0].Version != 1 {
			t.Errorf("new sandbox: latest = v%d, revisions = %v, want exactly revision 1", v.Latest.Version, versions(v))
		}
		if v.Latest.PolicyHash == "" {
			t.Error("latest revision has no policyHash")
		}
		// The history is only useful if a revision carries its policy.
		if !bytes.Contains(v.Latest.Policy, []byte(`"readWrite"`)) {
			t.Errorf("latest revision does not carry the policy it was created with: %s", truncate(v.Latest.Policy))
		}
	})

	t.Run("update network policies", func(t *testing.T) {
		var res policyUpdateResult
		mustJSON(t, http.MethodPut, policyPath, map[string]any{
			"policy": policyWith(map[string]any{"gh": networkRule("gh", "api.github.com")}, nil),
		}, &res, http.StatusOK)
		if res.Version != 2 || res.PolicyHash == "" {
			t.Errorf("update result = %+v, want version 2 with a policyHash", res)
		}

		v := view(t)
		if v.Latest.Version != 2 {
			t.Errorf("latest revision after the update = v%d, want v2", v.Latest.Version)
		}
		// Oldest first. PolicyRevisionTable renders the rows in the order
		// they arrive.
		if got := versions(v); len(got) != 2 || got[0] != 1 || got[1] != 2 {
			t.Errorf("revision history = %v, want [1 2]", got)
		}
		for _, want := range []string{"api.github.com", "NETWORK_ACCESS_PRESET_READ_ONLY", "NETWORK_ENFORCEMENT_MODE_ENFORCE"} {
			if !bytes.Contains(v.Latest.Policy, []byte(want)) {
				t.Errorf("revision 2 lost %q from the rule that was sent: %s", want, truncate(v.Latest.Policy))
			}
		}
	})

	t.Run("stale resource version is a conflict", func(t *testing.T) {
		// The version before the one the sandbox is at now: a version a client
		// could really still be holding, and one that is certainly stale. The
		// version the create call returned used to stand in for it and no
		// longer can. Since OpenShell 0.1.3 a create can answer with the
		// sandbox as the compute driver's first report left it, and that
		// version may still be the current one here.
		current := getSandbox(t, ws, name).Metadata.ResourceVersion
		if current < 2 {
			// Zero is how a request says it expects no version in particular.
			t.Fatalf("sandbox resourceVersion is %d, so there is no stale version to send", current)
		}
		stale := current - 1
		wantError(t, http.MethodPut, policyPath, map[string]any{
			"policy":                  policyWith(map[string]any{"ex": networkRule("ex", "example.com")}, nil),
			"expectedResourceVersion": stale,
		}, http.StatusConflict, "conflict")
		if v := view(t); v.Latest.Version != 2 {
			t.Errorf("a refused update still produced revision v%d", v.Latest.Version)
		}
	})

	t.Run("current resource version is accepted", func(t *testing.T) {
		raw := withCurrentVersion(t, ws, name, func(version uint64) (int, []byte, error) {
			return do(http.MethodPut, policyPath, map[string]any{
				"policy":                  policyWith(map[string]any{"ex": networkRule("ex", "example.com")}, nil),
				"expectedResourceVersion": version,
			})
		})
		var res policyUpdateResult
		mustDecode(t, raw, &res)
		if res.Version != 3 {
			t.Errorf("update with the current resourceVersion produced v%d, want v3", res.Version)
		}
	})

	// A live sandbox only takes network-policy changes: process, landlock and
	// filesystem are applied once at startup, and the UI renders them
	// read-only on the strength of the gateway refusing them. The filesystem
	// cases are changes the gateway does refuse; 0.1.2 was seen to accept a
	// path being added, so "any filesystem change" would be the wrong claim.
	t.Run("startup-only sections are refused", func(t *testing.T) {
		keep := map[string]any{"ex": networkRule("ex", "example.com")}
		cases := map[string]map[string]any{
			"process":  {"process": map[string]any{"runAsUser": "root", "runAsGroup": "root"}},
			"landlock": {"landlock": map[string]any{"compatibility": "hard_requirement"}},
			"filesystem includeWorkdir": {"filesystem": map[string]any{
				"includeWorkdir": false,
				"readOnly":       []string{"/usr"},
				"readWrite":      []string{"/sandbox"},
			}},
			"filesystem removed": {"filesystem": nil},
		}
		for label, overrides := range cases {
			t.Run(label, func(t *testing.T) {
				wantError(t, http.MethodPut, policyPath, map[string]any{"policy": policyWith(keep, overrides)},
					http.StatusBadRequest, "invalid_argument")
			})
		}
		if v := view(t); v.Latest.Version != 3 {
			t.Errorf("refused updates still produced revision v%d, want the history to stop at v3", v.Latest.Version)
		}
	})

	t.Run("unknown sandbox is a 404", func(t *testing.T) {
		wantError(t, http.MethodGet, sandboxPath(ws, "no-such-sandbox")+"/policy", nil, http.StatusNotFound, "not_found")
		wantError(t, http.MethodPut, sandboxPath(ws, "no-such-sandbox")+"/policy",
			map[string]any{"policy": basePolicy()}, http.StatusNotFound, "not_found")
	})
}

// globalPolicyInForce returns the revision of the global policy that is in
// force, or nil when the gateway has none.
//
// Removing a global policy does not remove its revisions: it marks them
// SUPERSEDED. So the only sign that a policy is in force is a revision that
// has not been superseded. One that is still PENDING or that FAILED to load
// counts as well: somebody set it, and it is not this suite's to replace. The
// view's activeVersion is the BFF's reading of the same sign; the guards read
// the revisions themselves, so that a wrong reading cannot stand them down.
func globalPolicyInForce(v policyView) *policyRevision {
	for i := range v.Revisions {
		if v.Revisions[i].Status != "SUPERSEDED" {
			return &v.Revisions[i]
		}
	}
	return nil
}

// TestGlobalPolicy covers the Global policy page: reading the gateway-global
// revisions, setting a global policy and removing it again.
//
// A global policy replaces the policy of every sandbox on the gateway while it
// is set, and makes the gateway refuse sandbox-scoped policy updates with
// "policy is managed globally". So the test sets one only on a gateway that
// has none and whose sandboxes are all this run's own, sets exactly the base
// policy those sandboxes already run, and removes it straight away. Setting
// one over an existing policy would supersede it, and the delete would then
// leave the gateway with no global policy at all. See "What the suite does to
// the gateway" in the package comment.
func TestGlobalPolicy(t *testing.T) {
	const path = "/api/v1/global-policy"

	read := func(t *testing.T) policyView {
		t.Helper()
		raw := mustRaw(t, http.MethodGet, path, nil, http.StatusOK)
		// GlobalPolicyPage reads .revisions.length without a null check.
		if !bytes.Contains(raw, []byte(`"revisions":[`)) {
			t.Fatalf(`global policy view has no "revisions" array: %s`, truncate(raw))
		}
		var v policyView
		mustDecode(t, raw, &v)
		return v
	}
	find := func(v policyView, version uint32) *policyRevision {
		for i := range v.Revisions {
			if v.Revisions[i].Version == version {
				return &v.Revisions[i]
			}
		}
		return nil
	}

	before := read(t)
	t.Run("read", func(t *testing.T) {
		for _, r := range before.Revisions {
			if !knownLoadStatus[r.Status] {
				t.Errorf("global revision %d has status %q, not a PolicyLoadStatus the UI knows "+
					"(PENDING|LOADED|FAILED|SUPERSEDED) [gateway %s]", r.Version, r.Status, gatewayVersion)
			}
		}
	})

	standDown := ""
	if rev := globalPolicyInForce(before); rev != nil {
		standDown = fmt.Sprintf("gateway %s already has a global policy in force (revision v%d, %s) that this "+
			"test did not set; setting another would supersede it and deleting would remove it",
			gatewayVersion, rev.Version, rev.Status)
	} else {
		standDown = sharedWithOthers(t)
	}

	var set policyUpdateResult
	attempted := false
	// The cleanup for a test that stopped between set and delete. It removes
	// the global policy only if the one in force is the one this test set, or,
	// when the PUT never answered, one that appeared after the test had seen
	// that there was none.
	t.Cleanup(func() {
		if !attempted {
			return
		}
		status, raw, err := do(http.MethodGet, path, nil)
		if err != nil || status != http.StatusOK {
			return
		}
		var now policyView
		if json.Unmarshal(raw, &now) != nil {
			return
		}
		if rev := globalPolicyInForce(now); rev != nil && (set.Version == 0 || rev.Version == set.Version) {
			_, _, _ = do(http.MethodDelete, path, nil)
		}
	})

	t.Run("set", func(t *testing.T) {
		if standDown != "" {
			t.Skipf("not setting a global policy: %s", standDown)
		}
		// Before the request, not after: a PUT that fails on the way back may
		// still have been applied.
		attempted = true
		mustJSON(t, http.MethodPut, path, map[string]any{"policy": basePolicy()}, &set, http.StatusOK)
		if set.Version == 0 || set.PolicyHash == "" {
			t.Fatalf("set result = %+v, want a version and a policyHash", set)
		}
		rev := find(read(t), set.Version)
		if rev == nil {
			t.Fatalf("revision v%d is not in the global policy history after setting it", set.Version)
		}
		if rev.Status != "LOADED" && rev.Status != "PENDING" {
			t.Errorf("revision v%d has status %q right after being set, want LOADED or PENDING", set.Version, rev.Status)
		}
		if rev.PolicyHash != set.PolicyHash {
			t.Errorf("revision v%d hash = %q, want the hash the update returned, %q", set.Version, rev.PolicyHash, set.PolicyHash)
		}
	})

	// The gateway lists global revisions without their policy. The page shows
	// the policy in force and starts an edit from it, so the view has to carry
	// it, and any one revision has to be readable with its payload.
	t.Run("the policy in force is readable", func(t *testing.T) {
		if set.Version == 0 {
			t.Skip("no global policy to read: this test did not set one")
		}
		v := read(t)
		if v.ActiveVersion != set.Version {
			t.Errorf("activeVersion = %d while revision v%d is in force", v.ActiveVersion, set.Version)
		}
		if v.Latest == nil || v.Latest.Version != set.Version {
			t.Fatalf("latest = %+v, want revision v%d", v.Latest, set.Version)
		}
		if !bytes.Contains(v.Latest.Policy, []byte(`"readWrite"`)) {
			t.Errorf("latest carries no policy, so the page has nothing to show or edit: %s", truncate(v.Latest.Policy))
		}

		var one policyRevision
		mustJSON(t, http.MethodGet, fmt.Sprintf("%s/revisions/%d", path, set.Version), nil, &one, http.StatusOK)
		if one.Version != set.Version || one.PolicyHash != set.PolicyHash {
			t.Errorf("revision read by version = v%d %q, want v%d %q", one.Version, one.PolicyHash, set.Version, set.PolicyHash)
		}
		if !bytes.Contains(one.Policy, []byte(`"readWrite"`)) {
			t.Errorf("revision v%d read by version carries no policy: %s", set.Version, truncate(one.Policy))
		}
		wantError(t, http.MethodGet, fmt.Sprintf("%s/revisions/%d", path, set.Version+1000), nil, http.StatusNotFound, "not_found")
	})

	// A sandbox under a global policy runs that policy, not its own, and the
	// Policy tab has to be able to say so. The sandbox does not have to boot
	// for the gateway to answer what it would be given.
	t.Run("a sandbox reports the global policy as its source", func(t *testing.T) {
		if set.Version == 0 {
			t.Skip("no global policy in force: this test did not set one")
		}
		if testing.Short() {
			t.Skip("skipping: creates a sandbox, which -short excludes")
		}
		ws := newWorkspace(t)
		name := randName("gp")
		createSandbox(t, ws, name, nil)
		var eff effectivePolicy
		mustJSON(t, http.MethodGet, sandboxPath(ws, name)+"/policy/effective", nil, &eff, http.StatusOK)
		if eff.PolicySource != "GLOBAL" || eff.GlobalPolicyVersion != set.Version {
			t.Errorf("effective policy source = %q, global version %d; want GLOBAL, v%d", eff.PolicySource, eff.GlobalPolicyVersion, set.Version)
		}
		if !bytes.Contains(eff.Policy, []byte(`"readWrite"`)) {
			t.Errorf("the effective policy carries no policy: %s", truncate(eff.Policy))
		}
		// And its own policy cannot be edited meanwhile.
		wantError(t, http.MethodPost, sandboxPath(ws, name)+"/policy/merge", map[string]any{
			"operations": []any{addEndpointOperation("allow_docs_example_com_443", "docs.example.com", nil)},
		}, http.StatusConflict, "conflict")
	})

	t.Run("delete", func(t *testing.T) {
		if set.Version == 0 {
			t.Skip("not deleting the global policy: this test did not set one")
		}
		var res struct {
			Deleted bool `json:"deleted"`
		}
		mustJSON(t, http.MethodDelete, path, nil, &res, http.StatusOK)
		if !res.Deleted {
			t.Error("deleted = false, want true")
		}
		after := read(t)
		if left := globalPolicyInForce(after); left != nil {
			t.Errorf("revision v%d is still %s after the global policy was removed, want none in force",
				left.Version, left.Status)
		}
		rev := find(after, set.Version)
		if rev == nil {
			t.Fatalf("revision v%d vanished from the history when the global policy was removed", set.Version)
		}
		if rev.Status != "SUPERSEDED" {
			t.Errorf("revision v%d has status %q after the global policy was removed, want SUPERSEDED", set.Version, rev.Status)
		}
		if after.ActiveVersion != 0 {
			t.Errorf("activeVersion = %d after the global policy was removed, want 0: none is in force", after.ActiveVersion)
		}
	})
}

// effectivePolicy mirrors models.EffectivePolicy.
type effectivePolicy struct {
	PolicyHash          string          `json:"policyHash"`
	PolicySource        string          `json:"policySource"`
	Policy              json.RawMessage `json:"policy"`
	Version             uint32          `json:"version"`
	GlobalPolicyVersion uint32          `json:"globalPolicyVersion"`
}

// addEndpointOperation is the operation the rule editor's "Add endpoint" form
// sends, which is the one `openshell policy update --add-endpoint` sends: a
// rule holding the one endpoint, under a name of its own, with the port in
// both spellings.
func addEndpointOperation(ruleName, host string, binaries []string) map[string]any {
	rule := map[string]any{
		"name": ruleName,
		"endpoints": []map[string]any{{
			"host":        host,
			"port":        443,
			"ports":       []int{443},
			"protocol":    "rest",
			"access":      "NETWORK_ACCESS_PRESET_READ_ONLY",
			"enforcement": "NETWORK_ENFORCEMENT_MODE_ENFORCE",
		}},
	}
	if len(binaries) > 0 {
		paths := make([]map[string]any, 0, len(binaries))
		for _, path := range binaries {
			paths = append(paths, map[string]any{"path": path})
		}
		rule["binaries"] = paths
	}
	return map[string]any{"addRule": map[string]any{"ruleName": ruleName, "rule": rule}}
}

// richNetworkPolicies is a pair of rules that use what the rule editor's form
// cannot express: several ports, a path scope, explicit allow and deny rules
// with a query matcher, several binaries, a rule name that is not its key, and
// an MCP endpoint that pins protocol revisions other than the gateway's
// default. The MCP rule is upstream's own example
// (crates/openshell-policy/testdata/mcp-version-profiles.yaml) with a shorter
// allowlist.
func richNetworkPolicies() map[string]any {
	return map[string]any{
		"api": map[string]any{
			"name": "internal-api",
			"endpoints": []map[string]any{{
				"host":              "api.example.com",
				"port":              443,
				"ports":             []int{443, 8443},
				"protocol":          "rest",
				"enforcement":       "NETWORK_ENFORCEMENT_MODE_ENFORCE",
				"path":              "/v1/**",
				"allowEncodedSlash": true,
				"rules": []map[string]any{{"allow": map[string]any{
					"method": "GET",
					"path":   "/v1/models/**",
					"query":  map[string]any{"page": map[string]any{"glob": "1*"}},
				}}},
				"denyRules": []map[string]any{{"method": "DELETE", "path": "/v1/models/**"}},
			}},
			"binaries": []map[string]any{{"path": "/usr/bin/curl"}, {"path": "/usr/bin/python3"}},
		},
		"mcp": map[string]any{
			"name": "versioned_mcp",
			"endpoints": []map[string]any{{
				"host":        "mcp.example.com",
				"port":        443,
				"protocol":    "mcp",
				"enforcement": "NETWORK_ENFORCEMENT_MODE_ENFORCE",
				"mcp":         map[string]any{"versions": []string{"2025-03-26", "2025-06-18"}},
				"rules":       []map[string]any{{"allow": map[string]any{"method": "initialize"}}},
			}},
			"binaries": []map[string]any{{"path": "/usr/bin/mcp-client"}},
		},
	}
}

// networkRules returns the network rules of a policy, each decoded to plain
// JSON values so that two readings of a rule can be compared whole.
func networkRules(t *testing.T, policy json.RawMessage) map[string]any {
	t.Helper()
	var decoded struct {
		NetworkPolicies map[string]any `json:"networkPolicies"`
	}
	mustDecode(t, policy, &decoded)
	return decoded.NetworkPolicies
}

// TestSandboxPolicyEdits covers the ways the Policy tab changes a live
// sandbox's policy, and the property all of them have to have: a rule nobody
// touched comes back exactly as it was.
//
// The rich policy goes in as a whole document, the way the tab's document
// editor replaces a policy. Every later change is one the rule editor makes,
// sent as the incremental operation `openshell policy update` sends, and after
// each the untouched rules are read back and compared with what they were.
func TestSandboxPolicyEdits(t *testing.T) {
	requireSandboxes(t)
	ws := newWorkspace(t)
	name := randName("pe")
	createSandbox(t, ws, name, nil)
	waitForPhase(t, ws, name, "READY")
	policyPath := sandboxPath(ws, name) + "/policy"

	latest := func(t *testing.T) policyRevision {
		t.Helper()
		var v policyView
		mustJSON(t, http.MethodGet, policyPath, nil, &v, http.StatusOK)
		if v.Latest == nil {
			t.Fatalf("policy view has no latest revision [gateway %s]", gatewayVersion)
		}
		return *v.Latest
	}
	merge := func(t *testing.T, operations ...any) policyUpdateResult {
		t.Helper()
		var res policyUpdateResult
		mustJSON(t, http.MethodPost, policyPath+"/merge", map[string]any{"operations": operations}, &res, http.StatusOK)
		return res
	}

	var replaced policyUpdateResult
	mustJSON(t, http.MethodPut, policyPath, map[string]any{"policy": policyWith(richNetworkPolicies(), nil)}, &replaced, http.StatusOK)
	if replaced.Version != 2 {
		t.Fatalf("replacing the policy produced v%d, want v2", replaced.Version)
	}
	before := networkRules(t, latest(t).Policy)
	// baseline is what each rule looked like when it was last changed on
	// purpose. It starts as revision 2 and gains the rule a later step adds.
	baseline := map[string]any{}
	for key, rule := range before {
		baseline[key] = rule
	}

	// untouched fails when a rule the last change did not name differs from
	// its baseline.
	untouched := func(t *testing.T, rules map[string]any, keys ...string) {
		t.Helper()
		for _, key := range keys {
			if !reflect.DeepEqual(rules[key], baseline[key]) {
				was, _ := json.Marshal(baseline[key])
				now, _ := json.Marshal(rules[key])
				t.Errorf("rule %q changed although the update did not name it [gateway %s].\nwas: %s\nnow: %s", key, gatewayVersion, was, now)
			}
		}
	}

	t.Run("a replaced policy keeps every field it was given", func(t *testing.T) {
		raw, _ := json.Marshal(before)
		// One mark per field the form cannot express. A missing one was
		// dropped on the way in or on the way out.
		for _, want := range []string{
			`"internal-api"`, `8443`, `"/v1/**"`, `"allowEncodedSlash":true`, `"/v1/models/**"`, `"1*"`,
			`"denyRules"`, `"DELETE"`, `"/usr/bin/python3"`, `"versioned_mcp"`, `"initialize"`,
		} {
			if !bytes.Contains(raw, []byte(want)) {
				t.Errorf("the stored policy lacks %s [gateway %s]: %s", want, gatewayVersion, truncate(raw))
			}
		}
		// The gateway replaces a missing MCP revision allowlist with its
		// pinned default, so an allowlist that got lost reads back as
		// ["2025-11-25"] rather than as nothing.
		if !bytes.Contains(raw, []byte(`"versions":["2025-03-26","2025-06-18"]`)) {
			t.Errorf("the MCP endpoint's revision allowlist is not the one that was sent [gateway %s]: %s", gatewayVersion, truncate(raw))
		}
	})

	t.Run("adding an endpoint leaves the other rules alone", func(t *testing.T) {
		res := merge(t, addEndpointOperation("allow_docs_example_com_443", "docs.example.com", []string{"/usr/bin/curl"}))
		if res.Version != 3 || res.PolicyHash == "" {
			t.Errorf("merge result = %+v, want version 3 with a policyHash", res)
		}
		rules := networkRules(t, latest(t).Policy)
		untouched(t, rules, "api", "mcp")
		added, _ := json.Marshal(rules["allow_docs_example_com_443"])
		for _, want := range []string{"docs.example.com", "NETWORK_ACCESS_PRESET_READ_ONLY", "/usr/bin/curl"} {
			if !bytes.Contains(added, []byte(want)) {
				t.Errorf("the added rule lacks %q: %s", want, truncate(added))
			}
		}
		// From here on the added rule is one of the rules later changes have
		// to leave alone.
		baseline["allow_docs_example_com_443"] = rules["allow_docs_example_com_443"]
	})

	// The target names the endpoint's whole scope: every port and every
	// binary of the rule. The gateway refuses an append that leaves any out.
	target := map[string]any{
		"ruleName": "api",
		"host":     "api.example.com",
		"ports":    []int{443, 8443},
		"path":     "/v1/**",
		"binaries": []map[string]any{{"path": "/usr/bin/curl"}, {"path": "/usr/bin/python3"}},
	}
	allowChat := map[string]any{"allow": map[string]any{"method": "POST", "path": "/v1/chat/**"}}

	t.Run("an allow rule is appended to the endpoint it names", func(t *testing.T) {
		merge(t, map[string]any{"addAllowRules": map[string]any{"target": target, "rules": []any{allowChat}}})
		rules := networkRules(t, latest(t).Policy)
		untouched(t, rules, "mcp", "allow_docs_example_com_443")
		api, _ := json.Marshal(rules["api"])
		// What was there stays, and the new rule is there with it.
		for _, want := range []string{
			`"/v1/chat/**"`, `"/v1/models/**"`, `"1*"`, `"denyRules"`, `"DELETE"`, `8443`, `"/v1/**"`,
			`"allowEncodedSlash":true`, `"internal-api"`, `"/usr/bin/python3"`,
		} {
			if !bytes.Contains(api, []byte(want)) {
				t.Errorf("rule api lacks %s after the append [gateway %s]: %s", want, gatewayVersion, truncate(api))
			}
		}
	})

	t.Run("an append that does not declare the whole scope is refused", func(t *testing.T) {
		partial := map[string]any{"ruleName": "api", "host": "api.example.com", "ports": []int{443}, "path": "/v1/**", "anyBinary": true}
		status, raw, err := do(http.MethodPost, policyPath+"/merge", map[string]any{
			"operations": []any{map[string]any{"addAllowRules": map[string]any{"target": partial, "rules": []any{allowChat}}}},
		})
		if err != nil {
			t.Fatalf("[gateway %s] %v", gatewayVersion, err)
		}
		if status < 400 || status >= 500 {
			t.Errorf("an append naming one of two ports and any binary: status = %d, want a refusal; body: %s", status, truncate(raw))
		}
	})

	t.Run("removing an endpoint removes its rule and nothing else", func(t *testing.T) {
		merge(t, map[string]any{"removeEndpoint": map[string]any{
			"ruleName": "allow_docs_example_com_443", "host": "docs.example.com", "port": 443,
		}})
		rules := networkRules(t, latest(t).Policy)
		if _, still := rules["allow_docs_example_com_443"]; still {
			t.Errorf("the rule is still there after its only endpoint was removed: %v", rules["allow_docs_example_com_443"])
		}
		untouched(t, rules, "mcp")
		if _, kept := rules["api"]; !kept {
			t.Error("rule api went with it")
		}
	})

	t.Run("a rule is removed by name", func(t *testing.T) {
		merge(t, map[string]any{"removeRule": map[string]any{"ruleName": "api"}})
		rules := networkRules(t, latest(t).Policy)
		if _, still := rules["api"]; still {
			t.Error("rule api is still there after it was removed")
		}
		untouched(t, rules, "mcp")
	})

	t.Run("malformed operations are refused before the gateway", func(t *testing.T) {
		wantError(t, http.MethodPost, policyPath+"/merge", map[string]any{"operations": []any{}}, http.StatusBadRequest, "invalid_policy")
		wantError(t, http.MethodPost, policyPath+"/merge", map[string]any{
			"operations": []any{map[string]any{"renameRule": map[string]any{"ruleName": "mcp"}}},
		}, http.StatusBadRequest, "invalid_policy")
	})

	// The sandbox's own policy is what its revisions hold, and what it is
	// given to enforce is the effective one. With no provider attached and no
	// global policy the two are the same policy.
	t.Run("effective policy", func(t *testing.T) {
		var eff effectivePolicy
		mustJSON(t, http.MethodGet, policyPath+"/effective", nil, &eff, http.StatusOK)
		now := latest(t)
		if eff.PolicySource != "SANDBOX" || eff.GlobalPolicyVersion != 0 {
			t.Errorf("effective policy source = %q, global version %d; want SANDBOX and none", eff.PolicySource, eff.GlobalPolicyVersion)
		}
		if eff.Version != now.Version {
			t.Errorf("effective policy version = v%d, want the latest revision, v%d", eff.Version, now.Version)
		}
		if eff.PolicyHash == "" {
			t.Error("effective policy has no policyHash")
		}
		if !reflect.DeepEqual(networkRules(t, eff.Policy), networkRules(t, now.Policy)) {
			t.Errorf("effective rules differ from the latest revision's with nothing to compose in.\neffective: %s\nlatest:    %s",
				truncate(eff.Policy), truncate(now.Policy))
		}
	})

	t.Run("one revision by its number", func(t *testing.T) {
		var second policyRevision
		mustJSON(t, http.MethodGet, policyPath+"/revisions/2", nil, &second, http.StatusOK)
		if second.Version != 2 || second.PolicyHash != replaced.PolicyHash {
			t.Errorf("revision 2 = v%d %q, want v2 %q", second.Version, second.PolicyHash, replaced.PolicyHash)
		}
		if !knownLoadStatus[second.Status] {
			t.Errorf("revision 2 has status %q, not a PolicyLoadStatus the UI knows [gateway %s]", second.Status, gatewayVersion)
		}
		// The payload of the revision asked for, not of the latest one: only
		// revision 2 still has both rules as they were sent.
		if !reflect.DeepEqual(networkRules(t, second.Policy), before) {
			t.Errorf("revision 2 does not carry the policy it was created with: %s", truncate(second.Policy))
		}
		wantError(t, http.MethodGet, policyPath+"/revisions/9999", nil, http.StatusNotFound, "not_found")
		wantError(t, http.MethodGet, policyPath+"/revisions/0", nil, http.StatusBadRequest, "invalid_request")
	})

	t.Run("unknown sandbox is a 404", func(t *testing.T) {
		missing := sandboxPath(ws, "no-such-sandbox") + "/policy"
		wantError(t, http.MethodGet, missing+"/effective", nil, http.StatusNotFound, "not_found")
		wantError(t, http.MethodGet, missing+"/revisions/1", nil, http.StatusNotFound, "not_found")
		wantError(t, http.MethodPost, missing+"/merge", map[string]any{
			"operations": []any{map[string]any{"removeRule": map[string]any{"ruleName": "mcp"}}},
		}, http.StatusNotFound, "not_found")
	})
}

// TestDraftPolicy covers the draft-policy inbox endpoints.
//
// A draft chunk is produced only by the in-sandbox supervisor's policy
// analysis, so the inbox of a compat sandbox is empty and a real approval
// cannot be exercised. What is asserted is how each endpoint answers against
// an empty inbox, which still takes every RPC to the gateway and back. On the
// gateways this was written against (0.1.0 to 0.1.2, unauthenticated users
// allowed) none of them asks for a principal: the reads succeed, a decision
// on a chunk that does not exist is a 404 and approving nothing is a conflict.
func TestDraftPolicy(t *testing.T) {
	ws, name := sharedSandbox(t)
	drafts := sandboxPath(ws, name) + "/drafts"

	t.Run("inbox", func(t *testing.T) {
		for _, query := range []string{"", "?status=pending", "?status=approved", "?status=rejected"} {
			raw := mustRaw(t, http.MethodGet, drafts+query, nil, http.StatusOK)
			// An empty inbox is an empty array, never null or a missing key.
			if !bytes.Contains(raw, []byte(`"chunks":[]`)) || !bytes.Contains(raw, []byte(`"draftVersion"`)) {
				t.Errorf(`GET drafts%s: want an empty "chunks" array and a "draftVersion", got: %s`, query, truncate(raw))
			}
		}
	})

	t.Run("history", func(t *testing.T) {
		raw := mustRaw(t, http.MethodGet, drafts+"/history", nil, http.StatusOK)
		if !strings.HasPrefix(strings.TrimSpace(string(raw)), "[") {
			t.Errorf("draft history is not a JSON array: %s", truncate(raw))
		}
	})

	t.Run("deciding an unknown chunk is a 404", func(t *testing.T) {
		chunk := drafts + "/no-such-chunk"
		// Without a review token the BFF first reads the draft to resolve
		// one, so the two approve calls take different paths to the gateway.
		wantError(t, http.MethodPost, chunk+"/approve", nil, http.StatusNotFound, "not_found")
		wantError(t, http.MethodPost, chunk+"/approve", map[string]any{"reviewToken": "stale"}, http.StatusNotFound, "not_found")
		wantError(t, http.MethodPost, chunk+"/reject", map[string]any{"reason": "compat"}, http.StatusNotFound, "not_found")
		wantError(t, http.MethodPost, chunk+"/undo", nil, http.StatusNotFound, "not_found")
		wantError(t, http.MethodPut, chunk, map[string]any{"proposedRule": networkRule("ex", "example.com")},
			http.StatusNotFound, "not_found")
	})

	t.Run("approving an empty inbox is a conflict", func(t *testing.T) {
		wantError(t, http.MethodPost, drafts+"/approve-all", nil, http.StatusConflict, "conflict")
		wantError(t, http.MethodPost, drafts+"/approve-all",
			map[string]any{"includeSecurityFlagged": true}, http.StatusConflict, "conflict")
		// What the tab sends: the chunks the reviewer saw, each with its
		// review token. The gateway looks for pending chunks before it looks
		// at the approvals, so it answers the same.
		wantError(t, http.MethodPost, drafts+"/approve-all", map[string]any{
			"approvals": []map[string]any{{"chunkId": "no-such-chunk", "reviewToken": "stale"}},
		}, http.StatusConflict, "conflict")
	})

	t.Run("clearing an empty inbox clears nothing", func(t *testing.T) {
		var res struct {
			ChunksCleared *uint32 `json:"chunksCleared"`
		}
		mustJSON(t, http.MethodPost, drafts+"/clear", nil, &res, http.StatusOK)
		if res.ChunksCleared == nil || *res.ChunksCleared != 0 {
			t.Errorf("chunksCleared = %v, want 0", res.ChunksCleared)
		}
	})

	t.Run("unknown sandbox is a 404", func(t *testing.T) {
		missing := sandboxPath(ws, "no-such-sandbox") + "/drafts"
		wantError(t, http.MethodGet, missing, nil, http.StatusNotFound, "not_found")
		wantError(t, http.MethodGet, missing+"/history", nil, http.StatusNotFound, "not_found")
	})
}
