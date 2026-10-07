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

// EffectivePolicy mirrors the policy half of GetSandboxConfigResponse: what
// the sandbox is given to enforce, which is what `openshell policy get` shows
// without --rev. It is not always the latest revision of the sandbox's own
// policy. With PolicySource "GLOBAL" the policy is the gateway-global one and
// the sandbox's own is dormant; otherwise it is the sandbox's own policy plus
// one `_provider_*` rule per attached provider that the gateway composes in.
// Version is the sandbox's own policy version in both cases, and
// GlobalPolicyVersion is set only when the global policy is the source.
type EffectivePolicy struct {
	PolicyHash   string `json:"policyHash,omitempty"`
	PolicySource string `json:"policySource"`
	// PolicyValidationFailureMode is what the gateway does with a revision the
	// sandbox rejects: "fail_closed" or "retain_last_valid".
	PolicyValidationFailureMode string          `json:"policyValidationFailureMode,omitempty"`
	Policy                      json.RawMessage `json:"policy,omitempty"`
	Version                     uint32          `json:"version"`
	GlobalPolicyVersion         uint32          `json:"globalPolicyVersion,omitempty"`
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
	ApplicationError string `json:"applicationError,omitempty"`
	// Stage is the recommendation stage, "initial" or "refined", and
	// SupersedesChunkID the initial chunk a refined one replaces.
	Stage             string `json:"stage,omitempty"`
	SupersedesChunkID string `json:"supersedesChunkId,omitempty"`
	// DenialSummaryIDs names the denial summaries that led to the proposal.
	// HitCount adds those denials up, and FirstSeenMs and LastSeenMs bound them.
	DenialSummaryIDs []string        `json:"denialSummaryIds,omitempty"`
	ProposedRule     json.RawMessage `json:"proposedRule,omitempty"`
	// CurrentEffectivePolicy and CandidateEffectivePolicy carry the full
	// before/after policies (protojson) so the draft inbox can render a diff.
	CurrentEffectivePolicy   json.RawMessage `json:"currentEffectivePolicy,omitempty"`
	CandidateEffectivePolicy json.RawMessage `json:"candidateEffectivePolicy,omitempty"`
	DecidedAtMs              int64           `json:"decidedAtMs,omitempty"`
	CreatedAtMs              int64           `json:"createdAtMs"`
	FirstSeenMs              int64           `json:"firstSeenMs,omitempty"`
	LastSeenMs               int64           `json:"lastSeenMs,omitempty"`
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

// DraftSandboxSummary counts the pending draft chunks of one sandbox, as read
// with GetDraftPolicy and the status filter "pending". HasSecurityFlags says
// whether any of them carries security notes, and LatestDraftMs is when the
// newest was created.
//
// Unavailable marks a sandbox whose inbox could not be read. Its count is not
// known, which is not the same as none pending, so PendingCount is 0 and
// means nothing.
type DraftSandboxSummary struct {
	Workspace        string `json:"workspace"`
	SandboxName      string `json:"sandboxName"`
	LatestDraftMs    int64  `json:"latestDraftMs"`
	PendingCount     int    `json:"pendingCount"`
	HasSecurityFlags bool   `json:"hasSecurityFlags"`
	Unavailable      bool   `json:"unavailable,omitempty"`
}

// DraftSummary is the pending draft chunks of several sandboxes at once. No
// RPC answers that: it is one GetDraftPolicy per sandbox, the way the TUI
// fills in its "N pending rules" badges.
//
// Sandboxes holds one entry per sandbox that has pending chunks or whose
// inbox could not be read. A sandbox that is not in it has none pending.
// TotalPending adds up the counts that could be read.
type DraftSummary struct {
	Sandboxes    []DraftSandboxSummary `json:"sandboxes"`
	TotalPending int                   `json:"totalPending"`
}

// ServiceEndpoint mirrors openshell.v1.ServiceEndpointResponse. ServiceName is
// empty for a sandbox's unnamed endpoint, which the gateway allows one of.
// Workspace is what tells endpoints apart in a list that spans workspaces.
type ServiceEndpoint struct {
	ID          string `json:"id,omitempty"`
	Workspace   string `json:"workspace,omitempty"`
	SandboxID   string `json:"sandboxId,omitempty"`
	SandboxName string `json:"sandboxName"`
	ServiceName string `json:"serviceName"`
	URL         string `json:"url,omitempty"`
	TargetPort  uint32 `json:"targetPort"`
	Domain      bool   `json:"domain"`
}

// SettingEntry is one entry of the gateway's settings map. Value mirrors the
// gateway's typed SettingValue as the matching JSON type: a string, a boolean
// or an integer. It is absent for a setting that has no value, which is how
// the gateway lists a key it knows but that was never set — and for those it
// does not say which type the key takes.
type SettingEntry struct {
	Value any    `json:"value,omitempty"`
	Key   string `json:"key"`
}

// GatewaySettings mirrors GetGatewayConfigResponse as a flat list.
type GatewaySettings struct {
	Settings         []SettingEntry `json:"settings"`
	SettingsRevision uint64         `json:"settingsRevision"`
}
