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

// EndpointStatus mirrors openshell.v1.EndpointStatus: a tool server endpoint
// the sandbox's policy configures and the last network result the gateway
// accepted for it. The result is a passive observation of real traffic. It
// says nothing about whether the endpoint is reachable now, or whether a tool
// call succeeded.
//
// LastResult is the EndpointResult enum without its prefix: UNSPECIFIED,
// NO_OBSERVED_EXCHANGE, HTTP_RESPONSE_RECEIVED, POLICY_DENIED,
// CREDENTIAL_UNAVAILABLE, TLS_FAILED, TRANSPORT_FAILED or UPSTREAM_REJECTED.
// LastReportedAt is when the gateway accepted the observation (RFC 3339), not
// when the request was made, and is empty while nothing was observed.
type EndpointStatus struct {
	EndpointID     string   `json:"endpointId"`
	Host           string   `json:"host"`
	Path           string   `json:"path,omitempty"`
	LastResult     string   `json:"lastResult"`
	LastReportedAt string   `json:"lastReportedAt,omitempty"`
	Ports          []uint32 `json:"ports,omitempty"`
}

// ConfigurationAdmission mirrors openshell.v1.SandboxConfigurationAdmission:
// whether the sandbox validated the configuration the gateway wants it to run.
// State is UNSPECIFIED, PENDING, ACCEPTED or REJECTED, and Error says why a
// configuration was rejected.
//
// ConfigRevision and ProviderEnvRevision are 64-bit fingerprints, not
// counters, and do not fit the integers a browser can hold exactly. They are
// sent as decimal strings, to be compared and never calculated with.
type ConfigurationAdmission struct {
	State               string `json:"state"`
	PolicyHash          string `json:"policyHash,omitempty"`
	Error               string `json:"error,omitempty"`
	ConfigRevision      uint64 `json:"configRevision,string"`
	ProviderEnvRevision uint64 `json:"providerEnvRevision,string"`
	PolicyVersion       uint32 `json:"policyVersion"`
}

// SandboxStatus mirrors openshell.v1.SandboxStatus.
type SandboxStatus struct {
	// ExitCode is the main process exit code once the sandbox has exited (nil
	// while running). Signal exits are reported as 128+signal. Surfaced to
	// explain ERROR-phase sandboxes.
	ExitCode    *int32             `json:"exitCode,omitempty"`
	SandboxName string             `json:"sandboxName,omitempty"`
	AgentPod    string             `json:"agentPod,omitempty"`
	Phase       string             `json:"phase"`
	Conditions  []SandboxCondition `json:"conditions,omitempty"`
	// ConfigurationAdmission is absent for a sandbox that has reported none.
	ConfigurationAdmission *ConfigurationAdmission `json:"configurationAdmission,omitempty"`
	EndpointStatuses       []EndpointStatus        `json:"endpointStatuses,omitempty"`
	CurrentPolicyVersion   uint32                  `json:"currentPolicyVersion"`
}

// SandboxSpecTemplate is the dashboard view of openshell.v1.SandboxTemplate,
// the compute template inline in a sandbox's spec. It is not SandboxTemplate
// below, which is the reusable resource a sandbox can be created from. The
// image stays where it has always been, at SandboxSpec.Image.
//
// Resources and DriverConfig are free-form structs on the wire and are passed
// on as the gateway holds them. The dashboard and the CLI both write a CPU or
// memory limit as {"limits": {"cpu": "500m", "memory": "512Mi"}}, and the
// gateway writes the same for a sandbox created from a workload template.
type SandboxSpecTemplate struct {
	// UserNamespaces is absent when the sandbox follows the platform default.
	UserNamespaces   *bool             `json:"userNamespaces,omitempty"`
	Labels           map[string]string `json:"labels,omitempty"`
	Annotations      map[string]string `json:"annotations,omitempty"`
	Environment      map[string]string `json:"environment,omitempty"`
	Resources        map[string]any    `json:"resources,omitempty"`
	DriverConfig     map[string]any    `json:"driverConfig,omitempty"`
	RuntimeClassName string            `json:"runtimeClassName,omitempty"`
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
	// Template is absent when the sandbox's template holds nothing but its
	// image.
	Template *SandboxSpecTemplate `json:"template,omitempty"`
	// GPUCount is the number of GPUs requested. GPU is true for any GPU
	// request; with GPUCount absent the compute driver chose the assignment.
	GPUCount *uint32 `json:"gpuCount,omitempty"`
	// Command is the argv of the sandbox's main process. It is absent for a
	// sandbox created without one, which runs its image's login shell.
	Command []string `json:"command,omitempty"`
	GPU     bool     `json:"gpu,omitempty"`
	// TTY reports a pseudo-terminal for the main process. The gateway sets it
	// for every sandbox created without a command.
	TTY bool `json:"tty,omitempty"`
}

