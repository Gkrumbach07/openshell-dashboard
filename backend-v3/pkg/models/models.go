// Package models defines the representations that handlers, services, and
// clients agree on. Keeping models in their own package (rather than inside
// services/ or handlers/) avoids import cycles: a handler imports a
// service's models, a service imports a client's models, and everyone can
// import this package without importing each other.
//
// These types are scaffolded 1:1 against the upstream OpenShell Go SDK
// (github.com/rhuss/openshell-sdk-go, package openshell/v1) -- see
// https://ro14nd.de/openshell-sdk-go/api/overview.html for the SDK's own
// interface docs. Fields are trimmed to what a dashboard UI plausibly needs;
// add more from the SDK's types package as real handlers are implemented.
package models

import "time"

// --- Gateway / Health (SDK: HealthInterface, client.Health()) ---

// GatewayInfo describes the OpenShell gateway a workspace talks to.
type GatewayInfo struct {
	Version        string              `json:"version"`
	Status         string              `json:"status,omitempty"`
	ComputeDrivers []ComputeDriverInfo `json:"computeDrivers,omitempty"`
}

// ComputeDriverInfo describes a compute backend available on the gateway.
type ComputeDriverInfo struct {
	Name          string `json:"name"`
	DriverName    string `json:"driverName,omitempty"`
	DriverVersion string `json:"driverVersion,omitempty"`
}

// HealthResult is the outcome of a gateway health check.
type HealthResult struct {
	Healthy bool   `json:"healthy"`
	Version string `json:"version,omitempty"`
}

// CurrentUser is the authenticated caller's identity, as resolved by the
// gateway from the bearer token the BFF forwards.
type CurrentUser struct {
	Subject          string   `json:"subject"`
	DisplayName      string   `json:"displayName,omitempty"`
	Roles            []string `json:"roles,omitempty"`
	Scopes           []string `json:"scopes,omitempty"`
	IdentityProvider string   `json:"identityProvider,omitempty"`
}

// --- Sandbox (SDK: SandboxInterface, client.Sandboxes()) ---

// Sandbox is a single OpenShell sandbox. Sandbox is the fundamental unit in
// the upstream API -- there is no separate "Agent" concept.
type Sandbox struct {
	ID              string            `json:"id,omitempty"`
	Workspace       string            `json:"workspace"`
	Name            string            `json:"name"`
	Labels          map[string]string `json:"labels,omitempty"`
	CreatedAt       time.Time         `json:"createdAt,omitempty"`
	ResourceVersion uint64            `json:"resourceVersion,omitempty"`
	Phase           string            `json:"phase,omitempty"`
	Providers       []string          `json:"providers,omitempty"`
}

// SandboxSpec is the desired-state payload for creating a sandbox.
type SandboxSpec struct {
	Image       string            `json:"image,omitempty"`
	Environment map[string]string `json:"environment,omitempty"`
	Providers   []string          `json:"providers,omitempty"`
	GPUCount    *uint32           `json:"gpuCount,omitempty"`
}

// AttachProviderResult is the outcome of attaching a provider to a sandbox.
type AttachProviderResult struct {
	Attached bool     `json:"attached"`
	Sandbox  *Sandbox `json:"sandbox,omitempty"`
}

// DetachProviderResult is the outcome of detaching a provider from a
// sandbox.
type DetachProviderResult struct {
	Detached bool     `json:"detached"`
	Sandbox  *Sandbox `json:"sandbox,omitempty"`
}

// LogLine is a single log entry from a sandbox.
type LogLine struct {
	Timestamp time.Time         `json:"timestamp"`
	Level     string            `json:"level,omitempty"`
	Target    string            `json:"target,omitempty"`
	Message   string            `json:"message"`
	Source    string            `json:"source,omitempty"`
	Fields    map[string]string `json:"fields,omitempty"`
}

// LogResult is the response to a GetLogs call.
type LogResult struct {
	Lines       []LogLine `json:"lines"`
	BufferTotal uint32    `json:"bufferTotal"`
}

// LogOptions filters a GetLogs call. Mirrors the SDK's functional
// WithLog* options as a plain struct, since HTTP query params aren't
// functional options.
type LogOptions struct {
	Lines    uint32    `json:"lines,omitempty"`
	Since    time.Time `json:"since,omitempty"`
	Sources  []string  `json:"sources,omitempty"`
	MinLevel string    `json:"minLevel,omitempty"`
}

// SandboxEvent is a single Watch event for a sandbox.
type SandboxEvent struct {
	Type    string   `json:"type"` // ADDED, MODIFIED, DELETED, ERROR
	Sandbox *Sandbox `json:"sandbox,omitempty"`
}

