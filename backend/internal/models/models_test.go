package models

import (
	"encoding/json"
	"strings"
	"testing"

	openshell "github.com/rhuss/openshell-sdk-go/openshell/v1"
)

func TestFromProviderStripsCredentialValues(t *testing.T) {
	provider := &openshell.Provider{
		ID:   "p1",
		Name: "claude",
		Type: "claude",
		Spec: openshell.ProviderSpec{
			Credentials: map[string]string{
				"api_key": "sk-super-secret",
			},
			Config: map[string]string{"region": "us"},
		},
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
		phase openshell.SandboxPhase
		want  string
	}{
		{openshell.SandboxProvisioning, "PROVISIONING"},
		{openshell.SandboxReady, "READY"},
		{openshell.SandboxError, "ERROR"},
		{openshell.SandboxDeleting, "DELETING"},
		{openshell.SandboxUnknown, "UNKNOWN"},
	}
	for _, tc := range cases {
		sandbox := &openshell.Sandbox{
			Status: openshell.SandboxStatus{Phase: tc.phase},
		}
		if got := FromSandbox(sandbox).Status.Phase; got != tc.want {
			t.Errorf("phase %v: got %q, want %q", tc.phase, got, tc.want)
		}
	}
}

func TestParsePolicyRoundTrip(t *testing.T) {
	raw := json.RawMessage(`{
		"Version": 1,
		"Filesystem": {"IncludeWorkdir": true, "ReadOnly": ["/usr"], "ReadWrite": ["/sandbox"]},
		"Landlock": {"Compatibility": "best_effort"},
		"Process": {"RunAsUser": "sandbox", "RunAsGroup": "sandbox"},
		"NetworkPolicies": {
			"anthropic": {
				"Endpoints": [{"Host": "api.anthropic.com", "Port": 443, "Protocol": "rest", "Enforcement": "enforce", "Access": "read-write"}]
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
	if policy.Filesystem == nil || !policy.Filesystem.IncludeWorkdir {
		t.Error("filesystem.IncludeWorkdir not parsed")
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