// WorkloadTemplateProvenance mirrors
// openshell.v1.SandboxWorkloadTemplateProvenance: the workload template, and
// the revision of it, a sandbox was created from.
type WorkloadTemplateProvenance struct {
	Name            string `json:"name"`
	ResourceVersion string `json:"resourceVersion,omitempty"`
}

// Sandbox mirrors openshell.v1.Sandbox.
type Sandbox struct {
	// CreatedFromWorkloadTemplate is absent for a sandbox that was not created
	// from a workload template.
	CreatedFromWorkloadTemplate *WorkloadTemplateProvenance `json:"createdFromWorkloadTemplate,omitempty"`
	// ServiceURLs holds the URL of each service exposed as the sandbox was
	// created, keyed by service name with "" for the unnamed service. The
	// gateway reports it in the answer to a create and nowhere else; the
	// sandbox's services endpoint lists the endpoints at any later time.
	ServiceURLs map[string]string `json:"serviceUrls,omitempty"`
	Spec        SandboxSpec       `json:"spec"`
	Status      SandboxStatus     `json:"status"`
	Metadata    ObjectMeta        `json:"metadata"`
}

// SandboxSettingEntry is one effective setting of a sandbox: a SettingEntry
// and the scope its value was resolved from. Scope is GLOBAL for a value set
// on the gateway, SANDBOX for one set on this sandbox, and UNSPECIFIED for a
// setting the gateway knows that is set at neither, which has no value.
//
// The gateway's scope wins: while a key is set globally the gateway refuses to
// set or delete it on a sandbox.
type SandboxSettingEntry struct {
	Value any    `json:"value,omitempty"`
	Key   string `json:"key"`
	Scope string `json:"scope"`
}

// SandboxSettings mirrors GetSandboxConfigResponse without the policy itself,
// which the sandbox's policy endpoint serves.
//
// PolicySource is SANDBOX or GLOBAL (UNSPECIFIED when the gateway does not
// say): whether the sandbox runs its own policy or the gateway-global one.
// PolicyVersion is the sandbox's policy version, and GlobalPolicyVersion that
// of the global policy when it is the source and zero otherwise.
// PolicyValidationFailureMode is the gateway's posture for a policy the
// sandbox rejects, "fail_closed" or "retain_last_valid".
//
// ConfigRevision and ProviderEnvRevision are 64-bit fingerprints sent as
// decimal strings, as on ConfigurationAdmission and for the same reason.
type SandboxSettings struct {
	PolicySource                string                `json:"policySource"`
	PolicyHash                  string                `json:"policyHash,omitempty"`
	PolicyValidationFailureMode string                `json:"policyValidationFailureMode,omitempty"`
	Settings                    []SandboxSettingEntry `json:"settings"`
	ConfigRevision              uint64                `json:"configRevision,string"`
	ProviderEnvRevision         uint64                `json:"providerEnvRevision,string"`
	PolicyVersion               uint32                `json:"policyVersion"`
	GlobalPolicyVersion         uint32                `json:"globalPolicyVersion"`
}

// SettingSetResult mirrors UpdateConfigResponse for setting one sandbox-scoped
// setting. SettingsRevision is the sandbox's settings revision afterwards.
type SettingSetResult struct {
	SettingsRevision uint64 `json:"settingsRevision"`
	Updated          bool   `json:"updated"`
}

// SettingDeleteResult mirrors UpdateConfigResponse for deleting one setting,
// on a sandbox or on the gateway. Deleted is the gateway's own answer: false
// when the key was not set in that scope, so there was nothing to delete.
// SettingsRevision is the revision of the scope's settings afterwards.
type SettingDeleteResult struct {
	SettingsRevision uint64 `json:"settingsRevision"`
	Deleted          bool   `json:"deleted"`
}

// SandboxTemplate is the dashboard view of openshell.v1.SandboxWorkloadTemplate
// — the reusable, workspace-scoped template resource. A sandbox is created from
// a template by name (see CreateSandboxFromTemplate), supplying only governance
// fields (policy, providers); the workload comes from the template.
type SandboxTemplate struct {
	Spec     SandboxTemplateSpec `json:"spec"`
	Metadata ObjectMeta          `json:"metadata"`
}

