// Package models defines the JSON DTOs the BFF returns to the frontend and
// the converters from SDK domain types. Provider credentials (secret fields)
// are never serialized here.
package models

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	openshell "github.com/rhuss/openshell-sdk-go/openshell/v1"
)

func timeToMs(t time.Time) int64 {
	if t.IsZero() {
		return 0
	}
	return t.UnixMilli()
}

func timePtrToMs(t *time.Time) int64 {
	if t == nil {
		return 0
	}
	return t.UnixMilli()
}

// ObjectMeta is the common metadata DTO.
type ObjectMeta struct {
	ID                  string            `json:"id"`
	Name                string            `json:"name"`
	Workspace           string            `json:"workspace,omitempty"`
	Labels              map[string]string `json:"labels,omitempty"`
	Annotations         map[string]string `json:"annotations,omitempty"`
	CreatedAtMs         int64             `json:"createdAtMs"`
	ResourceVersion     uint64            `json:"resourceVersion"`
	DeletionTimestampMs int64             `json:"deletionTimestampMs,omitempty"`
}

// Workspace mirrors openshell.Workspace.
type Workspace struct {
	Metadata ObjectMeta `json:"metadata"`
	Phase    string     `json:"phase"`
}

func FromWorkspace(ws *openshell.Workspace) Workspace {
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
		Phase: strings.ToUpper(string(ws.Phase)),
	}
}

// WorkspaceMember mirrors openshell.WorkspaceMember.
type WorkspaceMember struct {
	Metadata         ObjectMeta `json:"metadata"`
	PrincipalSubject string     `json:"principalSubject"`
	Role             string     `json:"role"`
}

func FromWorkspaceMember(member *openshell.WorkspaceMember) WorkspaceMember {
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
		Role:             strings.ToUpper(string(member.Role)),
	}
}

// WorkspaceRoleFromString maps USER/ADMIN to the SDK WorkspaceRole.
func WorkspaceRoleFromString(role string) (openshell.WorkspaceRole, bool) {
	switch role {
	case "USER":
		return openshell.WorkspaceRoleUser, true
	case "ADMIN":
		return openshell.WorkspaceRoleAdmin, true
	}
	return "", false
}

// SandboxCondition mirrors openshell.SandboxCondition.
type SandboxCondition struct {
	Type               string `json:"type"`
	Status             string `json:"status"`
	Reason             string `json:"reason,omitempty"`
	Message            string `json:"message,omitempty"`
	LastTransitionTime string `json:"lastTransitionTime,omitempty"`
}

// SandboxStatus mirrors openshell.SandboxStatus.
type SandboxStatus struct {
	SandboxName          string             `json:"sandboxName,omitempty"`
	AgentPod             string             `json:"agentPod,omitempty"`
	Conditions           []SandboxCondition `json:"conditions,omitempty"`
	Phase                string             `json:"phase"`
	CurrentPolicyVersion uint32             `json:"currentPolicyVersion"`
}

// SandboxSpec is the dashboard view of openshell.SandboxSpec. Policy is
// carried as camelCase JSON so the full SandboxPolicy schema passes through
// untouched.
type SandboxSpec struct {
	LogLevel    string            `json:"logLevel,omitempty"`
	Environment map[string]string `json:"environment,omitempty"`
	Image       string            `json:"image,omitempty"`
	Providers   []string          `json:"providers,omitempty"`
	Policy      json.RawMessage   `json:"policy,omitempty"`
}

// Sandbox mirrors openshell.Sandbox.
type Sandbox struct {
	Metadata ObjectMeta    `json:"metadata"`
	Spec     SandboxSpec   `json:"spec"`
	Status   SandboxStatus `json:"status"`
}

