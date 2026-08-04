package models

import (
	"testing"

	inferencev1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/inferencev1"
	openshellv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/openshellv1"
	sandboxv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/sandboxv1"
)

func TestFromLogLine(t *testing.T) {
	resp := &openshellv1.GetSandboxLogsResponse{
		Logs: []*openshellv1.SandboxLogLine{
			{
				SandboxId:   "sb-1",
				TimestampMs: 12345,
				Level:       "WARN",
				Target:      "policy",
				Message:     "deny egress to 1.2.3.4",
				Source:      "gateway",
				Fields:      map[string]string{"dst_host": "1.2.3.4", "action": "deny"},
			},
			{
				SandboxId:   "sb-1",
				TimestampMs: 12346,
				Level:       "INFO",
				Message:     "sandbox started",
				Source:      "sandbox",
			},
		},
		BufferTotal: 200,
	}

	result := FromSandboxLogs(resp)

	if result.BufferTotal != 200 {
		t.Errorf("bufferTotal = %d, want 200", result.BufferTotal)
	}
	if len(result.Logs) != 2 {
		t.Fatalf("got %d logs, want 2", len(result.Logs))
	}

	line := result.Logs[0]
	if line.SandboxID != "sb-1" {
		t.Errorf("sandboxId = %q", line.SandboxID)
	}
	if line.TimestampMs != 12345 {
		t.Errorf("timestampMs = %d", line.TimestampMs)
	}
	if line.Level != "WARN" {
		t.Errorf("level = %q", line.Level)
	}
	if line.Target != "policy" {
		t.Errorf("target = %q", line.Target)
	}
	if line.Message != "deny egress to 1.2.3.4" {
		t.Errorf("message = %q", line.Message)
	}
	if line.Source != "gateway" {
		t.Errorf("source = %q", line.Source)
	}
	if line.Fields["dst_host"] != "1.2.3.4" {
		t.Errorf("fields.dst_host = %q", line.Fields["dst_host"])
	}
	if line.Fields["action"] != "deny" {
		t.Errorf("fields.action = %q", line.Fields["action"])
	}

	if len(result.Logs[1].Fields) > 0 {
		t.Errorf("expected nil/empty fields on line 2, got %v", result.Logs[1].Fields)
	}
}

func TestFromSandboxLogsEmpty(t *testing.T) {
	resp := &openshellv1.GetSandboxLogsResponse{}
	result := FromSandboxLogs(resp)

	if len(result.Logs) != 0 {
		t.Errorf("expected empty logs, got %d", len(result.Logs))
	}
	if result.BufferTotal != 0 {
		t.Errorf("bufferTotal = %d, want 0", result.BufferTotal)
	}
}

func TestPolicyStatusString(t *testing.T) {
	tests := []struct {
		want   string
		status openshellv1.PolicyStatus
	}{
		{want: "PENDING", status: openshellv1.PolicyStatus_POLICY_STATUS_PENDING},
		{want: "LOADED", status: openshellv1.PolicyStatus_POLICY_STATUS_LOADED},
		{want: "FAILED", status: openshellv1.PolicyStatus_POLICY_STATUS_FAILED},
		{want: "SUPERSEDED", status: openshellv1.PolicyStatus_POLICY_STATUS_SUPERSEDED},
		{want: "UNSPECIFIED", status: openshellv1.PolicyStatus_POLICY_STATUS_UNSPECIFIED},
	}
	for _, tc := range tests {
		t.Run(tc.want, func(t *testing.T) {
			revision := &openshellv1.SandboxPolicyRevision{
				Version: 1,
				Status:  tc.status,
			}
			got := FromPolicyRevision(revision)
			if got.Status != tc.want {
				t.Errorf("status = %q, want %q", got.Status, tc.want)
			}
		})
	}
}

func TestFromPolicyRevisionFields(t *testing.T) {
	revision := &openshellv1.SandboxPolicyRevision{
		Version:     3,
		PolicyHash:  "abc123",
		Status:      openshellv1.PolicyStatus_POLICY_STATUS_LOADED,
		LoadError:   "",
		CreatedAtMs: 1000,
		LoadedAtMs:  1500,
		Provenance:  map[string]string{"source": "admin"},
	}

	got := FromPolicyRevision(revision)

	if got.Version != 3 {
		t.Errorf("version = %d", got.Version)
	}
	if got.PolicyHash != "abc123" {
		t.Errorf("policyHash = %q", got.PolicyHash)
	}
	if got.CreatedAtMs != 1000 {
		t.Errorf("createdAtMs = %d", got.CreatedAtMs)
	}
	if got.LoadedAtMs != 1500 {
		t.Errorf("loadedAtMs = %d", got.LoadedAtMs)
	}
	if got.Provenance["source"] != "admin" {
		t.Errorf("provenance = %v", got.Provenance)
	}
}

