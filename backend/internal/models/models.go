// Package models defines the JSON DTOs the BFF returns to the frontend and
// the converters from protoc-generated types. Proto fields marked
// [(openshell.options.v1.secret) = true] (provider credentials, tokens) are
// never serialized here — only credential key names are exposed.
package models

import (
	"encoding/json"
	"fmt"

	"google.golang.org/protobuf/encoding/protojson"

	datamodelv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/datamodelv1"
	openshellv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/openshellv1"
	sandboxv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/sandboxv1"
)

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

func FromObjectMeta(meta *datamodelv1.ObjectMeta) ObjectMeta {
	if meta == nil {
		return ObjectMeta{}
	}
	return ObjectMeta{
		ID:                  meta.Id,
		Name:                meta.Name,
		Workspace:           meta.Workspace,
		Labels:              meta.Labels,
		Annotations:         meta.Annotations,
		CreatedAtMs:         meta.CreatedAtMs,
		ResourceVersion:     meta.ResourceVersion,
		DeletionTimestampMs: meta.DeletionTimestampMs,
	}
}

// Workspace mirrors openshell.datamodel.v1.Workspace.
type Workspace struct {
	Phase    string     `json:"phase"`
	Metadata ObjectMeta `json:"metadata"`
}

func FromWorkspace(ws *datamodelv1.Workspace) Workspace {
	out := Workspace{Metadata: FromObjectMeta(ws.GetMetadata()), Phase: "UNSPECIFIED"}
	switch ws.GetStatus().GetPhase() {
	case datamodelv1.WorkspacePhase_WORKSPACE_PHASE_ACTIVE:
		out.Phase = "ACTIVE"
	case datamodelv1.WorkspacePhase_WORKSPACE_PHASE_TERMINATING:
		out.Phase = "TERMINATING"
	}
	return out
}

// WorkspaceMember mirrors openshell.v1.WorkspaceMember.
type WorkspaceMember struct {
	PrincipalSubject string     `json:"principalSubject"`
	Role             string     `json:"role"`
	Metadata         ObjectMeta `json:"metadata"`
}

func FromWorkspaceMember(member *openshellv1.WorkspaceMember) WorkspaceMember {
	out := WorkspaceMember{
		Metadata:         FromObjectMeta(member.GetMetadata()),
		PrincipalSubject: member.GetPrincipalSubject(),
		Role:             "UNSPECIFIED",
	}
	switch member.GetRole() {
	case openshellv1.WorkspaceRole_WORKSPACE_ROLE_USER:
		out.Role = "USER"
	case openshellv1.WorkspaceRole_WORKSPACE_ROLE_ADMIN:
		out.Role = "ADMIN"
	}
	return out
}

