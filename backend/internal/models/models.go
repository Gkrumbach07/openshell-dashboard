// Package models defines the JSON DTOs the BFF returns to the frontend and
// the converters from the OpenShell Go SDK types (see sdk_converters.go).
// Proto fields marked [(openshell.options.v1.secret) = true] (provider
// credentials, tokens) are never serialized here — only credential key names
// are exposed.
package models

import "encoding/json"

// ObjectMeta mirrors openshell.datamodel.v1.ObjectMeta.
type ObjectMeta struct {
	Labels              map[string]string `json:"labels,omitempty"`
	Annotations         map[string]string `json:"annotations,omitempty"`
	ID                  string            `json:"id"`
	Name                string            `json:"name"`
	Workspace           string            `json:"workspace,omitempty"`
	CreatedAtMs         int64             `json:"createdAtMs"`
	ResourceVersion     uint64            `json:"resourceVersion"`
	DeletionTimestampMs int64             `json:"deletionTimestampMs,omitempty"`
}

// Workspace mirrors openshell.datamodel.v1.Workspace.
type Workspace struct {
	Phase    string     `json:"phase"`
	Metadata ObjectMeta `json:"metadata"`
}

// WorkspaceMember mirrors openshell.v1.WorkspaceMember.
type WorkspaceMember struct {
	PrincipalSubject string     `json:"principalSubject"`
	Role             string     `json:"role"`
	Metadata         ObjectMeta `json:"metadata"`
}

// SandboxCondition mirrors openshell.v1.SandboxCondition.
type SandboxCondition struct {
	Type               string `json:"type"`
	Status             string `json:"status"`
	Reason             string `json:"reason,omitempty"`
	Message            string `json:"message,omitempty"`
	LastTransitionTime string `json:"lastTransitionTime,omitempty"`
}

// SandboxStatus mirrors openshell.v1.SandboxStatus.
type SandboxStatus struct {
	SandboxName          string             `json:"sandboxName,omitempty"`
	AgentPod             string             `json:"agentPod,omitempty"`
	Phase                string             `json:"phase"`
	Conditions           []SandboxCondition `json:"conditions,omitempty"`
	CurrentPolicyVersion uint32             `json:"currentPolicyVersion"`
}

// SandboxSpec is the dashboard view of openshell.v1.SandboxSpec. Policy is
// carried as protojson (camelCase field names) so the full
// openshell.sandbox.v1.SandboxPolicy schema passes through untouched.
type SandboxSpec struct {
	LogLevel    string            `json:"logLevel,omitempty"`
	Environment map[string]string `json:"environment,omitempty"`
	Image       string            `json:"image,omitempty"`
	Providers   []string          `json:"providers,omitempty"`
	Policy      json.RawMessage   `json:"policy,omitempty"`
}

// Sandbox mirrors openshell.v1.Sandbox.
type Sandbox struct {
	Spec     SandboxSpec   `json:"spec"`
	Status   SandboxStatus `json:"status"`
	Metadata ObjectMeta    `json:"metadata"`
}

// Provider is the dashboard view of openshell.datamodel.v1.Provider. The
// credentials map is secret-marked in proto and is intentionally absent —
// only the credential key names are surfaced.
type Provider struct {
	Config                map[string]string `json:"config,omitempty"`
	CredentialExpiresAtMs map[string]int64  `json:"credentialExpiresAtMs,omitempty"`
	Type                  string            `json:"type"`
	ProfileWorkspace      string            `json:"profileWorkspace,omitempty"`
	CredentialNames       []string          `json:"credentialNames,omitempty"`
	Metadata              ObjectMeta        `json:"metadata"`
}

// CredentialRefreshStatus mirrors openshell.v1.ProviderCredentialRefreshStatus.
type CredentialRefreshStatus struct {
	CredentialKey   string `json:"credentialKey"`
	Strategy        string `json:"strategy"`
	Status          string `json:"status"`
	LastError       string `json:"lastError,omitempty"`
	ExpiresAtMs     int64  `json:"expiresAtMs,omitempty"`
	NextRefreshAtMs int64  `json:"nextRefreshAtMs,omitempty"`
	LastRefreshAtMs int64  `json:"lastRefreshAtMs,omitempty"`
}

// ProfileCredential mirrors openshell.v1.ProviderProfileCredential — the
// credential *schema* (no secret values), used to drive the Add Provider form.
type ProfileCredential struct {
	Name        string   `json:"name"`
	Description string   `json:"description,omitempty"`
	AuthStyle   string   `json:"authStyle,omitempty"`
	EnvVars     []string `json:"envVars,omitempty"`
	Required    bool     `json:"required"`
}

// ProviderProfile mirrors openshell.v1.ProviderProfile (schema-relevant subset).
type ProviderProfile struct {
	ID               string              `json:"id"`
	DisplayName      string              `json:"displayName"`
	Description      string              `json:"description,omitempty"`
	Category         string              `json:"category"`
	Source           string              `json:"source,omitempty"`
	Scope            string              `json:"scope,omitempty"`
	Credentials      []ProfileCredential `json:"credentials"`
	Endpoints        []string            `json:"endpoints,omitempty"`
	InferenceCapable bool                `json:"inferenceCapable"`
	ResourceVersion  uint64              `json:"resourceVersion"`
}

// ProviderProfileDiagnostic mirrors openshell.v1.ProviderProfileDiagnostic.
type ProviderProfileDiagnostic struct {
	Source    string `json:"source,omitempty"`
	ProfileID string `json:"profileId,omitempty"`
	Field     string `json:"field,omitempty"`
	Message   string `json:"message"`
	Severity  string `json:"severity,omitempty"`
}

// ImportProviderProfilesResult mirrors openshell.v1.ImportProviderProfilesResponse.
type ImportProviderProfilesResult struct {
	Diagnostics []ProviderProfileDiagnostic `json:"diagnostics,omitempty"`
	Profiles    []ProviderProfile           `json:"profiles"`
	Imported    bool                        `json:"imported"`
}

// UpdateProviderProfileResult mirrors openshell.v1.UpdateProviderProfilesResponse.
type UpdateProviderProfileResult struct {
	Profile     *ProviderProfile            `json:"profile,omitempty"`
	Diagnostics []ProviderProfileDiagnostic `json:"diagnostics,omitempty"`
	Updated     bool                        `json:"updated"`
}

// LintProviderProfilesResult mirrors openshell.v1.LintProviderProfilesResponse.
type LintProviderProfilesResult struct {
	Diagnostics []ProviderProfileDiagnostic `json:"diagnostics,omitempty"`
	Valid       bool                        `json:"valid"`
}

// CurrentUser mirrors openshell.v1.GetCurrentUserResponse.
type CurrentUser struct {
	Subject          string   `json:"subject"`
	DisplayName      string   `json:"displayName,omitempty"`
	Email            string   `json:"email,omitempty"`
	IdentityProvider string   `json:"identityProvider,omitempty"`
	Roles            []string `json:"roles"`
	Scopes           []string `json:"scopes,omitempty"`
}

// ComputeDriver flattens openshell.v1.ComputeDriverInfo + capabilities.
type ComputeDriver struct {
	Name          string `json:"name"`
	DriverName    string `json:"driverName,omitempty"`
	DriverVersion string `json:"driverVersion,omitempty"`
}

// GatewayInfo mirrors openshell.v1.GetGatewayInfoResponse — status, version,
// and compute drivers are all the gateway exposes about itself.
type GatewayInfo struct {
	Status         string          `json:"status"`
	GatewayVersion string          `json:"gatewayVersion"`
	ComputeDrivers []ComputeDriver `json:"computeDrivers"`
}
