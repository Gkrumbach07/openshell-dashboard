//go:build compat

package compat

import (
	"bytes"
	"encoding/json"
	"net/http"
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
	created := createSandbox(t, ws, name, nil)
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
		// The version the create call returned is one a client could really
		// still be holding: the gateway has bumped it several times since.
		stale := created.Metadata.ResourceVersion
		if current := getSandbox(t, ws, name).Metadata.ResourceVersion; current == stale {
			t.Fatalf("sandbox resourceVersion is still %d, so there is no stale version to send", stale)
		}
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

// TestGlobalPolicy covers the Global policy page: reading the gateway-global
// revisions, setting a global policy and removing it again.
//
// A global policy overrides every sandbox's own policy while it is set, so
// this test sets exactly the base policy the suite's sandboxes already run and
// removes it straight away.
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

	t.Run("read", func(t *testing.T) {
		read(t)
	})

	t.Cleanup(func() {
		_, _, _ = do(http.MethodDelete, path, nil)
	})

	var set policyUpdateResult
	t.Run("set", func(t *testing.T) {
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

	t.Run("delete", func(t *testing.T) {
		var res struct {
			Deleted bool `json:"deleted"`
		}
		mustJSON(t, http.MethodDelete, path, nil, &res, http.StatusOK)
		if !res.Deleted {
			t.Error("deleted = false, want true")
		}
		rev := find(read(t), set.Version)
		if rev == nil {
			t.Fatalf("revision v%d vanished from the history when the global policy was removed", set.Version)
		}
		if rev.Status != "SUPERSEDED" {
			t.Errorf("revision v%d has status %q after the global policy was removed, want SUPERSEDED", set.Version, rev.Status)
		}
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