// WorkspaceRoleFromString maps USER/ADMIN to the proto enum.
func WorkspaceRoleFromString(role string) (openshellv1.WorkspaceRole, bool) {
	switch role {
	case "USER":
		return openshellv1.WorkspaceRole_WORKSPACE_ROLE_USER, true
	case "ADMIN":
		return openshellv1.WorkspaceRole_WORKSPACE_ROLE_ADMIN, true
	}
	return openshellv1.WorkspaceRole_WORKSPACE_ROLE_UNSPECIFIED, false
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

func sandboxPhaseString(phase openshellv1.SandboxPhase) string {
	switch phase {
	case openshellv1.SandboxPhase_SANDBOX_PHASE_PROVISIONING:
		return "PROVISIONING"
	case openshellv1.SandboxPhase_SANDBOX_PHASE_READY:
		return "READY"
	case openshellv1.SandboxPhase_SANDBOX_PHASE_ERROR:
		return "ERROR"
	case openshellv1.SandboxPhase_SANDBOX_PHASE_DELETING:
		return "DELETING"
	case openshellv1.SandboxPhase_SANDBOX_PHASE_UNKNOWN:
		return "UNKNOWN"
	}
	return "UNSPECIFIED"
}

var policyMarshaler = protojson.MarshalOptions{UseProtoNames: false}

func FromSandbox(sandbox *openshellv1.Sandbox) Sandbox {
	out := Sandbox{Metadata: FromObjectMeta(sandbox.GetMetadata())}

	if spec := sandbox.GetSpec(); spec != nil {
		out.Spec = SandboxSpec{
			LogLevel:    spec.LogLevel,
			Environment: spec.Environment,
			Image:       spec.GetTemplate().GetImage(),
			Providers:   spec.Providers,
		}
		if spec.Policy != nil {
			if raw, err := policyMarshaler.Marshal(spec.Policy); err == nil {
				out.Spec.Policy = raw
			}
		}
	}

	status := sandbox.GetStatus()
	out.Status = SandboxStatus{
		SandboxName:          status.GetSandboxName(),
		AgentPod:             status.GetAgentPod(),
		Phase:                sandboxPhaseString(status.GetPhase()),
		CurrentPolicyVersion: status.GetCurrentPolicyVersion(),
	}
	for _, cond := range status.GetConditions() {
		out.Status.Conditions = append(out.Status.Conditions, SandboxCondition{
			Type:               cond.Type,
			Status:             cond.Status,
			Reason:             cond.Reason,
			Message:            cond.Message,
			LastTransitionTime: cond.LastTransitionTime,
		})
	}
	return out
}

// ParsePolicy converts protojson policy from the frontend into the proto
// message. spec.policy is a required field on CreateSandbox.
func ParsePolicy(raw json.RawMessage) (*sandboxv1.SandboxPolicy, error) {
	policy := &sandboxv1.SandboxPolicy{}
	if err := protojson.Unmarshal(raw, policy); err != nil {
		return nil, err
	}
	return policy, nil
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

func FromProvider(provider *datamodelv1.Provider) Provider {
	out := Provider{
		Metadata:              FromObjectMeta(provider.GetMetadata()),
		Type:                  provider.GetType(),
		Config:                provider.GetConfig(),
		CredentialExpiresAtMs: provider.GetCredentialExpiresAtMs(),
		ProfileWorkspace:      provider.GetProfileWorkspace(),
	}
	for name := range provider.GetCredentials() {
		out.CredentialNames = append(out.CredentialNames, name)
	}
	return out
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

func refreshStrategyString(strategy openshellv1.ProviderCredentialRefreshStrategy) string {
	switch strategy {
	case openshellv1.ProviderCredentialRefreshStrategy_PROVIDER_CREDENTIAL_REFRESH_STRATEGY_STATIC:
		return "STATIC"
	case openshellv1.ProviderCredentialRefreshStrategy_PROVIDER_CREDENTIAL_REFRESH_STRATEGY_EXTERNAL:
		return "EXTERNAL"
	case openshellv1.ProviderCredentialRefreshStrategy_PROVIDER_CREDENTIAL_REFRESH_STRATEGY_OAUTH2_REFRESH_TOKEN:
		return "OAUTH2_REFRESH_TOKEN"
	case openshellv1.ProviderCredentialRefreshStrategy_PROVIDER_CREDENTIAL_REFRESH_STRATEGY_OAUTH2_CLIENT_CREDENTIALS:
		return "OAUTH2_CLIENT_CREDENTIALS"
	case openshellv1.ProviderCredentialRefreshStrategy_PROVIDER_CREDENTIAL_REFRESH_STRATEGY_GOOGLE_SERVICE_ACCOUNT_JWT:
		return "GOOGLE_SERVICE_ACCOUNT_JWT"
	case openshellv1.ProviderCredentialRefreshStrategy_PROVIDER_CREDENTIAL_REFRESH_STRATEGY_AWS_STS_ASSUME_ROLE:
		return "AWS_STS_ASSUME_ROLE"
	}
	return "UNSPECIFIED"
}

func FromCredentialRefreshStatus(status *openshellv1.ProviderCredentialRefreshStatus) CredentialRefreshStatus {
	return CredentialRefreshStatus{
		CredentialKey:   status.GetCredentialKey(),
		Strategy:        refreshStrategyString(status.GetStrategy()),
		Status:          status.GetStatus(),
		ExpiresAtMs:     status.GetExpiresAtMs(),
		NextRefreshAtMs: status.GetNextRefreshAtMs(),
		LastRefreshAtMs: status.GetLastRefreshAtMs(),
		LastError:       status.GetLastError(),
	}
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
}

func profileCategoryString(category openshellv1.ProviderProfileCategory) string {
	switch category {
	case openshellv1.ProviderProfileCategory_PROVIDER_PROFILE_CATEGORY_OTHER:
		return "OTHER"
	case openshellv1.ProviderProfileCategory_PROVIDER_PROFILE_CATEGORY_INFERENCE:
		return "INFERENCE"
	case openshellv1.ProviderProfileCategory_PROVIDER_PROFILE_CATEGORY_AGENT:
		return "AGENT"
	case openshellv1.ProviderProfileCategory_PROVIDER_PROFILE_CATEGORY_SOURCE_CONTROL:
		return "SOURCE_CONTROL"
	case openshellv1.ProviderProfileCategory_PROVIDER_PROFILE_CATEGORY_MESSAGING:
		return "MESSAGING"
	case openshellv1.ProviderProfileCategory_PROVIDER_PROFILE_CATEGORY_DATA:
		return "DATA"
	case openshellv1.ProviderProfileCategory_PROVIDER_PROFILE_CATEGORY_KNOWLEDGE:
		return "KNOWLEDGE"
	}
	return "UNSPECIFIED"
}

func FromProviderProfile(profile *openshellv1.ProviderProfile) ProviderProfile {
	out := ProviderProfile{
		ID:               profile.GetId(),
		DisplayName:      profile.GetDisplayName(),
		Description:      profile.GetDescription(),
		Category:         profileCategoryString(profile.GetCategory()),
		Credentials:      []ProfileCredential{},
		InferenceCapable: profile.GetInferenceCapable(),
		Source:           profile.GetSource(),
		Scope:            profile.GetScope(),
	}
	for _, cred := range profile.GetCredentials() {
		out.Credentials = append(out.Credentials, ProfileCredential{
			Name:        cred.Name,
			Description: cred.Description,
			EnvVars:     cred.EnvVars,
			Required:    cred.Required,
			AuthStyle:   cred.AuthStyle,
		})
	}
	for _, endpoint := range profile.GetEndpoints() {
		host := endpoint.GetHost()
		if len(endpoint.GetPorts()) > 0 {
			for _, port := range endpoint.GetPorts() {
				out.Endpoints = append(out.Endpoints, fmt.Sprintf("%s:%d", host, port))
			}
		} else if endpoint.GetPort() > 0 {
			out.Endpoints = append(out.Endpoints, fmt.Sprintf("%s:%d", host, endpoint.GetPort()))
		} else if host != "" {
			out.Endpoints = append(out.Endpoints, host)
		}
	}
	return out
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

func FromCurrentUser(resp *openshellv1.GetCurrentUserResponse) CurrentUser {
	return CurrentUser{
		Subject:          resp.GetSubject(),
		DisplayName:      resp.GetDisplayName(),
		Roles:            resp.GetRoles(),
		Scopes:           resp.GetScopes(),
		IdentityProvider: resp.GetIdentityProvider(),
	}
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

func serviceStatusString(status openshellv1.ServiceStatus) string {
	switch status {
	case openshellv1.ServiceStatus_SERVICE_STATUS_HEALTHY:
		return "HEALTHY"
	case openshellv1.ServiceStatus_SERVICE_STATUS_DEGRADED:
		return "DEGRADED"
	case openshellv1.ServiceStatus_SERVICE_STATUS_UNHEALTHY:
		return "UNHEALTHY"
	}
	return "UNSPECIFIED"
}

func FromGatewayInfo(info *openshellv1.GetGatewayInfoResponse) GatewayInfo {
	out := GatewayInfo{
		Status:         serviceStatusString(info.GetStatus()),
		GatewayVersion: info.GetGatewayVersion(),
		ComputeDrivers: []ComputeDriver{},
	}
	for _, driver := range info.GetComputeDrivers() {
		out.ComputeDrivers = append(out.ComputeDrivers, ComputeDriver{
			Name:          driver.GetName(),
			DriverName:    driver.GetCapabilities().GetDriverName(),
			DriverVersion: driver.GetCapabilities().GetDriverVersion(),
		})
	}
	return out
}