// --- Exec (SDK: ExecInterface, client.Exec()) ---

// ExecResult is the collected output of a one-shot command execution.
type ExecResult struct {
	ExitCode int    `json:"exitCode"`
	Stdout   string `json:"stdout"`
	Stderr   string `json:"stderr"`
}

// ExecChunk is a single chunk of output from a streaming command execution.
type ExecChunk struct {
	Stream string `json:"stream"` // "stdout" or "stderr"
	Data   string `json:"data"`
}

// --- Provider (SDK: ProviderInterface, client.Providers()) ---

// Provider is a registered compute/inference provider.
type Provider struct {
	ID              string            `json:"id,omitempty"`
	Workspace       string            `json:"workspace"`
	Name            string            `json:"name"`
	Type            string            `json:"type"`
	Labels          map[string]string `json:"labels,omitempty"`
	CreatedAt       time.Time         `json:"createdAt,omitempty"`
	ResourceVersion uint64            `json:"resourceVersion,omitempty"`
	Spec            ProviderSpec      `json:"spec"`
}

// ProviderSpec holds provider-specific configuration and credentials.
type ProviderSpec struct {
	Credentials map[string]string `json:"credentials,omitempty"`
	Config      map[string]string `json:"config,omitempty"`
}

// --- Profile (SDK: ProfileInterface, client.Providers().Profiles()) ---

// ProviderProfile is a template of connection details/defaults for a
// provider type (e.g. "openai", "anthropic").
type ProviderProfile struct {
	ID               string              `json:"id,omitempty"`
	DisplayName      string              `json:"displayName"`
	Description      string              `json:"description,omitempty"`
	Category         string              `json:"category,omitempty"`
	Credentials      []ProfileCredential `json:"credentials,omitempty"`
	Endpoints        []NetworkEndpoint   `json:"endpoints,omitempty"`
	InferenceCapable bool                `json:"inferenceCapable,omitempty"`
	ResourceVersion  uint64              `json:"resourceVersion,omitempty"`
}

// ProfileCredential describes a single credential a profile requires.
type ProfileCredential struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Required    bool   `json:"required,omitempty"`
	Secret      bool   `json:"secret,omitempty"`
}

// NetworkEndpoint is a simplified endpoint (host/port/protocol) exposed by a
// profile's provider type.
type NetworkEndpoint struct {
	Host     string `json:"host"`
	Port     uint32 `json:"port,omitempty"`
	Protocol string `json:"protocol,omitempty"`
}

// ProfileImportItem is one profile submitted for import, update, or lint.
type ProfileImportItem struct {
	Profile ProviderProfile `json:"profile"`
	Source  string          `json:"source,omitempty"`
}

// ProfileDiagnostic is a validation finding from Import, Update, or Lint.
type ProfileDiagnostic struct {
	ProfileID string `json:"profileId,omitempty"`
	Field     string `json:"field,omitempty"`
	Message   string `json:"message"`
	Severity  string `json:"severity,omitempty"`
}

// ImportResult is the outcome of importing one or more profiles.
type ImportResult struct {
	Imported    bool                `json:"imported"`
	Profiles    []ProviderProfile   `json:"profiles,omitempty"`
	Diagnostics []ProfileDiagnostic `json:"diagnostics,omitempty"`
}

// UpdateResult is the outcome of updating a profile.
type UpdateResult struct {
	Updated     bool                `json:"updated"`
	Profile     *ProviderProfile    `json:"profile,omitempty"`
	Diagnostics []ProfileDiagnostic `json:"diagnostics,omitempty"`
}

// LintResult is the outcome of validating profiles without persisting them.
type LintResult struct {
	Valid       bool                `json:"valid"`
	Diagnostics []ProfileDiagnostic `json:"diagnostics,omitempty"`
}

// --- Refresh (SDK: RefreshInterface, client.Providers().Refresh()) ---

// RefreshStatus reports credential-refresh state for one provider
// credential.
type RefreshStatus struct {
	ProviderName  string    `json:"providerName"`
	CredentialKey string    `json:"credentialKey"`
	Strategy      string    `json:"strategy,omitempty"`
	Status        string    `json:"status,omitempty"`
	ExpiresAt     time.Time `json:"expiresAt,omitempty"`
	NextRefreshAt time.Time `json:"nextRefreshAt,omitempty"`
	LastRefreshAt time.Time `json:"lastRefreshAt,omitempty"`
	LastError     string    `json:"lastError,omitempty"`
}