func TestFromDraftPolicy(t *testing.T) {
	resp := &openshellv1.GetDraftPolicyResponse{
		DraftVersion:     2,
		RollingSummary:   "network access requested",
		LastAnalyzedAtMs: 9000,
		Chunks: []*openshellv1.PolicyChunk{
			{
				Id:               "c-1",
				Status:           "pending",
				RuleName:         "allow-api",
				Rationale:        "needs API access",
				SecurityNotes:    "broad port range",
				Confidence:       0.85,
				CreatedAtMs:      5000,
				HitCount:         3,
				Binary:           "agent",
				ValidationResult: "PASS",
			},
			{
				Id:              "c-2",
				Status:          "rejected",
				RuleName:        "allow-all",
				RejectionReason: "too broad",
				DecidedAtMs:     6000,
			},
		},
	}

	got := FromDraftPolicy(resp)

	if got.DraftVersion != 2 {
		t.Errorf("draftVersion = %d", got.DraftVersion)
	}
	if got.RollingSummary != "network access requested" {
		t.Errorf("rollingSummary = %q", got.RollingSummary)
	}
	if got.LastAnalyzedAtMs != 9000 {
		t.Errorf("lastAnalyzedAtMs = %d", got.LastAnalyzedAtMs)
	}
	if len(got.Chunks) != 2 {
		t.Fatalf("got %d chunks, want 2", len(got.Chunks))
	}

	c1 := got.Chunks[0]
	if c1.ID != "c-1" {
		t.Errorf("chunk[0].id = %q", c1.ID)
	}
	if c1.Status != "pending" {
		t.Errorf("chunk[0].status = %q", c1.Status)
	}
	if c1.RuleName != "allow-api" {
		t.Errorf("chunk[0].ruleName = %q", c1.RuleName)
	}
	if c1.Confidence != 0.85 {
		t.Errorf("chunk[0].confidence = %f", c1.Confidence)
	}
	if c1.ValidationResult != "PASS" {
		t.Errorf("chunk[0].validationResult = %q", c1.ValidationResult)
	}
	if c1.Binary != "agent" {
		t.Errorf("chunk[0].binary = %q", c1.Binary)
	}
	if c1.HitCount != 3 {
		t.Errorf("chunk[0].hitCount = %d", c1.HitCount)
	}

	c2 := got.Chunks[1]
	if c2.RejectionReason != "too broad" {
		t.Errorf("chunk[1].rejectionReason = %q", c2.RejectionReason)
	}
	if c2.DecidedAtMs != 6000 {
		t.Errorf("chunk[1].decidedAtMs = %d", c2.DecidedAtMs)
	}
}

func TestFromDraftPolicyEmpty(t *testing.T) {
	resp := &openshellv1.GetDraftPolicyResponse{}
	got := FromDraftPolicy(resp)

	if len(got.Chunks) != 0 {
		t.Errorf("expected empty chunks, got %d", len(got.Chunks))
	}
}

func TestFromDraftHistory(t *testing.T) {
	resp := &openshellv1.GetDraftHistoryResponse{
		Entries: []*openshellv1.DraftHistoryEntry{
			{
				TimestampMs: 1000,
				EventType:   "approved",
				Description: "chunk c-1 approved",
				ChunkId:     "c-1",
			},
			{
				TimestampMs: 2000,
				EventType:   "rejected",
				Description: "chunk c-2 rejected",
				ChunkId:     "c-2",
			},
		},
	}

	got := FromDraftHistory(resp)

	if len(got) != 2 {
		t.Fatalf("got %d entries, want 2", len(got))
	}
	if got[0].EventType != "approved" {
		t.Errorf("entry[0].eventType = %q", got[0].EventType)
	}
	if got[0].ChunkID != "c-1" {
		t.Errorf("entry[0].chunkId = %q", got[0].ChunkID)
	}
	if got[1].TimestampMs != 2000 {
		t.Errorf("entry[1].timestampMs = %d", got[1].TimestampMs)
	}
}

func TestFromDraftHistoryEmpty(t *testing.T) {
	resp := &openshellv1.GetDraftHistoryResponse{}
	got := FromDraftHistory(resp)

	if len(got) != 0 {
		t.Errorf("expected empty history, got %d", len(got))
	}
}

