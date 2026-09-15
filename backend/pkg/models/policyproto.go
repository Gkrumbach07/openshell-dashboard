package models

// This file bridges the SDK's domain policy types (which carry no JSON tags)
// and the proto SandboxPolicy, so we can (de)serialize policies with protojson
// — reproducing the exact camelCase, full-fidelity JSON contract the frontend
// spoke before the SDK migration.
//
// The SDK's own domain<->proto converter lives in an internal package and is
// not importable, so the conversion below is a faithful port of
// openshell/v1/internal/converter/{policy,network_policy}.go (Apache-2.0).
// It covers EVERY field of the policy tree (L7 allow/deny rules, IP allowlists,
// multi-port, GraphQL persisted queries, MCP options, credential binding,
// signing, middleware, ...). If OpenShell adds a policy field upstream, add it
// here too — the round-trip test in policyproto_test.go guards the known set.

import (
	ostypes "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1/types"
	sbv1 "github.com/NVIDIA/OpenShell/sdk/go/proto/sandboxv1"
	"google.golang.org/protobuf/types/known/structpb"
)

func copyStringSlice(in []string) []string {
	if len(in) == 0 {
		return nil
	}
	out := make([]string, len(in))
	copy(out, in)
	return out
}

func copyBoolPtr(in *bool) *bool {
	if in == nil {
		return nil
	}
	v := *in
	return &v
}

// --- SandboxPolicy ---

func sandboxPolicyFromProto(p *sbv1.SandboxPolicy) *ostypes.SandboxPolicy {
	if p == nil {
		return nil
	}
	result := &ostypes.SandboxPolicy{
		Version:    p.GetVersion(),
		Filesystem: filesystemPolicyFromProto(p.GetFilesystem()),
		Landlock:   landlockPolicyFromProto(p.GetLandlock()),
		Process:    processPolicyFromProto(p.GetProcess()),
	}
	if np := p.GetNetworkPolicies(); np != nil {
		result.NetworkPolicies = make(map[string]ostypes.NetworkPolicyRule, len(np))
		for k, v := range np {
			if converted := networkPolicyRuleFromProto(v); converted != nil {
				result.NetworkPolicies[k] = *converted
			}
		}
	}
	if mw := p.GetNetworkMiddlewares(); mw != nil {
		result.NetworkMiddlewares = make(map[string]ostypes.NetworkMiddlewareConfig, len(mw))
		for k, v := range mw {
			if v != nil {
				result.NetworkMiddlewares[k] = middlewareConfigFromProto(v)
			}
		}
	}
	return result
}

func sandboxPolicyToProto(p *ostypes.SandboxPolicy) *sbv1.SandboxPolicy {
	if p == nil {
		return nil
	}
	result := &sbv1.SandboxPolicy{
		Version:    p.Version,
		Filesystem: filesystemPolicyToProto(p.Filesystem),
		Landlock:   landlockPolicyToProto(p.Landlock),
		Process:    processPolicyToProto(p.Process),
	}
	if p.NetworkPolicies != nil {
		result.NetworkPolicies = make(map[string]*sbv1.NetworkPolicyRule, len(p.NetworkPolicies))
		for k, v := range p.NetworkPolicies {
			rule := v
			result.NetworkPolicies[k] = networkPolicyRuleToProto(&rule)
		}
	}
	if p.NetworkMiddlewares != nil {
		result.NetworkMiddlewares = make(map[string]*sbv1.NetworkMiddlewareConfig, len(p.NetworkMiddlewares))
		for k, v := range p.NetworkMiddlewares {
			mw := v
			result.NetworkMiddlewares[k] = middlewareConfigToProto(&mw)
		}
	}
	return result
}

