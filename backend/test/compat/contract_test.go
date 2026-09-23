//go:build compat

package compat

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

// deleteResult mirrors models.DeleteResult.
type deleteResult struct {
	Outcome string `json:"outcome"`
	Deleted bool   `json:"deleted"`
}

// establishesCompletion lists the outcomes the SDK says mean the resource is
// gone. Accepted means asynchronous cleanup was queued; unspecified and any
// unrecognized value must not be read as completion.
var establishesCompletion = map[string]bool{
	"completed":      true,
	"already_absent": true,
	"accepted":       false,
	"unspecified":    false,
}

// assertDeleted checks the delete envelope every delete endpoint returns and
// gives back the outcome so callers can decide whether the resource must
// already be gone.
func assertDeleted(t *testing.T, method, path string) string {
	t.Helper()
	var res deleteResult
	mustJSON(t, method, path, nil, &res, http.StatusOK)

	wantDeleted, known := establishesCompletion[res.Outcome]
	if !known {
		t.Fatalf("%s %s [gateway %s]: outcome = %q, not a known DeletionOutcome "+
			"(completed|already_absent|accepted|unspecified) — the gateway's deletion "+
			"contract changed", method, path, gatewayVersion, res.Outcome)
	}
	if res.Deleted != wantDeleted {
		t.Errorf("%s %s [gateway %s]: deleted = %v for outcome %q, want %v — only "+
			"completed and already_absent establish completion",
			method, path, gatewayVersion, res.Deleted, res.Outcome, wantDeleted)
	}
	return res.Outcome
}

// TestDeleteEnvelopeContract pins the shape every delete endpoint returns.
// PR #63 reported {"deleted": true} unconditionally, which misreports an
// asynchronous (accepted) deletion as a completed one.
func TestDeleteEnvelopeContract(t *testing.T) {
	name := randName("cd")
	mustJSON(t, http.MethodPost, "/api/v1/workspaces", map[string]any{"name": name}, nil, http.StatusCreated)

	outcome := assertDeleted(t, http.MethodDelete, "/api/v1/workspaces/"+name)
	t.Logf("workspace delete outcome = %q (gateway %s)", outcome, gatewayVersion)

	// Deleting a workspace that is already gone must not 500. It is either a
	// 404 or a completion-establishing already_absent.
	status, raw, err := do(http.MethodDelete, "/api/v1/workspaces/"+name, nil)
	if err != nil {
		t.Fatalf("second delete: %v", err)
	}
	if status != http.StatusNotFound && status != http.StatusOK {
		t.Errorf("second delete: status = %d, want 404 or 200; body: %s", status, truncate(raw))
	}
}

// TestListEndpointsReturnArrays guards the pagination migration. The SDK's
// List now returns a *Pager[T]; handlers must use ListAll so the BFF keeps
// emitting a plain JSON array. If a handler regressed to List, this catches
// it as an object-instead-of-array decode.
func TestListEndpointsReturnArrays(t *testing.T) {
	paths := []string{
		"/api/v1/workspaces",
		"/api/v1/workspaces/default/sandboxes",
		"/api/v1/workspaces/default/providers",
		"/api/v1/workspaces/default/provider-profiles",
		"/api/v1/workspaces/default/templates",
		"/api/v1/workspaces/default/members",
	}
	for _, p := range paths {
		t.Run(strings.TrimPrefix(p, "/api/v1/"), func(t *testing.T) {
			status, raw, err := do(http.MethodGet, p, nil)
			if err != nil {
				t.Fatalf("GET %s: %v", p, err)
			}
			if status != http.StatusOK {
				t.Fatalf("GET %s [gateway %s]: status = %d; body: %s", p, gatewayVersion, status, truncate(raw))
			}
			var arr []json.RawMessage
			if err := json.Unmarshal(raw, &arr); err != nil {
				t.Fatalf("GET %s [gateway %s]: body is not a JSON array (%v) — a handler may have "+
					"regressed from ListAll to the paginated List; body: %s", p, gatewayVersion, err, truncate(raw))
			}
		})
	}
}

// TestPolicyEnumRoundTrip pins the protojson spelling of the network policy
// enums. These moved from free strings ("read-only", "enforce") to proto
// enums (NETWORK_ACCESS_PRESET_*, NETWORK_ENFORCEMENT_MODE_*) in the Sep 2026
// SDK, which silently changes the wire format the frontend reads and writes.
func TestPolicyEnumRoundTrip(t *testing.T) {
	name := randName("cp")
	policy := map[string]any{
		"version": 1,
		"filesystem": map[string]any{
			"includeWorkdir": true,
			"readOnly":       []string{"/usr"},
			"readWrite":      []string{"/sandbox"},
		},
		"networkPolicies": map[string]any{
			"rules": []map[string]any{{
				"name": "gh",
				"endpoints": []map[string]any{{
					"host":        "api.github.com",
					"port":        443,
					"protocol":    "rest",
					"access":      "NETWORK_ACCESS_PRESET_READ_ONLY",
					"enforcement": "NETWORK_ENFORCEMENT_MODE_ENFORCE",
				}},
			}},
		},
	}

	status, raw, err := do(http.MethodPost, "/api/v1/workspaces/default/sandboxes", map[string]any{
		"name":   name,
		"image":  sandboxImage(),
		"policy": policy,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if status != http.StatusCreated {
		t.Fatalf("create with proto-enum policy [gateway %s]: status = %d, want 201 — the gateway "+
			"rejected the enum spellings the dashboard sends; body: %s", gatewayVersion, status, truncate(raw))
	}
	t.Cleanup(func() {
		_, _, _ = do(http.MethodDelete, "/api/v1/workspaces/default/sandboxes/"+name, nil)
	})

	var got struct {
		Spec struct {
			Policy json.RawMessage `json:"policy"`
		} `json:"spec"`
	}
	mustJSON(t, http.MethodGet, "/api/v1/workspaces/default/sandboxes/"+name, nil, &got, http.StatusOK)

	round := string(got.Spec.Policy)
	for _, want := range []string{"NETWORK_ACCESS_PRESET_READ_ONLY", "NETWORK_ENFORCEMENT_MODE_ENFORCE"} {
		if !strings.Contains(round, want) {
			t.Errorf("policy round-trip [gateway %s]: %q missing from returned policy — enum spelling "+
				"changed; policy: %s", gatewayVersion, want, truncate(got.Spec.Policy))
		}
	}
	// The pre-Sep-2026 lowercase spellings must not come back.
	for _, stale := range []string{`"read-only"`, `"enforce"`} {
		if strings.Contains(round, stale) {
			t.Errorf("policy round-trip [gateway %s]: stale lowercase spelling %s present — the "+
				"frontend now sends NETWORK_* constants; policy: %s", gatewayVersion, stale, truncate(got.Spec.Policy))
		}
	}
}
