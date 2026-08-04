package models

import (
	"encoding/json"
	"fmt"
	"sort"

	inferencev1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/inferencev1"
	openshellv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/openshellv1"
	sandboxv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/sandboxv1"
)

// LogLine mirrors openshell.v1.SandboxLogLine. The fields map carries
// structured network-decision context (dst_host, action, …) — the dashboard's
// only window into security decisions (there is no events API).
type LogLine struct {
	Fields      map[string]string `json:"fields,omitempty"`
	SandboxID   string            `json:"sandboxId,omitempty"`
	Level       string            `json:"level,omitempty"`
	Target      string            `json:"target,omitempty"`
	Message     string            `json:"message"`
	Source      string            `json:"source,omitempty"`
	TimestampMs int64             `json:"timestampMs"`
}

// SandboxLogs mirrors GetSandboxLogsResponse.
type SandboxLogs struct {
	Logs        []LogLine `json:"logs"`
	BufferTotal uint32    `json:"bufferTotal"`
}

func FromSandboxLogs(resp *openshellv1.GetSandboxLogsResponse) SandboxLogs {
	out := SandboxLogs{Logs: []LogLine{}, BufferTotal: resp.GetBufferTotal()}
	for _, line := range resp.GetLogs() {
		out.Logs = append(out.Logs, LogLine{
			SandboxID:   line.SandboxId,
			TimestampMs: line.TimestampMs,
			Level:       line.Level,
			Target:      line.Target,
			Message:     line.Message,
			Source:      line.Source,
			Fields:      line.Fields,
		})
	}
	return out
}

// PolicyRevision mirrors openshell.v1.SandboxPolicyRevision. Policy content
// is protojson when the gateway populated it.
type PolicyRevision struct {
	Provenance  map[string]string `json:"provenance,omitempty"`
	PolicyHash  string            `json:"policyHash,omitempty"`
	Status      string            `json:"status"`
	LoadError   string            `json:"loadError,omitempty"`
	Policy      json.RawMessage   `json:"policy,omitempty"`
	CreatedAtMs int64             `json:"createdAtMs"`
	LoadedAtMs  int64             `json:"loadedAtMs,omitempty"`
	Version     uint32            `json:"version"`
}

func policyStatusString(status openshellv1.PolicyStatus) string {
	switch status {
	case openshellv1.PolicyStatus_POLICY_STATUS_PENDING:
		return "PENDING"
	case openshellv1.PolicyStatus_POLICY_STATUS_LOADED:
		return "LOADED"
	case openshellv1.PolicyStatus_POLICY_STATUS_FAILED:
		return "FAILED"
	case openshellv1.PolicyStatus_POLICY_STATUS_SUPERSEDED:
		return "SUPERSEDED"
	}
	return "UNSPECIFIED"
}

func FromPolicyRevision(revision *openshellv1.SandboxPolicyRevision) PolicyRevision {
	out := PolicyRevision{
		Version:     revision.GetVersion(),
		PolicyHash:  revision.GetPolicyHash(),
		Status:      policyStatusString(revision.GetStatus()),
		LoadError:   revision.GetLoadError(),
		CreatedAtMs: revision.GetCreatedAtMs(),
		LoadedAtMs:  revision.GetLoadedAtMs(),
		Provenance:  revision.GetProvenance(),
	}
	if revision.GetPolicy() != nil {
		if raw, err := policyMarshaler.Marshal(revision.GetPolicy()); err == nil {
			out.Policy = raw
		}
	}
	return out
}

// SandboxPolicyView is the GET .../policy response: the latest revision, the
// currently active version, and the revision history.
type SandboxPolicyView struct {
	Latest        *PolicyRevision  `json:"latest,omitempty"`
	Revisions     []PolicyRevision `json:"revisions"`
	ActiveVersion uint32           `json:"activeVersion"`
}

// PolicyUpdateResult mirrors UpdateConfigResponse for policy updates.
type PolicyUpdateResult struct {
	PolicyHash string `json:"policyHash,omitempty"`
	Version    uint32 `json:"version"`
}

// PolicyChunk mirrors openshell.v1.PolicyChunk — one draft policy proposal.
// ProposedRule is protojson of a NetworkPolicyRule. ValidationResult carries
// the gateway prover verdict (there is no separate verify RPC).
type PolicyChunk struct {
	ValidationResult string          `json:"validationResult,omitempty"`
	Status           string          `json:"status"`
	RuleName         string          `json:"ruleName,omitempty"`
	Rationale        string          `json:"rationale,omitempty"`
	SecurityNotes    string          `json:"securityNotes,omitempty"`
	ID               string          `json:"id"`
	RejectionReason  string          `json:"rejectionReason,omitempty"`
	Binary           string          `json:"binary,omitempty"`
	ProposedRule     json.RawMessage `json:"proposedRule,omitempty"`
	CreatedAtMs      int64           `json:"createdAtMs"`
	DecidedAtMs      int64           `json:"decidedAtMs,omitempty"`
	Confidence       float32         `json:"confidence"`
	HitCount         int32           `json:"hitCount"`
}

// DraftPolicy mirrors GetDraftPolicyResponse.
type DraftPolicy struct {
	RollingSummary   string        `json:"rollingSummary,omitempty"`
	Chunks           []PolicyChunk `json:"chunks"`
	DraftVersion     uint64        `json:"draftVersion"`
	LastAnalyzedAtMs int64         `json:"lastAnalyzedAtMs,omitempty"`
}