// RefreshConfig configures automatic credential rotation for a provider
// credential.
type RefreshConfig struct {
	Provider           string            `json:"provider"`
	CredentialKey      string            `json:"credentialKey"`
	Strategy           string            `json:"strategy"`
	Material           map[string]string `json:"material,omitempty"`
	SecretMaterialKeys []string          `json:"secretMaterialKeys,omitempty"`
}

// --- Service (SDK: ServiceInterface, client.Services()) ---
//
// Named ServiceEndpoint (not "Service") to avoid colliding with this
// project's own service-layer terminology (pkg/services/...).

// ServiceEndpoint is a sandbox port exposed as a named, externally
// reachable endpoint.
type ServiceEndpoint struct {
	ID          string `json:"id,omitempty"`
	Workspace   string `json:"workspace"`
	SandboxName string `json:"sandboxName"`
	ServiceName string `json:"serviceName"`
	TargetPort  uint32 `json:"targetPort"`
	Domain      bool   `json:"domain,omitempty"`
	URL         string `json:"url,omitempty"`
}

// --- SSH (SDK: SSHInterface, client.SSH()) ---

// SSHSession describes a live SSH session for a sandbox.
//
// Token is a sensitive credential -- callers must not log it. It is
// included here because the browser client needs it to open the tunnel;
// treat responses containing it as sensitive in transit and at rest.
type SSHSession struct {
	SandboxID     string `json:"sandboxId"`
	Token         string `json:"token"`
	GatewayHost   string `json:"gatewayHost"`
	GatewayPort   uint32 `json:"gatewayPort"`
	GatewayScheme string `json:"gatewayScheme"`
	ExpiresAtMs   int64  `json:"expiresAtMs,omitempty"`
}

// --- Config (SDK: ConfigInterface, client.Config()) ---

// SettingValue is a typed setting value. Type indicates which of the
// remaining fields is populated.
type SettingValue struct {
	Type      string `json:"type"` // "string" | "bool" | "int" | "bytes"
	StringVal string `json:"stringVal,omitempty"`
	BoolVal   bool   `json:"boolVal,omitempty"`
	IntVal    int64  `json:"intVal,omitempty"`
}

// EffectiveSetting pairs a resolved setting value with the scope it came
// from.
type EffectiveSetting struct {
	Value SettingValue `json:"value"`
	Scope string       `json:"scope,omitempty"` // "sandbox" | "global"
}

// SandboxConfig is the full configuration state of a sandbox.
type SandboxConfig struct {
	PolicyVersion  uint32                      `json:"policyVersion"`
	PolicyHash     string                      `json:"policyHash,omitempty"`
	Settings       map[string]EffectiveSetting `json:"settings,omitempty"`
	ConfigRevision uint64                      `json:"configRevision"`
}

// GatewayConfig is gateway-global configuration state.
type GatewayConfig struct {
	Settings         map[string]SettingValue `json:"settings,omitempty"`
	SettingsRevision uint64                  `json:"settingsRevision"`
}

// ConfigUpdate is a configuration mutation request. Set Name for a
// sandbox-scoped update, or Global for a gateway-scoped one.
type ConfigUpdate struct {
	Name          string        `json:"name,omitempty"`
	Global        bool          `json:"global,omitempty"`
	SettingKey    string        `json:"settingKey,omitempty"`
	SettingValue  *SettingValue `json:"settingValue,omitempty"`
	DeleteSetting bool          `json:"deleteSetting,omitempty"`
}

// ConfigUpdateResult is the outcome of a configuration update.
type ConfigUpdateResult struct {
	Version          uint32 `json:"version"`
	SettingsRevision uint64 `json:"settingsRevision"`
	Deleted          bool   `json:"deleted,omitempty"`
}

// --- Policy (SDK: PolicyInterface, client.Policy()) ---

// NetworkPolicyRule is a named network policy rule. Simplified relative to
// the SDK's version -- it omits L7 allow/deny rule bodies, which can be
// layered on as a dedicated editor is built.
type NetworkPolicyRule struct {
	Name      string                  `json:"name"`
	Endpoints []PolicyNetworkEndpoint `json:"endpoints,omitempty"`
}

// PolicyNetworkEndpoint is a network endpoint governed by a policy rule.
type PolicyNetworkEndpoint struct {
	Host     string `json:"host"`
	Port     uint32 `json:"port,omitempty"`
	Protocol string `json:"protocol,omitempty"`
	Access   string `json:"access,omitempty"`
}