func middlewareConfigFromProto(m *sbv1.NetworkMiddlewareConfig) ostypes.NetworkMiddlewareConfig {
	result := ostypes.NetworkMiddlewareConfig{
		Name:       m.GetName(),
		Middleware: m.GetMiddleware(),
		OnError:    m.GetOnError(),
		Order:      m.GetOrder(),
	}
	if c := m.GetConfig(); c != nil {
		result.Config = c.AsMap()
	}
	if ep := m.GetEndpoints(); ep != nil {
		result.Endpoints = &ostypes.MiddlewareEndpointSelector{
			Include: copyStringSlice(ep.GetInclude()),
			Exclude: copyStringSlice(ep.GetExclude()),
		}
	}
	return result
}

func middlewareConfigToProto(m *ostypes.NetworkMiddlewareConfig) *sbv1.NetworkMiddlewareConfig {
	result := &sbv1.NetworkMiddlewareConfig{
		Name:       m.Name,
		Middleware: m.Middleware,
		OnError:    m.OnError,
		Order:      m.Order,
	}
	if m.Config != nil {
		// Config originates from frontend JSON (structpb.AsMap round-trips), so
		// it is always re-serializable; drop silently on the rare error.
		if s, err := structpb.NewStruct(m.Config); err == nil {
			result.Config = s
		}
	}
	if m.Endpoints != nil {
		result.Endpoints = &sbv1.MiddlewareEndpointSelector{
			Include: copyStringSlice(m.Endpoints.Include),
			Exclude: copyStringSlice(m.Endpoints.Exclude),
		}
	}
	return result
}

func filesystemPolicyFromProto(f *sbv1.FilesystemPolicy) *ostypes.FilesystemPolicy {
	if f == nil {
		return nil
	}
	return &ostypes.FilesystemPolicy{
		IncludeWorkdir: f.GetIncludeWorkdir(),
		ReadOnly:       copyStringSlice(f.GetReadOnly()),
		ReadWrite:      copyStringSlice(f.GetReadWrite()),
	}
}

func filesystemPolicyToProto(f *ostypes.FilesystemPolicy) *sbv1.FilesystemPolicy {
	if f == nil {
		return nil
	}
	return &sbv1.FilesystemPolicy{
		IncludeWorkdir: f.IncludeWorkdir,
		ReadOnly:       copyStringSlice(f.ReadOnly),
		ReadWrite:      copyStringSlice(f.ReadWrite),
	}
}

func landlockPolicyFromProto(l *sbv1.LandlockPolicy) *ostypes.LandlockPolicy {
	if l == nil {
		return nil
	}
	return &ostypes.LandlockPolicy{Compatibility: l.GetCompatibility()}
}

func landlockPolicyToProto(l *ostypes.LandlockPolicy) *sbv1.LandlockPolicy {
	if l == nil {
		return nil
	}
	return &sbv1.LandlockPolicy{Compatibility: l.Compatibility}
}

func processPolicyFromProto(p *sbv1.ProcessPolicy) *ostypes.ProcessPolicy {
	if p == nil {
		return nil
	}
	return &ostypes.ProcessPolicy{
		RunAsUser:  p.GetRunAsUser(),
		RunAsGroup: p.GetRunAsGroup(),
	}
}

func processPolicyToProto(p *ostypes.ProcessPolicy) *sbv1.ProcessPolicy {
	if p == nil {
		return nil
	}
	return &sbv1.ProcessPolicy{
		RunAsUser:  p.RunAsUser,
		RunAsGroup: p.RunAsGroup,
	}
}

// --- NetworkPolicyRule ---

func networkPolicyRuleFromProto(r *sbv1.NetworkPolicyRule) *ostypes.NetworkPolicyRule {
	if r == nil {
		return nil
	}
	result := &ostypes.NetworkPolicyRule{Name: r.GetName()}
	if eps := r.GetEndpoints(); len(eps) > 0 {
		result.Endpoints = make([]ostypes.PolicyNetworkEndpoint, len(eps))
		for i, ep := range eps {
			if ep != nil {
				result.Endpoints[i] = policyNetworkEndpointFromProto(ep)
			}
		}
	}
	if bins := r.GetBinaries(); len(bins) > 0 {
		result.Binaries = make([]ostypes.PolicyNetworkBinary, len(bins))
		for i, b := range bins {
			if b != nil {
				result.Binaries[i] = ostypes.PolicyNetworkBinary{Path: b.GetPath()}
			}
		}
	}
	return result
}