func FromDraftPolicy(resp *openshellv1.GetDraftPolicyResponse) DraftPolicy {
	out := DraftPolicy{
		Chunks:           []PolicyChunk{},
		RollingSummary:   resp.GetRollingSummary(),
		DraftVersion:     resp.GetDraftVersion(),
		LastAnalyzedAtMs: resp.GetLastAnalyzedAtMs(),
	}
	for _, chunk := range resp.GetChunks() {
		item := PolicyChunk{
			ID:               chunk.Id,
			Status:           chunk.Status,
			RuleName:         chunk.RuleName,
			Rationale:        chunk.Rationale,
			SecurityNotes:    chunk.SecurityNotes,
			Confidence:       chunk.Confidence,
			CreatedAtMs:      chunk.CreatedAtMs,
			DecidedAtMs:      chunk.DecidedAtMs,
			HitCount:         chunk.HitCount,
			Binary:           chunk.Binary,
			ValidationResult: chunk.ValidationResult,
			RejectionReason:  chunk.RejectionReason,
		}
		if chunk.ProposedRule != nil {
			if raw, err := policyMarshaler.Marshal(chunk.ProposedRule); err == nil {
				item.ProposedRule = raw
			}
		}
		out.Chunks = append(out.Chunks, item)
	}
	return out
}

// DraftHistoryEntry mirrors openshell.v1.DraftHistoryEntry.
type DraftHistoryEntry struct {
	EventType   string `json:"eventType"`
	Description string `json:"description"`
	ChunkID     string `json:"chunkId,omitempty"`
	TimestampMs int64  `json:"timestampMs"`
}

func FromDraftHistory(resp *openshellv1.GetDraftHistoryResponse) []DraftHistoryEntry {
	out := make([]DraftHistoryEntry, 0, len(resp.GetEntries()))
	for _, e := range resp.GetEntries() {
		out = append(out, DraftHistoryEntry{
			TimestampMs: e.GetTimestampMs(),
			EventType:   e.GetEventType(),
			Description: e.GetDescription(),
			ChunkID:     e.GetChunkId(),
		})
	}
	return out
}

// ServiceEndpoint mirrors openshell.v1.ServiceEndpointResponse.
type ServiceEndpoint struct {
	SandboxName string `json:"sandboxName"`
	ServiceName string `json:"serviceName"`
	URL         string `json:"url,omitempty"`
	TargetPort  uint32 `json:"targetPort"`
	Domain      bool   `json:"domain"`
}

func FromServiceEndpointResponse(resp *openshellv1.ServiceEndpointResponse) ServiceEndpoint {
	ep := resp.GetEndpoint()
	return ServiceEndpoint{
		SandboxName: ep.GetSandboxName(),
		ServiceName: ep.GetServiceName(),
		TargetPort:  ep.GetTargetPort(),
		Domain:      ep.GetDomain(),
		URL:         resp.GetUrl(),
	}
}

// SettingEntry is one key/value pair from the gateway config map.
type SettingEntry struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// GatewaySettings mirrors GetGatewayConfigResponse as a flat list.
type GatewaySettings struct {
	Settings         []SettingEntry `json:"settings"`
	SettingsRevision uint64         `json:"settingsRevision"`
}

func settingValueString(sv *sandboxv1.SettingValue) string {
	if sv == nil {
		return ""
	}
	switch v := sv.Value.(type) {
	case *sandboxv1.SettingValue_StringValue:
		return v.StringValue
	case *sandboxv1.SettingValue_BoolValue:
		return fmt.Sprintf("%t", v.BoolValue)
	case *sandboxv1.SettingValue_IntValue:
		return fmt.Sprintf("%d", v.IntValue)
	case *sandboxv1.SettingValue_BytesValue:
		return fmt.Sprintf("%x", v.BytesValue)
	}
	return ""
}

func FromGatewaySettings(resp *sandboxv1.GetGatewayConfigResponse) GatewaySettings {
	out := GatewaySettings{
		Settings:         []SettingEntry{},
		SettingsRevision: resp.GetSettingsRevision(),
	}
	for key, val := range resp.GetSettings() {
		out.Settings = append(out.Settings, SettingEntry{
			Key:   key,
			Value: settingValueString(val),
		})
	}
	sort.Slice(out.Settings, func(i, j int) bool {
		return out.Settings[i].Key < out.Settings[j].Key
	})
	return out
}

// InferenceRoute mirrors GetInferenceRouteResponse. Route "" is the
// user-facing inference.local route; "sandbox-system" is the system route.
type InferenceRoute struct {
	RouteName    string `json:"routeName"`
	ProviderName string `json:"providerName"`
	ModelID      string `json:"modelId"`
	Version      uint64 `json:"version"`
	TimeoutSecs  uint64 `json:"timeoutSecs"`
}

func FromInferenceRoute(resp *inferencev1.GetInferenceRouteResponse) InferenceRoute {
	return InferenceRoute{
		RouteName:    resp.GetRouteName(),
		ProviderName: resp.GetProviderName(),
		ModelID:      resp.GetModelId(),
		Version:      resp.GetVersion(),
		TimeoutSecs:  resp.GetTimeoutSecs(),
	}
}

func FromSetInferenceRoute(resp *inferencev1.SetInferenceRouteResponse) InferenceRoute {
	return InferenceRoute{
		RouteName:    resp.GetRouteName(),
		ProviderName: resp.GetProviderName(),
		ModelID:      resp.GetModelId(),
		Version:      resp.GetVersion(),
		TimeoutSecs:  resp.GetTimeoutSecs(),
	}
}
