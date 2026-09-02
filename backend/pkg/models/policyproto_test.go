package models

import (
	"encoding/json"
	"reflect"
	"testing"
)

// fullPolicyJSON exercises every advanced policy field that the pre-SDK
// protojson contract carried. If the converter drops any of these, the
// round-trip below stops being the identity and the test fails.
const fullPolicyJSON = `{
  "version": 3,
  "filesystem": {"includeWorkdir": true, "readOnly": ["/etc"], "readWrite": ["/tmp", "/work"]},
  "landlock": {"compatibility": "best_effort"},
  "process": {"runAsUser": "agent", "runAsGroup": "agents"},
  "networkPolicies": {
    "anthropic": {
      "name": "anthropic",
      "endpoints": [
        {
          "host": "api.anthropic.com",
          "port": 443,
          "ports": [443, 8443],
          "protocol": "https",
          "tls": "verify",
          "enforcement": "enforce",
          "access": "allow",
          "allowedIps": ["1.2.3.4", "5.6.7.8"],
          "allowEncodedSlash": true,
          "persistedQueries": "strict",
          "graphqlMaxBodyBytes": 1048576,
          "path": "/v1",
          "websocketCredentialRewrite": true,
          "requestBodyCredentialRewrite": true,
          "advisorProposed": true,
          "credentialSigning": "aws-sigv4",
          "signingService": "bedrock",
          "signingRegion": "us-east-1",
          "jsonRpcMaxBodyBytes": 65536,
          "credentialBinding": {"provider": "claude-code"},
          "mcp": {"strictToolNames": true, "allowAllKnownMcpMethods": false},
          "rules": [
            {"allow": {"method": "POST", "path": "/v1/messages", "command": "chat", "operationType": "query", "operationName": "Msg", "fields": ["a", "b"], "query": {"q": {"glob": "x*", "any": ["1", "2"]}}, "params": {"p": {"glob": "y*"}}}}
          ],
          "denyRules": [
            {"method": "DELETE", "path": "/v1/admin", "fields": ["secret"], "query": {"z": {"any": ["9"]}}}
          ]
        }
      ],
      "binaries": [{"path": "/usr/bin/claude"}]
    }
  },
  "networkMiddlewares": {
    "redact": {"name": "redact", "middleware": "body-redactor", "onError": "deny", "order": 5, "config": {"pattern": "sk-.*"}, "endpoints": {"include": ["*.anthropic.com"], "exclude": ["logs.*"]}}
  }
}`

func normalizeJSON(t *testing.T, raw []byte) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("unmarshal: %v\n%s", err, raw)
	}
	return m
}

func TestSandboxPolicyRoundTripFullFidelity(t *testing.T) {
	// JSON -> domain -> JSON must be the identity for a fully-populated policy.
	policy, err := ParseSDKPolicy([]byte(fullPolicyJSON))
	if err != nil {
		t.Fatalf("ParseSDKPolicy: %v", err)
	}
	got := marshalSDKPolicy(policy)
	if got == nil {
		t.Fatal("marshalSDKPolicy returned nil")
	}

	want := normalizeJSON(t, []byte(fullPolicyJSON))
	have := normalizeJSON(t, got)
	if !reflect.DeepEqual(want, have) {
		t.Fatalf("policy round-trip lost or changed fields.\nwant: %s\n\ngot:  %s", fullPolicyJSON, got)
	}
}

func TestSandboxPolicyRoundTripAdvancedFieldsSurvive(t *testing.T) {
	// Explicit guard for the fields the pre-fix hand-rolled converter dropped.
	policy, err := ParseSDKPolicy([]byte(fullPolicyJSON))
	if err != nil {
		t.Fatalf("ParseSDKPolicy: %v", err)
	}
	ep := policy.NetworkPolicies["anthropic"].Endpoints[0]
	checks := []struct {
		name string
		ok   bool
	}{
		{"ports", len(ep.Ports) == 2},
		{"allowedIps", len(ep.AllowedIPs) == 2},
		{"L7 allow rules", len(ep.Rules) == 1 && ep.Rules[0].Allow != nil && ep.Rules[0].Allow.Method == "POST"},
		{"L7 deny rules", len(ep.DenyRules) == 1 && ep.DenyRules[0].Method == "DELETE"},
		{"mcp options", ep.Mcp != nil && ep.Mcp.StrictToolNames != nil && *ep.Mcp.StrictToolNames},
		{"credentialBinding", ep.CredentialBinding != nil && ep.CredentialBinding.Provider == "claude-code"},
		{"jsonRpcMaxBodyBytes", ep.JSONRPCMaxBodyBytes == 65536},
		{"graphqlPersistedQueries + graphqlMaxBodyBytes", ep.GraphqlMaxBodyBytes == 1048576},
		{"networkMiddlewares", len(policy.NetworkMiddlewares) == 1},
	}
	for _, c := range checks {
		if !c.ok {
			t.Errorf("advanced field dropped: %s", c.name)
		}
	}
}

func TestNetworkPolicyRuleRoundTrip(t *testing.T) {
	const ruleJSON = `{"name":"gh","endpoints":[{"host":"api.github.com","port":443,"protocol":"https","access":"allow","allowedIps":["140.82.0.0"],"denyRules":[{"method":"POST","path":"/graphql"}]}],"binaries":[{"path":"/usr/bin/gh"}]}`
	rule, err := ParseSDKNetworkPolicyRule([]byte(ruleJSON))
	if err != nil {
		t.Fatalf("ParseSDKNetworkPolicyRule: %v", err)
	}
	got := MarshalSDKNetworkPolicyRule(rule)
	if got == nil {
		t.Fatal("MarshalSDKNetworkPolicyRule returned nil")
	}
	if !reflect.DeepEqual(normalizeJSON(t, []byte(ruleJSON)), normalizeJSON(t, got)) {
		t.Fatalf("rule round-trip changed fields.\nwant: %s\ngot:  %s", ruleJSON, got)
	}
}

func TestParseSDKPolicyRejectsUnknownField(t *testing.T) {
	// protojson rejects unknown fields, preserving the pre-SDK validation.
	if _, err := ParseSDKPolicy([]byte(`{"version":1,"bogusField":true}`)); err == nil {
		t.Fatal("expected error for unknown policy field, got nil")
	}
}