func networkPolicyRuleToProto(r *ostypes.NetworkPolicyRule) *sbv1.NetworkPolicyRule {
	if r == nil {
		return nil
	}
	result := &sbv1.NetworkPolicyRule{Name: r.Name}
	if len(r.Endpoints) > 0 {
		result.Endpoints = make([]*sbv1.NetworkEndpoint, len(r.Endpoints))
		for i := range r.Endpoints {
			result.Endpoints[i] = policyNetworkEndpointToProto(&r.Endpoints[i])
		}
	}
	if len(r.Binaries) > 0 {
		result.Binaries = make([]*sbv1.NetworkBinary, len(r.Binaries))
		for i := range r.Binaries {
			result.Binaries[i] = &sbv1.NetworkBinary{Path: r.Binaries[i].Path}
		}
	}
	return result
}

// --- PolicyNetworkEndpoint ---

func policyNetworkEndpointFromProto(ep *sbv1.NetworkEndpoint) ostypes.PolicyNetworkEndpoint {
	result := ostypes.PolicyNetworkEndpoint{
		Host:                         ep.GetHost(),
		Port:                         ep.GetPort(),
		Protocol:                     ep.GetProtocol(),
		TLS:                          ep.GetTls(),
		Enforcement:                  ep.GetEnforcement(),
		Access:                       ep.GetAccess(),
		AllowEncodedSlash:            ep.GetAllowEncodedSlash(),
		PersistedQueries:             ep.GetPersistedQueries(),
		GraphqlMaxBodyBytes:          ep.GetGraphqlMaxBodyBytes(),
		Path:                         ep.GetPath(),
		WebsocketCredentialRewrite:   ep.GetWebsocketCredentialRewrite(),
		RequestBodyCredentialRewrite: ep.GetRequestBodyCredentialRewrite(),
		AdvisorProposed:              ep.GetAdvisorProposed(),
		CredentialSigning:            ep.GetCredentialSigning(),
		SigningService:               ep.GetSigningService(),
		SigningRegion:                ep.GetSigningRegion(),
		JSONRPCMaxBodyBytes:          ep.GetJsonRpcMaxBodyBytes(),
	}
	if binding := ep.GetCredentialBinding(); binding != nil {
		result.CredentialBinding = &ostypes.NetworkCredentialBinding{Provider: binding.GetProvider()}
	}
	if ports := ep.GetPorts(); len(ports) > 0 {
		result.Ports = make([]uint32, len(ports))
		copy(result.Ports, ports)
	}
	if ips := ep.GetAllowedIps(); len(ips) > 0 {
		result.AllowedIPs = copyStringSlice(ips)
	}
	if rules := ep.GetRules(); len(rules) > 0 {
		result.Rules = make([]ostypes.L7Rule, len(rules))
		for i, r := range rules {
			if r != nil {
				result.Rules[i] = l7RuleFromProto(r)
			}
		}
	}
	if deny := ep.GetDenyRules(); len(deny) > 0 {
		result.DenyRules = make([]ostypes.L7DenyRule, len(deny))
		for i, r := range deny {
			if r != nil {
				result.DenyRules[i] = l7DenyRuleFromProto(r)
			}
		}
	}
	if gql := ep.GetGraphqlPersistedQueries(); len(gql) > 0 {
		result.GraphqlPersistedQueries = make(map[string]ostypes.GraphqlOperation, len(gql))
		for k, v := range gql {
			if v != nil {
				result.GraphqlPersistedQueries[k] = graphqlOperationFromProto(v)
			}
		}
	}
	result.Mcp = mcpOptionsFromProto(ep.GetMcp())
	return result
}

