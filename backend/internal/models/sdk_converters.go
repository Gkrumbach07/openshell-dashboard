package models

import (
	"encoding/json"
	"fmt"
	"slices"
	"sort"
	"strings"
	"time"

	openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"
	sbv1 "github.com/NVIDIA/OpenShell/sdk/go/proto/sandboxv1"
	"google.golang.org/protobuf/encoding/protojson"
)

// policyProtoMarshaler emits camelCase JSON matching the pre-SDK protojson
// contract the frontend consumes.
var policyProtoMarshaler = protojson.MarshalOptions{UseProtoNames: false}

// FromSDKSandbox converts an SDK Sandbox to the JSON DTO the frontend expects.
func FromSDKSandbox(sandbox *openshell.Sandbox) Sandbox {
	if sandbox == nil {
		return Sandbox{}
	}
	out := Sandbox{
		Metadata: ObjectMeta{
			ID:              sandbox.ID,
			Name:            sandbox.Name,
			Workspace:       sandbox.Workspace,
			Labels:          sandbox.Labels,
			Annotations:     sandbox.Annotations,
			CreatedAtMs:     timeToMs(sandbox.CreatedAt),
			ResourceVersion: sandbox.ResourceVersion,
		},
	}
	if sandbox.DeletionTimestamp != nil {
		out.Metadata.DeletionTimestampMs = sandbox.DeletionTimestamp.UnixMilli()
	}

	out.Spec = SandboxSpec{
		LogLevel:    sandbox.Spec.LogLevel,
		Environment: sandbox.Spec.Environment,
		Providers:   sandbox.Spec.Providers,
	}
	if sandbox.Spec.Template != nil {
		out.Spec.Image = sandbox.Spec.Template.Image
	}
	if sandbox.Spec.Policy != nil {
		out.Spec.Policy = marshalSDKPolicy(sandbox.Spec.Policy)
	}

	out.Status = SandboxStatus{
		SandboxName:          sandbox.Status.SandboxName,
		AgentPod:             sandbox.Status.AgentPod,
		Phase:                strings.ToUpper(string(sandbox.Status.Phase)),
		CurrentPolicyVersion: sandbox.Status.CurrentPolicyVersion,
	}
	for _, cond := range sandbox.Status.Conditions {
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

// BuildSDKSandboxSpec constructs an SDK SandboxSpec from a create request.
func BuildSDKSandboxSpec(req CreateSandboxRequest) (*openshell.SandboxSpec, error) {
	policy, err := ParseSDKPolicy(req.Policy)
	if err != nil {
		return nil, fmt.Errorf("policy does not match the SandboxPolicy schema: %w", err)
	}

	spec := &openshell.SandboxSpec{
		LogLevel:    req.LogLevel,
		Environment: req.Environment,
		Template: &openshell.SandboxTemplate{
			Image: req.Image,
		},
		Policy:    policy,
		Providers: req.Providers,
	}

	if req.CPU != "" || req.Memory != "" {
		resources := map[string]any{}
		limits := map[string]any{}
		if req.CPU != "" {
			limits["cpu"] = req.CPU
		}
		if req.Memory != "" {
			limits["memory"] = req.Memory
		}
		resources["limits"] = limits
		spec.Template.Resources = resources
	}

	if req.GpuCount > 0 {
		gpu := req.GpuCount
		spec.GPUCount = &gpu
	}
	return spec, nil
}

// ParseSDKPolicy converts camelCase JSON from the frontend into the SDK
// SandboxPolicy. It round-trips through the proto with protojson so every
// policy field (L7 rules, deny rules, IP allowlists, multi-port, MCP,
// middleware, ...) is preserved — protojson rejects unknown fields, matching
// the pre-SDK validation behavior.
func ParseSDKPolicy(raw json.RawMessage) (*openshell.SandboxPolicy, error) {
	var pb sbv1.SandboxPolicy
	if err := protojson.Unmarshal(raw, &pb); err != nil {
		return nil, err
	}
	return sandboxPolicyFromProto(&pb), nil
}

func timeToMs(t time.Time) int64 {
	if t.IsZero() {
		return 0
	}
	return t.UnixMilli()
}

// marshalSDKPolicy converts an SDK SandboxPolicy into camelCase JSON for the
// frontend, round-tripping through the proto with protojson for full fidelity.
func marshalSDKPolicy(p *openshell.SandboxPolicy) json.RawMessage {
	raw, err := policyProtoMarshaler.Marshal(sandboxPolicyToProto(p))
	if err != nil {
		return nil
	}
	return raw
}

// RefreshStrategyAWSStsAssumeRole is defined in SDK types but not re-exported
// from openshell/v1.
const RefreshStrategyAWSStsAssumeRole openshell.RefreshStrategy = "AWSStsAssumeRole"

// FromSDKProvider converts an SDK Provider to the JSON DTO. Credential values
// and handles are secret — only key names are surfaced.
func FromSDKProvider(provider *openshell.Provider) Provider {
	if provider == nil {
		return Provider{}
	}
	out := Provider{
		Metadata: ObjectMeta{
			ID:              provider.ID,
			Name:            provider.Name,
			Workspace:       provider.Workspace,
			Labels:          provider.Labels,
			Annotations:     provider.Annotations,
			CreatedAtMs:     timeToMs(provider.CreatedAt),
			ResourceVersion: provider.ResourceVersion,
		},
		Type:             provider.Type,
		Config:           provider.Spec.Config,
		ProfileWorkspace: provider.Spec.ProfileWorkspace,
	}
	if provider.DeletionTimestamp != nil {
		out.Metadata.DeletionTimestampMs = provider.DeletionTimestamp.UnixMilli()
	}
	if len(provider.Spec.CredentialExpiresAt) > 0 {
		out.CredentialExpiresAtMs = make(map[string]int64, len(provider.Spec.CredentialExpiresAt))
		for k, t := range provider.Spec.CredentialExpiresAt {
			out.CredentialExpiresAtMs[k] = timeToMs(t)
		}
	}
	// Gateway responses omit Spec.Credentials (write-only). Names live on
	// CredentialHandles after create. Union both so mocks and live reads work.
	names := make(map[string]struct{}, len(provider.Spec.Credentials)+len(provider.Spec.CredentialHandles))
	for name := range provider.Spec.Credentials {
		names[name] = struct{}{}
	}
	for name := range provider.Spec.CredentialHandles {
		names[name] = struct{}{}
	}
	if len(names) > 0 {
		out.CredentialNames = make([]string, 0, len(names))
		for name := range names {
			out.CredentialNames = append(out.CredentialNames, name)
		}
		slices.Sort(out.CredentialNames)
	}
	return out
}

// FromSDKRefreshStatus converts an SDK RefreshStatus to the JSON DTO.
func FromSDKRefreshStatus(status *openshell.RefreshStatus) CredentialRefreshStatus {
	if status == nil {
		return CredentialRefreshStatus{}
	}
	return CredentialRefreshStatus{
		CredentialKey:   status.CredentialKey,
		Strategy:        sdkRefreshStrategyString(status.Strategy),
		Status:          status.Status,
		ExpiresAtMs:     timeToMs(status.ExpiresAt),
		NextRefreshAtMs: timeToMs(status.NextRefreshAt),
		LastRefreshAtMs: timeToMs(status.LastRefreshAt),
		LastError:       status.LastError,
	}
}

func sdkRefreshStrategyString(s openshell.RefreshStrategy) string {
	switch s {
	case openshell.RefreshStrategyStatic:
		return "STATIC"
	case openshell.RefreshStrategyExternal:
		return "EXTERNAL"
	case openshell.RefreshStrategyOAuth2RefreshToken:
		return "OAUTH2_REFRESH_TOKEN"
	case openshell.RefreshStrategyOAuth2ClientCredentials:
		return "OAUTH2_CLIENT_CREDENTIALS"
	case openshell.RefreshStrategyGoogleServiceAccountJWT:
		return "GOOGLE_SERVICE_ACCOUNT_JWT"
	case RefreshStrategyAWSStsAssumeRole:
		return "AWS_STS_ASSUME_ROLE"
	}
	return "UNSPECIFIED"
}

// FromSDKProviderProfile converts an SDK ProviderProfile to the JSON DTO.
func FromSDKProviderProfile(profile *openshell.ProviderProfile) ProviderProfile {
	if profile == nil {
		return ProviderProfile{Credentials: []ProfileCredential{}}
	}
	out := ProviderProfile{
		ID:               profile.ID,
		DisplayName:      profile.DisplayName,
		Description:      profile.Description,
		Category:         sdkProfileCategoryString(profile.Category),
		Credentials:      []ProfileCredential{},
		InferenceCapable: profile.InferenceCapable,
		Source:           profile.Source,
		Scope:            profile.Scope,
		ResourceVersion:  profile.ResourceVersion,
	}
	for _, cred := range profile.Credentials {
		out.Credentials = append(out.Credentials, ProfileCredential{
			Name:        cred.Name,
			Description: cred.Description,
			EnvVars:     cred.EnvVars,
			Required:    cred.Required,
			AuthStyle:   cred.AuthStyle,
		})
	}
	for _, endpoint := range profile.Endpoints {
		if endpoint.Port > 0 {
			out.Endpoints = append(out.Endpoints, fmt.Sprintf("%s:%d", endpoint.Host, endpoint.Port))
		} else if endpoint.Host != "" {
			out.Endpoints = append(out.Endpoints, endpoint.Host)
		}
	}
	return out
}

func sdkProfileCategoryString(c openshell.ProfileCategory) string {
	switch c {
	case openshell.ProfileCategoryOther:
		return "OTHER"
	case openshell.ProfileCategoryInference:
		return "INFERENCE"
	case openshell.ProfileCategoryAgent:
		return "AGENT"
	case openshell.ProfileCategorySourceControl:
		return "SOURCE_CONTROL"
	case openshell.ProfileCategoryMessaging:
		return "MESSAGING"
	case openshell.ProfileCategoryData:
		return "DATA"
	case openshell.ProfileCategoryKnowledge:
		return "KNOWLEDGE"
	}
	return "UNSPECIFIED"
}

// ParseSDKProfileCategory maps the frontend UPPER_SNAKE category to the SDK type.
func ParseSDKProfileCategory(s string) openshell.ProfileCategory {
	switch s {
	case "INFERENCE":
		return openshell.ProfileCategoryInference
	case "AGENT":
		return openshell.ProfileCategoryAgent
	case "SOURCE_CONTROL":
		return openshell.ProfileCategorySourceControl
	case "MESSAGING":
		return openshell.ProfileCategoryMessaging
	case "DATA":
		return openshell.ProfileCategoryData
	case "KNOWLEDGE":
		return openshell.ProfileCategoryKnowledge
	default:
		return openshell.ProfileCategoryOther
	}
}

// FromSDKDiagnostics converts SDK profile diagnostics to JSON DTOs.
func FromSDKDiagnostics(diagnostics []openshell.ProfileDiagnostic) []ProviderProfileDiagnostic {
	out := make([]ProviderProfileDiagnostic, 0, len(diagnostics))
	for _, d := range diagnostics {
		out = append(out, ProviderProfileDiagnostic{
			Source:    d.Source,
			ProfileID: d.ProfileID,
			Field:     d.Field,
			Message:   d.Message,
			Severity:  d.Severity,
		})
	}
	return out
}

func timePtrToMs(t *time.Time) int64 {
	if t == nil {
		return 0
	}
	return t.UnixMilli()
}

// FromSDKWorkspace converts an SDK Workspace to the JSON DTO.
func FromSDKWorkspace(ws *openshell.Workspace) Workspace {
	if ws == nil {
		return Workspace{Phase: "UNSPECIFIED"}
	}
	phase := strings.ToUpper(string(ws.Phase))
	if phase == "" || phase == "UNKNOWN" {
		phase = "UNSPECIFIED"
	}
	return Workspace{
		Metadata: ObjectMeta{
			ID:                  ws.ID,
			Name:                ws.Name,
			Workspace:           ws.Workspace,
			Labels:              ws.Labels,
			Annotations:         ws.Annotations,
			CreatedAtMs:         timeToMs(ws.CreatedAt),
			ResourceVersion:     ws.ResourceVersion,
			DeletionTimestampMs: timePtrToMs(ws.DeletionTimestamp),
		},
		Phase: phase,
	}
}

// FromSDKWorkspaceMember converts an SDK WorkspaceMember to the JSON DTO.
func FromSDKWorkspaceMember(member *openshell.WorkspaceMember) WorkspaceMember {
	if member == nil {
		return WorkspaceMember{Role: "UNSPECIFIED"}
	}
	role := strings.ToUpper(string(member.Role))
	if role == "" || role == "UNKNOWN" {
		role = "UNSPECIFIED"
	}
	return WorkspaceMember{
		Metadata: ObjectMeta{
			ID:              member.ID,
			Name:            member.Name,
			Labels:          member.Labels,
			Annotations:     member.Annotations,
			CreatedAtMs:     timeToMs(member.CreatedAt),
			ResourceVersion: member.ResourceVersion,
		},
		PrincipalSubject: member.PrincipalSubject,
		Role:             role,
	}
}

// SDKWorkspaceRoleFromString maps USER/ADMIN to the SDK WorkspaceRole.
func SDKWorkspaceRoleFromString(role string) (openshell.WorkspaceRole, bool) {
	switch role {
	case "USER":
		return openshell.WorkspaceRoleUser, true
	case "ADMIN":
		return openshell.WorkspaceRoleAdmin, true
	}
	return "", false
}

func sdkPolicyLoadStatusString(status openshell.PolicyLoadStatus) string {
	switch status {
	case openshell.PolicyLoadStatusPending:
		return "PENDING"
	case openshell.PolicyLoadStatusLoaded:
		return "LOADED"
	case openshell.PolicyLoadStatusFailed:
		return "FAILED"
	case openshell.PolicyLoadStatusSuperseded:
		return "SUPERSEDED"
	}
	return "UNSPECIFIED"
}

// FromSDKPolicyRevision converts an SDK policy revision to the JSON DTO.
func FromSDKPolicyRevision(revision *openshell.SandboxPolicyRevision) PolicyRevision {
	if revision == nil {
		return PolicyRevision{Status: "UNSPECIFIED"}
	}
	out := PolicyRevision{
		Version:     revision.Version,
		PolicyHash:  revision.PolicyHash,
		Status:      sdkPolicyLoadStatusString(revision.Status),
		LoadError:   revision.LoadError,
		CreatedAtMs: timeToMs(revision.CreatedAt),
		LoadedAtMs:  timeToMs(revision.LoadedAt),
		Provenance:  revision.Provenance,
	}
	if revision.Policy != nil {
		out.Policy = marshalSDKPolicy(revision.Policy)
	}
	return out
}

// FromSDKPolicyStatus maps GetStatus into the dashboard view. Revisions is left
// empty — the handler fills history via GetStatus(WithVersion).
func FromSDKPolicyStatus(status *openshell.PolicyStatusResult) SandboxPolicyView {
	if status == nil {
		return SandboxPolicyView{Revisions: []PolicyRevision{}}
	}
	latest := FromSDKPolicyRevision(&status.Revision)
	return SandboxPolicyView{
		ActiveVersion: status.ActiveVersion,
		Latest:        &latest,
		Revisions:     []PolicyRevision{},
	}
}

// MarshalSDKNetworkPolicyRule converts an SDK NetworkPolicyRule to camelCase
// JSON, round-tripping through the proto for full fidelity.
func MarshalSDKNetworkPolicyRule(rule *openshell.NetworkPolicyRule) json.RawMessage {
	if rule == nil {
		return nil
	}
	raw, err := policyProtoMarshaler.Marshal(networkPolicyRuleToProto(rule))
	if err != nil {
		return nil
	}
	return raw
}

// ParseSDKNetworkPolicyRule parses camelCase JSON into an SDK NetworkPolicyRule,
// preserving every field via the proto round-trip.
func ParseSDKNetworkPolicyRule(raw json.RawMessage) (*openshell.NetworkPolicyRule, error) {
	var pb sbv1.NetworkPolicyRule
	if err := protojson.Unmarshal(raw, &pb); err != nil {
		return nil, err
	}
	return networkPolicyRuleFromProto(&pb), nil
}

// FromSDKDraftPolicy converts an SDK DraftPolicy to the JSON DTO.
func FromSDKDraftPolicy(draft *openshell.DraftPolicy) DraftPolicy {
	if draft == nil {
		return DraftPolicy{Chunks: []PolicyChunk{}}
	}
	out := DraftPolicy{
		Chunks:           []PolicyChunk{},
		RollingSummary:   draft.RollingSummary,
		DraftVersion:     draft.DraftVersion,
		LastAnalyzedAtMs: timeToMs(draft.LastAnalyzedAt),
	}
	for i := range draft.Chunks {
		chunk := &draft.Chunks[i]
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
		if chunk.ProposedRule != nil {
			item.ProposedRule = MarshalSDKNetworkPolicyRule(chunk.ProposedRule)
		}
		out.Chunks = append(out.Chunks, item)
	}
	return out
}

// FromSDKDraftHistory converts SDK draft history entries to JSON DTOs.
func FromSDKDraftHistory(entries []openshell.DraftHistoryEntry) []DraftHistoryEntry {
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

// FromSDKServiceEndpoint converts an SDK ServiceEndpoint to the JSON DTO.
func FromSDKServiceEndpoint(svc *openshell.ServiceEndpoint) ServiceEndpoint {
	if svc == nil {
		return ServiceEndpoint{}
	}
	return ServiceEndpoint{
		SandboxName: svc.SandboxName,
		ServiceName: svc.ServiceName,
		TargetPort:  svc.TargetPort,
		Domain:      svc.Domain,
		URL:         svc.URL,
	}
}

func sdkSettingValueString(sv openshell.SettingValue) string {
	switch sv.Type {
	case openshell.SettingValueString:
		return sv.StringVal
	case openshell.SettingValueBool:
		return fmt.Sprintf("%t", sv.BoolVal)
	case openshell.SettingValueInt:
		return fmt.Sprintf("%d", sv.IntVal)
	case openshell.SettingValueBytes:
		return fmt.Sprintf("%x", sv.BytesVal)
	}
	return ""
}

// FromSDKGatewaySettings converts an SDK GatewayConfig to the JSON DTO.
func FromSDKGatewaySettings(config *openshell.GatewayConfig) GatewaySettings {
	if config == nil {
		return GatewaySettings{Settings: []SettingEntry{}}
	}
	out := GatewaySettings{
		Settings:         []SettingEntry{},
		SettingsRevision: config.SettingsRevision,
	}
	for key, val := range config.Settings {
		out.Settings = append(out.Settings, SettingEntry{
			Key:   key,
			Value: sdkSettingValueString(val),
		})
	}
	sort.Slice(out.Settings, func(i, j int) bool {
		return out.Settings[i].Key < out.Settings[j].Key
	})
	return out
}

// FromSDKInferenceRoute converts an SDK InferenceRoute to the JSON DTO.
func FromSDKInferenceRoute(route *openshell.InferenceRoute) InferenceRoute {
	if route == nil {
		return InferenceRoute{}
	}
	return InferenceRoute{
		RouteName:    route.RouteName,
		ProviderName: route.ProviderName,
		ModelID:      route.ModelID,
		Version:      route.Version,
		TimeoutSecs:  route.TimeoutSecs,
	}
}

// FromSDKCurrentUser converts an SDK CurrentUser to the JSON DTO.
func FromSDKCurrentUser(user *openshell.CurrentUser) CurrentUser {
	if user == nil {
		return CurrentUser{}
	}
	return CurrentUser{
		Subject:          user.Subject,
		DisplayName:      user.DisplayName,
		Roles:            user.Roles,
		Scopes:           user.Scopes,
		IdentityProvider: user.IdentityProvider,
	}
}

func sdkServiceStatusString(status openshell.ServiceStatus) string {
	switch status {
	case openshell.ServiceStatusHealthy:
		return "HEALTHY"
	case openshell.ServiceStatusDegraded:
		return "DEGRADED"
	case openshell.ServiceStatusUnhealthy:
		return "UNHEALTHY"
	}
	return "UNSPECIFIED"
}

// FromSDKGatewayInfo converts an SDK GatewayInfo to the JSON DTO.
func FromSDKGatewayInfo(info *openshell.GatewayInfo) GatewayInfo {
	if info == nil {
		return GatewayInfo{Status: "UNSPECIFIED", ComputeDrivers: []ComputeDriver{}}
	}
	out := GatewayInfo{
		Status:         sdkServiceStatusString(info.Status),
		GatewayVersion: info.Version,
		ComputeDrivers: []ComputeDriver{},
	}
	for _, driver := range info.ComputeDrivers {
		out.ComputeDrivers = append(out.ComputeDrivers, ComputeDriver{
			Name:          driver.Name,
			DriverName:    driver.DriverName,
			DriverVersion: driver.DriverVersion,
		})
	}
	return out
}

// FromSDKSandboxLogs converts an SDK LogResult to the JSON DTO.
func FromSDKSandboxLogs(result *openshell.LogResult) SandboxLogs {
	if result == nil {
		return SandboxLogs{Logs: []LogLine{}}
	}
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
