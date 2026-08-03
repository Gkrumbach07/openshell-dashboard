package models

import (
	"encoding/json"
	"strings"
	"testing"

	datamodelv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/datamodelv1"
	openshellv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/openshellv1"
)

// Provider credentials are secret-marked in proto; the DTO must never carry
// their values, only key names.
func TestFromProviderStripsCredentialValues(t *testing.T) {
	provider := &datamodelv1.Provider{
		Metadata: &datamodelv1.ObjectMeta{Id: "p1", Name: "claude"},
		Type:     "claude",
		Credentials: map[string]string{
			"api_key": "sk-super-secret",
		},
		Config: map[string]string{"region": "us"},
	}

	dto := FromProvider(provider)
	raw, err := json.Marshal(dto)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if strings.Contains(string(raw), "sk-super-secret") {
		t.Fatalf("serialized provider leaked a credential value: %s", raw)
	}
	if len(dto.CredentialNames) != 1 || dto.CredentialNames[0] != "api_key" {
		t.Fatalf("expected credential key names only, got %v", dto.CredentialNames)
	}
}

func TestSandboxPhaseMapping(t *testing.T) {
	cases := []struct {
		want  string
		phase openshellv1.SandboxPhase
	}{
		{want: "PROVISIONING", phase: openshellv1.SandboxPhase_SANDBOX_PHASE_PROVISIONING},
		{want: "READY", phase: openshellv1.SandboxPhase_SANDBOX_PHASE_READY},
		{want: "ERROR", phase: openshellv1.SandboxPhase_SANDBOX_PHASE_ERROR},
		{want: "DELETING", phase: openshellv1.SandboxPhase_SANDBOX_PHASE_DELETING},
		{want: "UNKNOWN", phase: openshellv1.SandboxPhase_SANDBOX_PHASE_UNKNOWN},
		{want: "UNSPECIFIED", phase: openshellv1.SandboxPhase_SANDBOX_PHASE_UNSPECIFIED},
	}
	for _, tc := range cases {
		sandbox := &openshellv1.Sandbox{
			Status: &openshellv1.SandboxStatus{Phase: tc.phase},
		}
		if got := FromSandbox(sandbox).Status.Phase; got != tc.want {
			t.Errorf("phase %v: got %q, want %q", tc.phase, got, tc.want)
		}
	}
}

func TestParsePolicyRoundTrip(t *testing.T) {
	raw := json.RawMessage(`{
		"version": 1,
		"filesystem": {"includeWorkdir": true, "readOnly": ["/usr"], "readWrite": ["/sandbox"]},
		"landlock": {"compatibility": "best_effort"},
		"process": {"runAsUser": "sandbox", "runAsGroup": "sandbox"},
		"networkPolicies": {
			"anthropic": {
				"endpoints": [{"host": "api.anthropic.com", "port": 443, "protocol": "rest", "enforcement": "enforce", "access": "read-write"}]
			}
		}
	}`)
	policy, err := ParsePolicy(raw)
	if err != nil {
		t.Fatalf("ParsePolicy: %v", err)
	}
	if policy.Version != 1 {
		t.Errorf("version: got %d", policy.Version)
	}
	if !policy.Filesystem.IncludeWorkdir {
		t.Error("filesystem.includeWorkdir not parsed")
	}
	rule, ok := policy.NetworkPolicies["anthropic"]
	if !ok {
		t.Fatal("networkPolicies.anthropic missing")
	}
	if len(rule.Endpoints) != 1 || rule.Endpoints[0].Host != "api.anthropic.com" || rule.Endpoints[0].Port != 443 {
		t.Errorf("endpoint not parsed: %+v", rule.Endpoints)
	}
}

func TestParsePolicyRejectsUnknownFields(t *testing.T) {
	if _, err := ParsePolicy(json.RawMessage(`{"notAField": true}`)); err == nil {
		t.Fatal("expected error for unknown policy field")
	}
}