// SandboxTemplateSpec mirrors openshell.v1.SandboxWorkloadTemplateSpec.
type SandboxTemplateSpec struct {
	Workload            *SandboxWorkload     `json:"workload,omitempty"`
	DriverConfig        map[string]any       `json:"driverConfig,omitempty"`
	DesiredServiceLevel *SandboxServiceLevel `json:"desiredServiceLevel,omitempty"`
}

// SandboxWorkload mirrors openshell.v1.SandboxWorkloadConfig — the portable
// workload shape (image, environment, resources) a template pins.
type SandboxWorkload struct {
	Resources   *SandboxResources `json:"resources,omitempty"`
	Environment map[string]string `json:"environment,omitempty"`
	Image       string            `json:"image,omitempty"`
}

// SandboxResources mirrors openshell.v1.SandboxResources.
type SandboxResources struct {
	GPU    *SandboxGPU `json:"gpu,omitempty"`
	CPU    string      `json:"cpu,omitempty"`
	Memory string      `json:"memory,omitempty"`
}

// SandboxGPU mirrors openshell.v1.SandboxGPURequirements. A non-nil GPU with a
// nil Count requests the active driver's default GPU assignment.
type SandboxGPU struct {
	Count *uint32 `json:"count,omitempty"`
}

// SandboxServiceLevel mirrors openshell.v1.SandboxServiceLevel.
type SandboxServiceLevel struct {
	Startup *SandboxStartup `json:"startup,omitempty"`
}

