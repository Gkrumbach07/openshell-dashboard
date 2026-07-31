package models

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	openshell "github.com/rhuss/openshell-sdk-go/openshell/v1"
)

// LogLine mirrors openshell.LogLine. The fields map carries structured
// network-decision context (dst_host, action, ...).
type LogLine struct {
	TimestampMs int64             `json:"timestampMs"`
	Level       string            `json:"level,omitempty"`
	Target      string            `json:"target,omitempty"`
	Message     string            `json:"message"`
	Source      string            `json:"source,omitempty"`
	Fields      map[string]string `json:"fields,omitempty"`
}

// SandboxLogs mirrors openshell.LogResult.
type SandboxLogs struct {
	Logs        []LogLine `json:"logs"`
	BufferTotal uint32    `json:"bufferTotal"`
}

func FromSandboxLogs(result *openshell.LogResult) SandboxLogs {
	out := SandboxLogs{Logs: []LogLine{}, BufferTotal: result.BufferTotal}
	for _, line := range result.Lines {
		out.Logs = append(out.Logs, LogLine{
			TimestampMs: timeToMs(line.Timestamp),
			Level:       line.Level,
			Target:      line.Target,
			Message:     line.Message,
			Source:      line.Source,
			Fields:      line.Fields,
		})
	}
	return out
}

// PolicyRevision mirrors openshell.SandboxPolicyRevision. Policy content
// is camelCase JSON when the gateway populated it.
type PolicyRevision struct {
	Version    uint32          `json:"version"`
	PolicyHash string          `json:"policyHash,omitempty"`
	Status     string          `json:"status"`
	LoadError  string          `json:"loadError,omitempty"`
	CreatedAtMs int64          `json:"createdAtMs"`
	LoadedAtMs  int64          `json:"loadedAtMs,omitempty"`
	Policy      json.RawMessage `json:"policy,omitempty"`
}

func FromPolicyRevision(revision *openshell.SandboxPolicyRevision) PolicyRevision {
	out := PolicyRevision{
		Version:     revision.Version,
		PolicyHash:  revision.PolicyHash,
		Status:      strings.ToUpper(revision.Status.String()),
		LoadError:   revision.LoadError,
		CreatedAtMs: timeToMs(revision.CreatedAt),
		LoadedAtMs:  timeToMs(revision.LoadedAt),
	}
	if revision.Policy != nil {
		out.Policy = marshalPolicy(revision.Policy)
	}
	return out
}

// SandboxPolicyView is the GET .../policy response: the latest revision, the
// currently active version, and the revision history.
type SandboxPolicyView struct {
	ActiveVersion uint32           `json:"activeVersion"`
	Latest        *PolicyRevision  `json:"latest,omitempty"`
	Revisions     []PolicyRevision `json:"revisions"`
}

// PolicyUpdateResult mirrors ConfigUpdateResult for policy updates.
type PolicyUpdateResult struct {
	Version    uint32 `json:"version"`
	PolicyHash string `json:"policyHash,omitempty"`
}

// PolicyChunk mirrors openshell.PolicyChunk.
type PolicyChunk struct {
	ID               string          `json:"id"`
	Status           string          `json:"status"`
	RuleName         string          `json:"ruleName,omitempty"`
	ProposedRule     json.RawMessage `json:"proposedRule,omitempty"`
	Rationale        string          `json:"rationale,omitempty"`
	SecurityNotes    string          `json:"securityNotes,omitempty"`
	Confidence       float32         `json:"confidence"`
	CreatedAtMs      int64           `json:"createdAtMs"`
	DecidedAtMs      int64           `json:"decidedAtMs,omitempty"`
	HitCount         int32           `json:"hitCount"`
	Binary           string          `json:"binary,omitempty"`
	ValidationResult string          `json:"validationResult,omitempty"`
	RejectionReason  string          `json:"rejectionReason,omitempty"`
}

// DraftPolicy mirrors openshell.DraftPolicy.
type DraftPolicy struct {
	Chunks           []PolicyChunk `json:"chunks"`
	RollingSummary   string        `json:"rollingSummary,omitempty"`
	DraftVersion     uint64        `json:"draftVersion"`
	LastAnalyzedAtMs int64         `json:"lastAnalyzedAtMs,omitempty"`
}