func FromSandbox(sandbox *openshell.Sandbox) Sandbox {
	out := Sandbox{
		Metadata: ObjectMeta{
			ID:                  sandbox.ID,
			Name:                sandbox.Name,
			Workspace:           sandbox.Workspace,
			Labels:              sandbox.Labels,
			Annotations:         sandbox.Annotations,
			CreatedAtMs:         timeToMs(sandbox.CreatedAt),
			ResourceVersion:     sandbox.ResourceVersion,
			DeletionTimestampMs: timePtrToMs(sandbox.DeletionTimestamp),
		},
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
		out.Spec.Policy = marshalPolicy(sandbox.Spec.Policy)
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

// ParsePolicy converts camelCase JSON policy from the frontend into the SDK
// SandboxPolicy. Unknown fields are rejected to catch malformed input.
func ParsePolicy(raw json.RawMessage) (*openshell.SandboxPolicy, error) {
	policy := &openshell.SandboxPolicy{}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(policy); err != nil {
		return nil, err
	}
	return policy, nil
}

// Provider is the dashboard view of openshell.Provider. The credentials map
// is secret and intentionally absent; only credential key names are surfaced.
type Provider struct {
	Metadata              ObjectMeta        `json:"metadata"`
	Type                  string            `json:"type"`
	Config                map[string]string `json:"config,omitempty"`
	CredentialNames       []string          `json:"credentialNames,omitempty"`
	CredentialExpiresAtMs map[string]int64  `json:"credentialExpiresAtMs,omitempty"`
	ProfileWorkspace      string            `json:"profileWorkspace,omitempty"`
}

func FromProvider(provider *openshell.Provider) Provider {
	out := Provider{
		Metadata: ObjectMeta{
			ID:                  provider.ID,
			Name:                provider.Name,
			Workspace:           provider.Workspace,
			Labels:              provider.Labels,
			Annotations:         provider.Annotations,
			CreatedAtMs:         timeToMs(provider.CreatedAt),
			ResourceVersion:     provider.ResourceVersion,
			DeletionTimestampMs: timePtrToMs(provider.DeletionTimestamp),
		},
		Type:   provider.Type,
		Config: provider.Spec.Config,
	}
	for name := range provider.Spec.Credentials {
		out.CredentialNames = append(out.CredentialNames, name)
	}
	if len(provider.Spec.CredentialExpiresAt) > 0 {
		out.CredentialExpiresAtMs = make(map[string]int64, len(provider.Spec.CredentialExpiresAt))
		for k, t := range provider.Spec.CredentialExpiresAt {
			out.CredentialExpiresAtMs[k] = timeToMs(t)
		}
	}
	return out
}

// CredentialRefreshStatus mirrors openshell.RefreshStatus.
type CredentialRefreshStatus struct {
	CredentialKey   string `json:"credentialKey"`
	Strategy        string `json:"strategy"`
	Status          string `json:"status"`
	ExpiresAtMs     int64  `json:"expiresAtMs,omitempty"`
	NextRefreshAtMs int64  `json:"nextRefreshAtMs,omitempty"`
	LastRefreshAtMs int64  `json:"lastRefreshAtMs,omitempty"`
	LastError       string `json:"lastError,omitempty"`
}

func refreshStrategyString(strategy openshell.RefreshStrategy) string {
	switch strategy {
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
	}
	return string(strategy)
}

func FromCredentialRefreshStatus(status *openshell.RefreshStatus) CredentialRefreshStatus {
	return CredentialRefreshStatus{
		CredentialKey:   status.CredentialKey,
		Strategy:        refreshStrategyString(status.Strategy),
		Status:          status.Status,
		ExpiresAtMs:     timeToMs(status.ExpiresAt),
		NextRefreshAtMs: timeToMs(status.NextRefreshAt),
		LastRefreshAtMs: timeToMs(status.LastRefreshAt),
		LastError:       status.LastError,
	}
}

// ProfileCredential mirrors the credential schema from a ProviderProfile.
type ProfileCredential struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Required    bool   `json:"required"`
	Secret      bool   `json:"secret,omitempty"`
}

// ProviderProfile mirrors openshell.ProviderProfile (schema-relevant subset).
type ProviderProfile struct {
	ID               string              `json:"id"`
	DisplayName      string              `json:"displayName"`
	Description      string              `json:"description,omitempty"`
	Category         string              `json:"category"`
	Credentials      []ProfileCredential `json:"credentials"`
	Endpoints        []string            `json:"endpoints,omitempty"`
	InferenceCapable bool                `json:"inferenceCapable"`
}

func profileCategoryString(category openshell.ProfileCategory) string {
	switch category {
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

func FromProviderProfile(profile *openshell.ProviderProfile) ProviderProfile {
	out := ProviderProfile{
		ID:               profile.ID,
		DisplayName:      profile.DisplayName,
		Description:      profile.Description,
		Category:         profileCategoryString(profile.Category),
		Credentials:      []ProfileCredential{},
		InferenceCapable: profile.InferenceCapable,
	}
	for _, cred := range profile.Credentials {
		out.Credentials = append(out.Credentials, ProfileCredential{
			Name:        cred.Name,
			Description: cred.Description,
			Required:    cred.Required,
			Secret:      cred.Secret,
		})
	}
	for _, endpoint := range profile.Endpoints {
		host := endpoint.Host
		if endpoint.Port > 0 {
			out.Endpoints = append(out.Endpoints, fmt.Sprintf("%s:%d", host, endpoint.Port))
		} else if host != "" {
			out.Endpoints = append(out.Endpoints, host)
		}
	}
	return out
}

// CurrentUser mirrors openshell.CurrentUser.
type CurrentUser struct {
	Subject          string   `json:"subject"`
	DisplayName      string   `json:"displayName,omitempty"`
	Email            string   `json:"email,omitempty"`
	Roles            []string `json:"roles"`
	Scopes           []string `json:"scopes,omitempty"`
	IdentityProvider string   `json:"identityProvider,omitempty"`
}

func FromCurrentUser(user *openshell.CurrentUser) CurrentUser {
	return CurrentUser{
		Subject:          user.Subject,
		DisplayName:      user.DisplayName,
		Roles:            user.Roles,
		Scopes:           user.Scopes,
		IdentityProvider: user.IdentityProvider,
	}
}

// ComputeDriver flattens openshell.ComputeDriverInfo.
type ComputeDriver struct {
	Name          string `json:"name"`
	DriverName    string `json:"driverName,omitempty"`
	DriverVersion string `json:"driverVersion,omitempty"`
}

// GatewayInfo mirrors openshell.GatewayInfo.
type GatewayInfo struct {
	Status         string          `json:"status"`
	GatewayVersion string          `json:"gatewayVersion"`
	ComputeDrivers []ComputeDriver `json:"computeDrivers"`
}

func FromGatewayInfo(info *openshell.GatewayInfo) GatewayInfo {
	out := GatewayInfo{
		Status:         strings.ToUpper(string(info.Status)),
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

// --- Policy JSON serialization types (camelCase for frontend compatibility) ---

type policyJSON struct {
	Version         uint32                           `json:"version,omitempty"`
	Filesystem      *filesystemJSON                  `json:"filesystem,omitempty"`
	Landlock        *landlockJSON                    `json:"landlock,omitempty"`
	Process         *processJSON                     `json:"process,omitempty"`
	NetworkPolicies map[string]networkPolicyRuleJSON  `json:"networkPolicies,omitempty"`
}

type filesystemJSON struct {
	IncludeWorkdir bool     `json:"includeWorkdir,omitempty"`
	ReadOnly       []string `json:"readOnly,omitempty"`
	ReadWrite      []string `json:"readWrite,omitempty"`
}

type landlockJSON struct {
	Compatibility string `json:"compatibility,omitempty"`
}

type processJSON struct {
	RunAsUser  string `json:"runAsUser,omitempty"`
	RunAsGroup string `json:"runAsGroup,omitempty"`
}

type networkPolicyRuleJSON struct {
	Name      string                       `json:"name,omitempty"`
	Endpoints []policyNetworkEndpointJSON  `json:"endpoints,omitempty"`
	Binaries  []policyNetworkBinaryJSON    `json:"binaries,omitempty"`
}

type policyNetworkEndpointJSON struct {
	Host                         string                        `json:"host,omitempty"`
	Port                         uint32                        `json:"port,omitempty"`
	Ports                        []uint32                      `json:"ports,omitempty"`
	Protocol                     string                        `json:"protocol,omitempty"`
	Tls                          string                        `json:"tls,omitempty"`
	Enforcement                  string                        `json:"enforcement,omitempty"`
	Access                       string                        `json:"access,omitempty"`
	Rules                        []l7RuleJSON                  `json:"rules,omitempty"`
	AllowedIps                   []string                      `json:"allowedIps,omitempty"`
	DenyRules                    []l7DenyRuleJSON              `json:"denyRules,omitempty"`
	AllowEncodedSlash            bool                          `json:"allowEncodedSlash,omitempty"`
	PersistedQueries             string                        `json:"persistedQueries,omitempty"`
	GraphqlPersistedQueries      map[string]graphqlOpJSON      `json:"graphqlPersistedQueries,omitempty"`
	GraphqlMaxBodyBytes          uint32                        `json:"graphqlMaxBodyBytes,omitempty"`
	Path                         string                        `json:"path,omitempty"`
	WebsocketCredentialRewrite   bool                          `json:"websocketCredentialRewrite,omitempty"`
	RequestBodyCredentialRewrite bool                          `json:"requestBodyCredentialRewrite,omitempty"`
	AdvisorProposed              bool                          `json:"advisorProposed,omitempty"`
}

type policyNetworkBinaryJSON struct {
	Path string `json:"path,omitempty"`
}

type l7RuleJSON struct {
	Allow *l7AllowJSON `json:"allow,omitempty"`
}

type l7AllowJSON struct {
	Method        string                        `json:"method,omitempty"`
	Path          string                        `json:"path,omitempty"`
	Command       string                        `json:"command,omitempty"`
	Query         map[string]l7QueryMatcherJSON `json:"query,omitempty"`
	OperationType string                        `json:"operationType,omitempty"`
	OperationName string                        `json:"operationName,omitempty"`
	Fields        []string                      `json:"fields,omitempty"`
}

type l7DenyRuleJSON struct {
	Method        string                        `json:"method,omitempty"`
	Path          string                        `json:"path,omitempty"`
	Command       string                        `json:"command,omitempty"`
	Query         map[string]l7QueryMatcherJSON `json:"query,omitempty"`
	OperationType string                        `json:"operationType,omitempty"`
	OperationName string                        `json:"operationName,omitempty"`
	Fields        []string                      `json:"fields,omitempty"`
}

type l7QueryMatcherJSON struct {
	Glob string   `json:"glob,omitempty"`
	Any  []string `json:"any,omitempty"`
}

type graphqlOpJSON struct {
	OperationType string   `json:"operationType,omitempty"`
	OperationName string   `json:"operationName,omitempty"`
	Fields        []string `json:"fields,omitempty"`
}

func marshalPolicy(p *openshell.SandboxPolicy) json.RawMessage {
	pj := policyJSON{Version: p.Version}
	if p.Filesystem != nil {
		pj.Filesystem = &filesystemJSON{
			IncludeWorkdir: p.Filesystem.IncludeWorkdir,
			ReadOnly:       p.Filesystem.ReadOnly,
			ReadWrite:      p.Filesystem.ReadWrite,
		}
	}
	if p.Landlock != nil {
		pj.Landlock = &landlockJSON{Compatibility: p.Landlock.Compatibility}
	}
	if p.Process != nil {
		pj.Process = &processJSON{
			RunAsUser:  p.Process.RunAsUser,
			RunAsGroup: p.Process.RunAsGroup,
		}
	}
	if p.NetworkPolicies != nil {
		pj.NetworkPolicies = make(map[string]networkPolicyRuleJSON, len(p.NetworkPolicies))
		for k, rule := range p.NetworkPolicies {
			pj.NetworkPolicies[k] = convertNetworkPolicyRule(rule)
		}
	}
	raw, err := json.Marshal(pj)
	if err != nil {
		return nil
	}
	return raw
}

// MarshalNetworkPolicyRule converts an SDK NetworkPolicyRule to camelCase JSON.
func MarshalNetworkPolicyRule(rule *openshell.NetworkPolicyRule) json.RawMessage {
	if rule == nil {
		return nil
	}
	rj := convertNetworkPolicyRule(*rule)
	raw, err := json.Marshal(rj)
	if err != nil {
		return nil
	}
	return raw
}

func convertNetworkPolicyRule(rule openshell.NetworkPolicyRule) networkPolicyRuleJSON {
	rj := networkPolicyRuleJSON{Name: rule.Name}
	for _, ep := range rule.Endpoints {
		ej := policyNetworkEndpointJSON{
			Host:                         ep.Host,
			Port:                         ep.Port,
			Ports:                        ep.Ports,
			Protocol:                     ep.Protocol,
			Tls:                          ep.TLS,
			Enforcement:                  ep.Enforcement,
			Access:                       ep.Access,
			AllowedIps:                   ep.AllowedIPs,
			AllowEncodedSlash:            ep.AllowEncodedSlash,
			PersistedQueries:             ep.PersistedQueries,
			GraphqlMaxBodyBytes:          ep.GraphqlMaxBodyBytes,
			Path:                         ep.Path,
			WebsocketCredentialRewrite:   ep.WebsocketCredentialRewrite,
			RequestBodyCredentialRewrite: ep.RequestBodyCredentialRewrite,
			AdvisorProposed:              ep.AdvisorProposed,
		}
		for _, r := range ep.Rules {
			ej.Rules = append(ej.Rules, convertL7Rule(r))
		}
		for _, dr := range ep.DenyRules {
			ej.DenyRules = append(ej.DenyRules, convertL7DenyRule(dr))
		}
		if len(ep.GraphqlPersistedQueries) > 0 {
			ej.GraphqlPersistedQueries = make(map[string]graphqlOpJSON, len(ep.GraphqlPersistedQueries))
			for k, op := range ep.GraphqlPersistedQueries {
				ej.GraphqlPersistedQueries[k] = graphqlOpJSON{
					OperationType: op.OperationType,
					OperationName: op.OperationName,
					Fields:        op.Fields,
				}
			}
		}
		rj.Endpoints = append(rj.Endpoints, ej)
	}
	for _, b := range rule.Binaries {
		rj.Binaries = append(rj.Binaries, policyNetworkBinaryJSON{Path: b.Path})
	}
	return rj
}

func convertL7Rule(r openshell.L7Rule) l7RuleJSON {
	rj := l7RuleJSON{}
	if r.Allow != nil {
		rj.Allow = &l7AllowJSON{
			Method:        r.Allow.Method,
			Path:          r.Allow.Path,
			Command:       r.Allow.Command,
			OperationType: r.Allow.OperationType,
			OperationName: r.Allow.OperationName,
			Fields:        r.Allow.Fields,
		}
		if len(r.Allow.Query) > 0 {
			rj.Allow.Query = make(map[string]l7QueryMatcherJSON, len(r.Allow.Query))
			for k, q := range r.Allow.Query {
				rj.Allow.Query[k] = l7QueryMatcherJSON{Glob: q.Glob, Any: q.Any}
			}
		}
	}
	return rj
}

// ParseNetworkPolicyRule parses camelCase JSON into an SDK NetworkPolicyRule.
func ParseNetworkPolicyRule(raw json.RawMessage) (*openshell.NetworkPolicyRule, error) {
	var rj networkPolicyRuleJSON
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&rj); err != nil {
		return nil, err
	}
	rule := &openshell.NetworkPolicyRule{Name: rj.Name}
	for _, ej := range rj.Endpoints {
		ep := openshell.PolicyNetworkEndpoint{
			Host:                        ej.Host,
			Port:                        ej.Port,
			Ports:                       ej.Ports,
			Protocol:                    ej.Protocol,
			TLS:                         ej.Tls,
			Enforcement:                 ej.Enforcement,
			Access:                      ej.Access,
			AllowedIPs:                  ej.AllowedIps,
			AllowEncodedSlash:           ej.AllowEncodedSlash,
			PersistedQueries:            ej.PersistedQueries,
			GraphqlMaxBodyBytes:         ej.GraphqlMaxBodyBytes,
			Path:                        ej.Path,
			WebsocketCredentialRewrite:  ej.WebsocketCredentialRewrite,
			RequestBodyCredentialRewrite: ej.RequestBodyCredentialRewrite,
			AdvisorProposed:             ej.AdvisorProposed,
		}
		for _, rJSON := range ej.Rules {
			ep.Rules = append(ep.Rules, parseL7Rule(rJSON))
		}
		for _, drJSON := range ej.DenyRules {
			ep.DenyRules = append(ep.DenyRules, parseL7DenyRule(drJSON))
		}
		if len(ej.GraphqlPersistedQueries) > 0 {
			ep.GraphqlPersistedQueries = make(map[string]openshell.GraphqlOperation, len(ej.GraphqlPersistedQueries))
			for k, op := range ej.GraphqlPersistedQueries {
				ep.GraphqlPersistedQueries[k] = openshell.GraphqlOperation{
					OperationType: op.OperationType,
					OperationName: op.OperationName,
					Fields:        op.Fields,
				}
			}
		}
		rule.Endpoints = append(rule.Endpoints, ep)
	}
	for _, bj := range rj.Binaries {
		rule.Binaries = append(rule.Binaries, openshell.PolicyNetworkBinary{Path: bj.Path})
	}
	return rule, nil
}

func parseL7Rule(rj l7RuleJSON) openshell.L7Rule {
	r := openshell.L7Rule{}
	if rj.Allow != nil {
		r.Allow = &openshell.L7Allow{
			Method:        rj.Allow.Method,
			Path:          rj.Allow.Path,
			Command:       rj.Allow.Command,
			OperationType: rj.Allow.OperationType,
			OperationName: rj.Allow.OperationName,
			Fields:        rj.Allow.Fields,
		}
		if len(rj.Allow.Query) > 0 {
			r.Allow.Query = make(map[string]openshell.L7QueryMatcher, len(rj.Allow.Query))
			for k, q := range rj.Allow.Query {
				r.Allow.Query[k] = openshell.L7QueryMatcher{Glob: q.Glob, Any: q.Any}
			}
		}
	}
	return r
}

func parseL7DenyRule(dj l7DenyRuleJSON) openshell.L7DenyRule {
	dr := openshell.L7DenyRule{
		Method:        dj.Method,
		Path:          dj.Path,
		Command:       dj.Command,
		OperationType: dj.OperationType,
		OperationName: dj.OperationName,
		Fields:        dj.Fields,
	}
	if len(dj.Query) > 0 {
		dr.Query = make(map[string]openshell.L7QueryMatcher, len(dj.Query))
		for k, q := range dj.Query {
			dr.Query[k] = openshell.L7QueryMatcher{Glob: q.Glob, Any: q.Any}
		}
	}
	return dr
}

func convertL7DenyRule(dr openshell.L7DenyRule) l7DenyRuleJSON {
	dj := l7DenyRuleJSON{
		Method:        dr.Method,
		Path:          dr.Path,
		Command:       dr.Command,
		OperationType: dr.OperationType,
		OperationName: dr.OperationName,
		Fields:        dr.Fields,
	}
	if len(dr.Query) > 0 {
		dj.Query = make(map[string]l7QueryMatcherJSON, len(dr.Query))
		for k, q := range dr.Query {
			dj.Query[k] = l7QueryMatcherJSON{Glob: q.Glob, Any: q.Any}
		}
	}
	return dj
}