func TestFromServiceEndpointResponse(t *testing.T) {
	resp := &openshellv1.ServiceEndpointResponse{
		Endpoint: &openshellv1.ServiceEndpoint{
			SandboxName: "my-sb",
			ServiceName: "web",
			TargetPort:  8080,
			Domain:      true,
		},
		Url: "https://web.sb.example.com",
	}

	got := FromServiceEndpointResponse(resp)

	if got.SandboxName != "my-sb" {
		t.Errorf("sandboxName = %q", got.SandboxName)
	}
	if got.ServiceName != "web" {
		t.Errorf("serviceName = %q", got.ServiceName)
	}
	if got.TargetPort != 8080 {
		t.Errorf("targetPort = %d", got.TargetPort)
	}
	if !got.Domain {
		t.Error("domain should be true")
	}
	if got.URL != "https://web.sb.example.com" {
		t.Errorf("url = %q", got.URL)
	}
}

func TestSettingValueString(t *testing.T) {
	tests := []struct {
		value *sandboxv1.SettingValue
		name  string
		want  string
	}{
		{
			name:  "string value",
			value: &sandboxv1.SettingValue{Value: &sandboxv1.SettingValue_StringValue{StringValue: "hello"}},
			want:  "hello",
		},
		{
			name:  "bool value",
			value: &sandboxv1.SettingValue{Value: &sandboxv1.SettingValue_BoolValue{BoolValue: true}},
			want:  "true",
		},
		{
			name:  "int value",
			value: &sandboxv1.SettingValue{Value: &sandboxv1.SettingValue_IntValue{IntValue: 42}},
			want:  "42",
		},
		{
			name:  "bytes value",
			value: &sandboxv1.SettingValue{Value: &sandboxv1.SettingValue_BytesValue{BytesValue: []byte{0xde, 0xad}}},
			want:  "dead",
		},
		{
			name:  "nil value",
			value: nil,
			want:  "",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := settingValueString(tc.value)
			if got != tc.want {
				t.Errorf("settingValueString = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestFromGatewaySettings(t *testing.T) {
	resp := &sandboxv1.GetGatewayConfigResponse{
		Settings: map[string]*sandboxv1.SettingValue{
			"beta_features": {Value: &sandboxv1.SettingValue_BoolValue{BoolValue: false}},
			"admin_email":   {Value: &sandboxv1.SettingValue_StringValue{StringValue: "admin@example.com"}},
		},
		SettingsRevision: 10,
	}

	got := FromGatewaySettings(resp)

	if got.SettingsRevision != 10 {
		t.Errorf("settingsRevision = %d", got.SettingsRevision)
	}
	if len(got.Settings) != 2 {
		t.Fatalf("got %d settings, want 2", len(got.Settings))
	}
	if got.Settings[0].Key != "admin_email" {
		t.Errorf("settings[0].key = %q, want admin_email (sorted)", got.Settings[0].Key)
	}
	if got.Settings[1].Key != "beta_features" {
		t.Errorf("settings[1].key = %q", got.Settings[1].Key)
	}
}

func TestFromGatewaySettingsEmpty(t *testing.T) {
	resp := &sandboxv1.GetGatewayConfigResponse{}
	got := FromGatewaySettings(resp)

	if len(got.Settings) != 0 {
		t.Errorf("expected empty settings, got %d", len(got.Settings))
	}
}

func TestFromInferenceRoute(t *testing.T) {
	resp := &inferencev1.GetInferenceRouteResponse{
		RouteName:    "inference.local",
		ProviderName: "claude",
		ModelId:      "claude-sonnet-5",
		Version:      3,
		TimeoutSecs:  60,
	}

	got := FromInferenceRoute(resp)

	if got.RouteName != "inference.local" {
		t.Errorf("routeName = %q", got.RouteName)
	}
	if got.ProviderName != "claude" {
		t.Errorf("providerName = %q", got.ProviderName)
	}
	if got.ModelID != "claude-sonnet-5" {
		t.Errorf("modelId = %q", got.ModelID)
	}
	if got.Version != 3 {
		t.Errorf("version = %d", got.Version)
	}
	if got.TimeoutSecs != 60 {
		t.Errorf("timeoutSecs = %d", got.TimeoutSecs)
	}
}

func TestFromSetInferenceRoute(t *testing.T) {
	resp := &inferencev1.SetInferenceRouteResponse{
		RouteName:    "sandbox-system",
		ProviderName: "nim",
		ModelId:      "llama-3",
		Version:      1,
		TimeoutSecs:  30,
	}

	got := FromSetInferenceRoute(resp)

	if got.RouteName != "sandbox-system" {
		t.Errorf("routeName = %q", got.RouteName)
	}
	if got.ProviderName != "nim" {
		t.Errorf("providerName = %q", got.ProviderName)
	}
	if got.Version != 1 {
		t.Errorf("version = %d", got.Version)
	}
}
