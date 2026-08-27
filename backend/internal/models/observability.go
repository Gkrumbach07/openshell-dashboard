package models

import "encoding/json"

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
	// ReviewToken pins an approval to the exact evaluated candidate (optimistic
	// concurrency). The BFF resolves it server-side on approve; exposed so a
	// client can echo it directly.
	ReviewToken      string `json:"reviewToken,omitempty"`
	Status           string `json:"status"`
	RuleName         string `json:"ruleName,omitempty"`
	Rationale        string `json:"rationale,omitempty"`
	SecurityNotes    string `json:"securityNotes,omitempty"`
	ID               string `json:"id"`
	RejectionReason  string `json:"rejectionReason,omitempty"`
	Binary           string `json:"binary,omitempty"`
	ValidationResult string `json:"validationResult,omitempty"`
	// CandidateEffectivePolicyHash and CurrentEffectivePolicyHash identify the
	// before/after effective policies for a diff view.
	CandidateEffectivePolicyHash string `json:"candidateEffectivePolicyHash,omitempty"`
	CurrentEffectivePolicyHash   string `json:"currentEffectivePolicyHash,omitempty"`
	// ApplicationError is set when a prover-clean chunk still fails to apply to
	// the complete candidate policy (explains "clean but not applicable").
	ApplicationError string          `json:"applicationError,omitempty"`
	ProposedRule     json.RawMessage `json:"proposedRule,omitempty"`
	// CurrentEffectivePolicy and CandidateEffectivePolicy carry the full
	// before/after policies (protojson) so the draft inbox can render a diff.
	CurrentEffectivePolicy   json.RawMessage `json:"currentEffectivePolicy,omitempty"`
	CandidateEffectivePolicy json.RawMessage `json:"candidateEffectivePolicy,omitempty"`
	DecidedAtMs              int64           `json:"decidedAtMs,omitempty"`
	CreatedAtMs              int64           `json:"createdAtMs"`
	HitCount                 int32           `json:"hitCount"`
	Confidence               float32         `json:"confidence"`
}

// DraftPolicy mirrors GetDraftPolicyResponse.
type DraftPolicy struct {
	RollingSummary   string        `json:"rollingSummary,omitempty"`
	Chunks           []PolicyChunk `json:"chunks"`
	DraftVersion     uint64        `json:"draftVersion"`
	LastAnalyzedAtMs int64         `json:"lastAnalyzedAtMs,omitempty"`
}

// DraftHistoryEntry mirrors openshell.v1.DraftHistoryEntry.
type DraftHistoryEntry struct {
	EventType   string `json:"eventType"`
	Description string `json:"description"`
	ChunkID     string `json:"chunkId,omitempty"`
	TimestampMs int64  `json:"timestampMs"`
}

// ServiceEndpoint mirrors openshell.v1.ServiceEndpointResponse.
type ServiceEndpoint struct {
	SandboxName string `json:"sandboxName"`
	ServiceName string `json:"serviceName"`
	URL         string `json:"url,omitempty"`
	TargetPort  uint32 `json:"targetPort"`
	Domain      bool   `json:"domain"`
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

// InferenceRoute mirrors GetInferenceRouteResponse. Route "" is the
// user-facing inference.local route; "sandbox-system" is the system route.
type InferenceRoute struct {
	RouteName    string `json:"routeName"`
	ProviderName string `json:"providerName"`
	ModelID      string `json:"modelId"`
	Version      uint64 `json:"version"`
	TimeoutSecs  uint64 `json:"timeoutSecs"`
}