// SandboxStartup mirrors openshell.v1.SandboxStartup. ReadyWithinMs is the
// startup deadline in milliseconds.
type SandboxStartup struct {
	ReadyWithinMs int64  `json:"readyWithinMs,omitempty"`
	MaxBurst      uint32 `json:"maxBurst,omitempty"`
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
//
// RecoveryAction is what the gateway says a failed refresh needs: RETRY (it
// will try again by itself), REAUTHORIZE (the grant has to be replaced),
// FIX_CONFIGURATION or INVESTIGATE. It is empty when nothing is needed.
// FailureCode is the gateway's own stable identifier for the failure and
// ProviderErrorSubtype a recognized refinement of it; neither is text the
// provider controls. A refresh with no NextRefreshAtMs is not scheduled:
// RecoveryAction says whether that is a parked failure.
type CredentialRefreshStatus struct {
	CredentialKey        string `json:"credentialKey"`
	Strategy             string `json:"strategy"`
	Status               string `json:"status"`
	LastError            string `json:"lastError,omitempty"`
	RecoveryAction       string `json:"recoveryAction,omitempty"`
	FailureCode          string `json:"failureCode,omitempty"`
	ProviderErrorSubtype string `json:"providerErrorSubtype,omitempty"`
	ExpiresAtMs          int64  `json:"expiresAtMs,omitempty"`
	NextRefreshAtMs      int64  `json:"nextRefreshAtMs,omitempty"`
	LastRefreshAtMs      int64  `json:"lastRefreshAtMs,omitempty"`
	LastErrorAtMs        int64  `json:"lastErrorAtMs,omitempty"`
}

// ProfileCredential mirrors openshell.v1.ProviderProfileCredential — the
// credential *schema* (no secret values), used to drive the Add Provider form.
// It is the same shape read and written. The nested types are in
// provider_profile.go.
type ProfileCredential struct {
	Refresh      *ProfileCredentialRefresh `json:"refresh,omitempty"`
	TokenGrant   *ProfileTokenGrant        `json:"tokenGrant,omitempty"`
	Name         string                    `json:"name"`
	Description  string                    `json:"description,omitempty"`
	AuthStyle    string                    `json:"authStyle,omitempty"`
	HeaderName   string                    `json:"headerName,omitempty"`
	QueryParam   string                    `json:"queryParam,omitempty"`
	PathTemplate string                    `json:"pathTemplate,omitempty"`
	EnvVars      []string                  `json:"envVars,omitempty"`
	Required     bool                      `json:"required"`
}

// ProviderProfile mirrors openshell.v1.ProviderProfile as the gateway returns
// it. ProviderProfileInput (provider_profile.go) is the same profile as a
// client writes it.
//
// Endpoints is a host:port summary of each endpoint and predates
// NetworkEndpoints, which carries each endpoint whole: one protojson
// openshell.sandbox.v1.NetworkEndpoint per entry, the contract sandbox
// policies already use. NetworkEndpoints is left out when the profile was read
// through a client that cannot see a whole endpoint (see
// services.ProviderProfileStore); a profile that has Endpoints and no
// NetworkEndpoints must not be written back as if it were complete.
type ProviderProfile struct {
	Discovery        *ProfileDiscovery   `json:"discovery,omitempty"`
	Annotations      map[string]string   `json:"annotations,omitempty"`
	ID               string              `json:"id"`
	DisplayName      string              `json:"displayName"`
	Description      string              `json:"description,omitempty"`
	Category         string              `json:"category"`
	Source           string              `json:"source,omitempty"`
	Scope            string              `json:"scope,omitempty"`
	Credentials      []ProfileCredential `json:"credentials"`
	Endpoints        []string            `json:"endpoints,omitempty"`
	NetworkEndpoints []json.RawMessage   `json:"networkEndpoints,omitempty"`
	Binaries         []ProfileBinary     `json:"binaries,omitempty"`
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

// GatewayExtension mirrors openshell.v1.NegotiatedExtensionInfo: what one
// initialized extension (a compute driver, a credential driver, a gateway
// interceptor or a supervisor middleware) negotiated with the gateway. The
// gateway declares all of it non-secret.
//
// Kind is the ExtensionKind without its prefix: COMPUTE_DRIVER,
// CREDENTIAL_DRIVER, GATEWAY_INTERCEPTOR, SUPERVISOR_MIDDLEWARE or
// UNSPECIFIED. ConfiguredName is the name the operator registered the
// extension under; the implementation fields are what the extension reports
// about itself. RequiredCapabilities are what the extension needs from the
// gateway.
type GatewayExtension struct {
	Kind                  string   `json:"kind"`
	ConfiguredName        string   `json:"configuredName"`
	ImplementationName    string   `json:"implementationName,omitempty"`
	ImplementationVersion string   `json:"implementationVersion,omitempty"`
	SupportedCapabilities []string `json:"supportedCapabilities,omitempty"`
	RequiredCapabilities  []string `json:"requiredCapabilities,omitempty"`
	ProtocolMajor         uint32   `json:"protocolMajor"`
	ProtocolMinor         uint32   `json:"protocolMinor"`
}

// GatewayInfo mirrors openshell.v1.GetGatewayInfoResponse — status, version,
// compute drivers and negotiated extensions are all the gateway exposes about
// itself.
//
// Compatibility is the one field that does not come from the gateway: it is
// the dashboard's own verdict on the version above, added by the handler. It
// is nil — and omitted — until something has actually judged the gateway.
type GatewayInfo struct { //nolint:govet // fieldalignment: gateway fields first, the verdict last
	Status         string                `json:"status"`
	GatewayVersion string                `json:"gatewayVersion"`
	ComputeDrivers []ComputeDriver       `json:"computeDrivers"`
	Extensions     []GatewayExtension    `json:"extensions"`
	Compatibility  *GatewayCompatibility `json:"compatibility,omitempty"`
}

// GatewayCompatibilityInfo is the body of GET /gateway/compatibility: the
// version the gateway reported and the dashboard's verdict on it.
//
// The two keys carry the same names and meaning as on GatewayInfo, so a client
// reads either response the same way. What differs is who may ask. GatewayInfo
// comes from GetGatewayInfo, which the gateway answers only for platform
// admins; this comes from the gateway's health check, which it answers for
// anyone, so every signed-in user can learn that the gateway is out of range.
//
// Healthy is what the same health check says about the gateway itself, for
// the same audience: GatewayInfo.Status is the admin-only way to read it. It
// is nil — and omitted — when the version came from a source that reports no
// health.
type GatewayCompatibilityInfo struct { //nolint:govet // fieldalignment: gateway fields first, the verdict last
	GatewayVersion string               `json:"gatewayVersion"`
	Healthy        *bool                `json:"healthy,omitempty"`
	Compatibility  GatewayCompatibility `json:"compatibility"`
}

// GatewayHealth is what the gateway's health check reports, as the SDK hands
// it on: the gateway's version and whether it called itself healthy.
//
// The gateway's own answer has four values — healthy, degraded, unhealthy and
// unspecified — and the SDK's HealthResult keeps only whether it was the
// first. Healthy false therefore means "answered, and not with healthy"; it
// does not say which of the other three.
type GatewayHealth struct {
	Version string
	Healthy bool
}

// GatewayStatusHealthy is GatewayInfo.Status for a gateway that reports itself
// healthy. It is the one status the health check's Healthy is true for.
const GatewayStatusHealthy = "HEALTHY"

// FeatureFlags controls which optional features the frontend should render.
type FeatureFlags struct {
	Terminal          bool `json:"terminal"`
	FileTransfer      bool `json:"fileTransfer"`
	Settings          bool `json:"settings"`
	GlobalPolicy      bool `json:"globalPolicy"`
	CredentialRefresh bool `json:"credentialRefresh"`
	Services          bool `json:"services"`
	DraftPolicy       bool `json:"draftPolicy"`
}