func policyNetworkEndpointToProto(ep *ostypes.PolicyNetworkEndpoint) *sbv1.NetworkEndpoint {
	result := &sbv1.NetworkEndpoint{
		Host:                         ep.Host,
		Port:                         ep.Port,
		Protocol:                     ep.Protocol,
		Tls:                          ep.TLS,
		Enforcement:                  ep.Enforcement,
		Access:                       ep.Access,
		AllowEncodedSlash:            ep.AllowEncodedSlash,
		PersistedQueries:             ep.PersistedQueries,
		GraphqlMaxBodyBytes:          ep.GraphqlMaxBodyBytes,
		Path:                         ep.Path,
		WebsocketCredentialRewrite:   ep.WebsocketCredentialRewrite,
		RequestBodyCredentialRewrite: ep.RequestBodyCredentialRewrite,
		AdvisorProposed:              ep.AdvisorProposed,
		CredentialSigning:            ep.CredentialSigning,
		SigningService:               ep.SigningService,
		SigningRegion:                ep.SigningRegion,
		JsonRpcMaxBodyBytes:          ep.JSONRPCMaxBodyBytes,
	}
	if ep.CredentialBinding != nil {
		result.CredentialBinding = &sbv1.NetworkCredentialBinding{Provider: ep.CredentialBinding.Provider}
	}
	if len(ep.Ports) > 0 {
		result.Ports = make([]uint32, len(ep.Ports))
		copy(result.Ports, ep.Ports)
	}
	if len(ep.AllowedIPs) > 0 {
		result.AllowedIps = copyStringSlice(ep.AllowedIPs)
	}
	if len(ep.Rules) > 0 {
		result.Rules = make([]*sbv1.L7Rule, len(ep.Rules))
		for i := range ep.Rules {
			result.Rules[i] = l7RuleToProto(&ep.Rules[i])
		}
	}
	if len(ep.DenyRules) > 0 {
		result.DenyRules = make([]*sbv1.L7DenyRule, len(ep.DenyRules))
		for i := range ep.DenyRules {
			result.DenyRules[i] = l7DenyRuleToProto(&ep.DenyRules[i])
		}
	}
	if len(ep.GraphqlPersistedQueries) > 0 {
		result.GraphqlPersistedQueries = make(map[string]*sbv1.GraphqlOperation, len(ep.GraphqlPersistedQueries))
		for k, v := range ep.GraphqlPersistedQueries {
			op := v
			result.GraphqlPersistedQueries[k] = graphqlOperationToProto(&op)
		}
	}
	result.Mcp = mcpOptionsToProto(ep.Mcp)
	return result
}

// --- McpOptions ---

func mcpOptionsFromProto(m *sbv1.McpOptions) *ostypes.McpOptions {
	if m == nil {
		return nil
	}
	return &ostypes.McpOptions{
		StrictToolNames:         copyBoolPtr(m.StrictToolNames),
		AllowAllKnownMcpMethods: copyBoolPtr(m.AllowAllKnownMcpMethods),
	}
}

func mcpOptionsToProto(m *ostypes.McpOptions) *sbv1.McpOptions {
	if m == nil {
		return nil
	}
	return &sbv1.McpOptions{
		StrictToolNames:         copyBoolPtr(m.StrictToolNames),
		AllowAllKnownMcpMethods: copyBoolPtr(m.AllowAllKnownMcpMethods),
	}
}

// --- L7Rule ---

func l7RuleFromProto(r *sbv1.L7Rule) ostypes.L7Rule {
	result := ostypes.L7Rule{}
	if a := r.GetAllow(); a != nil {
		result.Allow = &ostypes.L7Allow{
			Method:        a.GetMethod(),
			Path:          a.GetPath(),
			Command:       a.GetCommand(),
			OperationType: a.GetOperationType(),
			OperationName: a.GetOperationName(),
			Fields:        copyStringSlice(a.GetFields()),
		}
		if q := a.GetQuery(); len(q) > 0 {
			result.Allow.Query = l7QueryMapFromProto(q)
		}
		if p := a.GetParams(); len(p) > 0 {
			result.Allow.Params = l7QueryMapFromProto(p)
		}
	}
	return result
}