func FromDraftPolicy(draft *openshell.DraftPolicy) DraftPolicy {
	out := DraftPolicy{
		Chunks:           []PolicyChunk{},
		RollingSummary:   draft.RollingSummary,
		DraftVersion:     draft.DraftVersion,
		LastAnalyzedAtMs: timeToMs(draft.LastAnalyzedAt),
	}
	for _, chunk := range draft.Chunks {
		item := PolicyChunk{
			ID:               chunk.ID,
			Status:           chunk.Status,
			RuleName:         chunk.RuleName,
			Rationale:        chunk.Rationale,
			SecurityNotes:    chunk.SecurityNotes,
			Confidence:       chunk.Confidence,
			CreatedAtMs:      timeToMs(chunk.CreatedAt),
			DecidedAtMs:      timeToMs(chunk.DecidedAt),
			HitCount:         chunk.HitCount,
			Binary:           chunk.Binary,
			ValidationResult: chunk.ValidationResult,
			RejectionReason:  chunk.RejectionReason,
		}
		item.ProposedRule = MarshalNetworkPolicyRule(chunk.ProposedRule)
		out.Chunks = append(out.Chunks, item)
	}
	return out
}

// DraftHistoryEntry mirrors openshell.DraftHistoryEntry.
type DraftHistoryEntry struct {
	TimestampMs int64  `json:"timestampMs"`
	EventType   string `json:"eventType"`
	Description string `json:"description"`
	ChunkID     string `json:"chunkId,omitempty"`
}

func FromDraftHistory(entries []openshell.DraftHistoryEntry) []DraftHistoryEntry {
	out := make([]DraftHistoryEntry, 0, len(entries))
	for _, e := range entries {
		out = append(out, DraftHistoryEntry{
			TimestampMs: timeToMs(e.Timestamp),
			EventType:   e.EventType,
			Description: e.Description,
			ChunkID:     e.ChunkID,
		})
	}
	return out
}

// ServiceEndpoint mirrors openshell.ServiceEndpoint.
type ServiceEndpoint struct {
	SandboxName string `json:"sandboxName"`
	ServiceName string `json:"serviceName"`
	TargetPort  uint32 `json:"targetPort"`
	Domain      bool   `json:"domain"`
	URL         string `json:"url,omitempty"`
}

func FromServiceEndpoint(ep *openshell.ServiceEndpoint) ServiceEndpoint {
	return ServiceEndpoint{
		SandboxName: ep.SandboxName,
		ServiceName: ep.ServiceName,
		TargetPort:  ep.TargetPort,
		Domain:      ep.Domain,
		URL:         ep.URL,
	}
}

// SettingEntry is one key/value pair from the gateway config map.
type SettingEntry struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// GatewaySettings mirrors openshell.GatewayConfig as a flat list.
type GatewaySettings struct {
	Settings         []SettingEntry `json:"settings"`
	SettingsRevision uint64         `json:"settingsRevision"`
}

func settingValueString(sv openshell.SettingValue) string {
	switch sv.Type {
	case "string":
		return sv.StringVal
	case "bool":
		return fmt.Sprintf("%t", sv.BoolVal)
	case "int":
		return fmt.Sprintf("%d", sv.IntVal)
	case "bytes":
		return fmt.Sprintf("%x", sv.BytesVal)
	}
	return ""
}

func FromGatewaySettings(config *openshell.GatewayConfig) GatewaySettings {
	out := GatewaySettings{
		Settings:         []SettingEntry{},
		SettingsRevision: config.SettingsRevision,
	}
	for key, val := range config.Settings {
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

// InferenceRoute mirrors openshell.InferenceRoute.
type InferenceRoute struct {
	RouteName    string `json:"routeName"`
	ProviderName string `json:"providerName"`
	ModelID      string `json:"modelId"`
	Version      uint64 `json:"version"`
	TimeoutSecs  uint64 `json:"timeoutSecs"`
}

func FromInferenceRoute(route *openshell.InferenceRoute) InferenceRoute {
	return InferenceRoute{
		RouteName:    route.RouteName,
		ProviderName: route.ProviderName,
		ModelID:      route.ModelID,
		Version:      route.Version,
		TimeoutSecs:  route.TimeoutSecs,
	}
}