// PolicyChunk is a single proposed policy change in the draft inbox.
type PolicyChunk struct {
	ID           string             `json:"id"`
	Status       string             `json:"status"`
	RuleName     string             `json:"ruleName,omitempty"`
	ProposedRule *NetworkPolicyRule `json:"proposedRule,omitempty"`
	Rationale    string             `json:"rationale,omitempty"`
	Confidence   float32            `json:"confidence,omitempty"`
	CreatedAt    time.Time          `json:"createdAt,omitempty"`
}

// DraftPolicy is the full draft policy state for a sandbox.
type DraftPolicy struct {
	Chunks         []PolicyChunk `json:"chunks"`
	RollingSummary string        `json:"rollingSummary,omitempty"`
	DraftVersion   uint64        `json:"draftVersion"`
}

// ApproveResult is the outcome of approving a single draft chunk.
type ApproveResult struct {
	PolicyVersion uint32 `json:"policyVersion"`
	PolicyHash    string `json:"policyHash,omitempty"`
}

// ApproveAllResult is the outcome of approving all pending draft chunks.
type ApproveAllResult struct {
	PolicyVersion  uint32 `json:"policyVersion"`
	PolicyHash     string `json:"policyHash,omitempty"`
	ChunksApproved uint32 `json:"chunksApproved"`
	ChunksSkipped  uint32 `json:"chunksSkipped"`
}

// UndoResult is the outcome of undoing a draft chunk approval.
type UndoResult struct {
	PolicyVersion uint32 `json:"policyVersion"`
	PolicyHash    string `json:"policyHash,omitempty"`
}

// ClearResult is the outcome of clearing all draft chunks.
type ClearResult struct {
	ChunksCleared uint32 `json:"chunksCleared"`
}

// DraftHistoryEntry is a single event in a sandbox's draft policy history.
type DraftHistoryEntry struct {
	Timestamp   time.Time `json:"timestamp"`
	EventType   string    `json:"eventType"`
	Description string    `json:"description,omitempty"`
	ChunkID     string    `json:"chunkId,omitempty"`
}

// SandboxPolicyRevision is a versioned, applied policy revision.
type SandboxPolicyRevision struct {
	Version    uint32    `json:"version"`
	PolicyHash string    `json:"policyHash,omitempty"`
	Status     string    `json:"status,omitempty"`
	CreatedAt  time.Time `json:"createdAt,omitempty"`
}

// PolicyStatusResult is a sandbox's current policy enforcement status.
type PolicyStatusResult struct {
	Revision      SandboxPolicyRevision `json:"revision"`
	ActiveVersion uint32                `json:"activeVersion"`
}

// --- Workspace (SDK: WorkspaceInterface, client.Workspaces()) ---
//
// Platform-Admin-only surface (see CLAUDE.md personas): cross-workspace
// lifecycle and membership management.

// Workspace is a logical grouping of sandboxes, providers, and members.
type Workspace struct {
	ID              string            `json:"id,omitempty"`
	Name            string            `json:"name"`
	Labels          map[string]string `json:"labels,omitempty"`
	CreatedAt       time.Time         `json:"createdAt,omitempty"`
	ResourceVersion uint64            `json:"resourceVersion,omitempty"`
	Phase           string            `json:"phase,omitempty"`
}

// WorkspaceMember is a user's membership in a workspace.
type WorkspaceMember struct {
	PrincipalSubject string `json:"principalSubject"`
	Role             string `json:"role"` // "Admin" | "User"
}

// --- Inference (SDK: InferenceInterface, client.Inference()) ---

// InferenceRouteConfig is the request payload for setting an inference
// route.
type InferenceRouteConfig struct {
	ProviderName string `json:"providerName"`
	ModelID      string `json:"modelId"`
	RouteName    string `json:"routeName,omitempty"`
	NoVerify     bool   `json:"noVerify,omitempty"`
	TimeoutSecs  uint64 `json:"timeoutSecs,omitempty"`
}

// InferenceRoute is a configured inference route.
type InferenceRoute struct {
	ProviderName string `json:"providerName"`
	ModelID      string `json:"modelId"`
	RouteName    string `json:"routeName,omitempty"`
	Version      uint64 `json:"version,omitempty"`
	Workspace    string `json:"workspace,omitempty"`
}

// --- Shared ---

// ListOptions configures pagination/filtering for list calls across
// domains.
type ListOptions struct {
	Limit         int    `json:"limit,omitempty"`
	Offset        int    `json:"offset,omitempty"`
	LabelSelector string `json:"labelSelector,omitempty"`
}