func l7RuleToProto(r *ostypes.L7Rule) *sbv1.L7Rule {
	result := &sbv1.L7Rule{}
	if r.Allow != nil {
		result.Allow = &sbv1.L7Allow{
			Method:        r.Allow.Method,
			Path:          r.Allow.Path,
			Command:       r.Allow.Command,
			OperationType: r.Allow.OperationType,
			OperationName: r.Allow.OperationName,
			Fields:        copyStringSlice(r.Allow.Fields),
		}
		if len(r.Allow.Query) > 0 {
			result.Allow.Query = l7QueryMapToProto(r.Allow.Query)
		}
		if len(r.Allow.Params) > 0 {
			result.Allow.Params = l7QueryMapToProto(r.Allow.Params)
		}
	}
	return result
}

// --- L7DenyRule ---

func l7DenyRuleFromProto(r *sbv1.L7DenyRule) ostypes.L7DenyRule {
	return ostypes.L7DenyRule{
		Method:        r.GetMethod(),
		Path:          r.GetPath(),
		Command:       r.GetCommand(),
		OperationType: r.GetOperationType(),
		OperationName: r.GetOperationName(),
		Fields:        copyStringSlice(r.GetFields()),
		Query:         l7QueryMapFromProto(r.GetQuery()),
		Params:        l7QueryMapFromProto(r.GetParams()),
	}
}

func l7DenyRuleToProto(r *ostypes.L7DenyRule) *sbv1.L7DenyRule {
	result := &sbv1.L7DenyRule{
		Method:        r.Method,
		Path:          r.Path,
		Command:       r.Command,
		OperationType: r.OperationType,
		OperationName: r.OperationName,
		Fields:        copyStringSlice(r.Fields),
	}
	if len(r.Query) > 0 {
		result.Query = l7QueryMapToProto(r.Query)
	}
	if len(r.Params) > 0 {
		result.Params = l7QueryMapToProto(r.Params)
	}
	return result
}

// --- L7QueryMatcher helpers ---

func l7QueryMapFromProto(m map[string]*sbv1.L7QueryMatcher) map[string]ostypes.L7QueryMatcher {
	if len(m) == 0 {
		return nil
	}
	result := make(map[string]ostypes.L7QueryMatcher, len(m))
	for k, v := range m {
		if v != nil {
			result[k] = ostypes.L7QueryMatcher{
				Glob: v.GetGlob(),
				Any:  copyStringSlice(v.GetAny()),
			}
		}
	}
	return result
}

func l7QueryMapToProto(m map[string]ostypes.L7QueryMatcher) map[string]*sbv1.L7QueryMatcher {
	if len(m) == 0 {
		return nil
	}
	result := make(map[string]*sbv1.L7QueryMatcher, len(m))
	for k, v := range m {
		result[k] = &sbv1.L7QueryMatcher{
			Glob: v.Glob,
			Any:  copyStringSlice(v.Any),
		}
	}
	return result
}

// --- GraphqlOperation ---

func graphqlOperationFromProto(op *sbv1.GraphqlOperation) ostypes.GraphqlOperation {
	return ostypes.GraphqlOperation{
		OperationType: op.GetOperationType(),
		OperationName: op.GetOperationName(),
		Fields:        copyStringSlice(op.GetFields()),
	}
}

func graphqlOperationToProto(op *ostypes.GraphqlOperation) *sbv1.GraphqlOperation {
	return &sbv1.GraphqlOperation{
		OperationType: op.OperationType,
		OperationName: op.OperationName,
		Fields:        copyStringSlice(op.Fields),
	}
}
