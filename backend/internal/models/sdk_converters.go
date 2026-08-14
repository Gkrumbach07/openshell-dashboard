package models

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"
)

// FromSDKSandbox converts an SDK Sandbox to the JSON DTO the frontend expects.
func FromSDKSandbox(sandbox *openshell.Sandbox) Sandbox {
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

// ParseSDKPolicy converts camelCase JSON from the frontend into the SDK SandboxPolicy.
func ParseSDKPolicy(raw json.RawMessage) (*openshell.SandboxPolicy, error) {
	var p sdkPolicyJSON
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, err
	}
	policy := &openshell.SandboxPolicy{Version: p.Version}
	if p.Filesystem != nil {
		policy.Filesystem = &openshell.FilesystemPolicy{
			IncludeWorkdir: p.Filesystem.IncludeWorkdir,
			ReadOnly:       p.Filesystem.ReadOnly,
			ReadWrite:      p.Filesystem.ReadWrite,
		}
	}
	if p.Landlock != nil {
		policy.Landlock = &openshell.LandlockPolicy{Compatibility: p.Landlock.Compatibility}
	}
	if p.Process != nil {
		policy.Process = &openshell.ProcessPolicy{
			RunAsUser:  p.Process.RunAsUser,
			RunAsGroup: p.Process.RunAsGroup,
		}
	}
	if p.NetworkPolicies != nil {
		policy.NetworkPolicies = make(map[string]openshell.NetworkPolicyRule, len(p.NetworkPolicies))
		for k, v := range p.NetworkPolicies {
			policy.NetworkPolicies[k] = parseSDKNetworkRule(v)
		}
	}
	return policy, nil
}

func timeToMs(t time.Time) int64 {
	if t.IsZero() {
		return 0
	}
	return t.UnixMilli()
}

// marshalSDKPolicy converts an SDK SandboxPolicy into camelCase JSON for the frontend.
func marshalSDKPolicy(p *openshell.SandboxPolicy) json.RawMessage {
	pj := sdkPolicyJSON{Version: p.Version}
	if p.Filesystem != nil {
		pj.Filesystem = &sdkFilesystemJSON{
			IncludeWorkdir: p.Filesystem.IncludeWorkdir,
			ReadOnly:       p.Filesystem.ReadOnly,
			ReadWrite:      p.Filesystem.ReadWrite,
		}
	}
	if p.Landlock != nil {
		pj.Landlock = &sdkLandlockJSON{Compatibility: p.Landlock.Compatibility}
	}
	if p.Process != nil {
		pj.Process = &sdkProcessJSON{
			RunAsUser:  p.Process.RunAsUser,
			RunAsGroup: p.Process.RunAsGroup,
		}
	}
	if p.NetworkPolicies != nil {
		pj.NetworkPolicies = make(map[string]sdkNetworkPolicyRuleJSON, len(p.NetworkPolicies))
		for k, rule := range p.NetworkPolicies {
			pj.NetworkPolicies[k] = marshalSDKNetworkRule(rule)
		}
	}
	raw, err := json.Marshal(pj)
	if err != nil {
		return nil
	}
	return raw
}

// --- JSON serialization types for SDK policy (camelCase for frontend) ---

type sdkPolicyJSON struct {
	Version         uint32                              `json:"version,omitempty"`
	Filesystem      *sdkFilesystemJSON                  `json:"filesystem,omitempty"`
	Landlock        *sdkLandlockJSON                    `json:"landlock,omitempty"`
	Process         *sdkProcessJSON                     `json:"process,omitempty"`
	NetworkPolicies map[string]sdkNetworkPolicyRuleJSON `json:"networkPolicies,omitempty"`
}

type sdkFilesystemJSON struct {
	IncludeWorkdir bool     `json:"includeWorkdir,omitempty"`
	ReadOnly       []string `json:"readOnly,omitempty"`
	ReadWrite      []string `json:"readWrite,omitempty"`
}

type sdkLandlockJSON struct {
	Compatibility string `json:"compatibility,omitempty"`
}

type sdkProcessJSON struct {
	RunAsUser  string `json:"runAsUser,omitempty"`
	RunAsGroup string `json:"runAsGroup,omitempty"`
}

type sdkNetworkPolicyRuleJSON struct {
	Name      string                      `json:"name,omitempty"`
	Endpoints []sdkNetworkEndpointJSON    `json:"endpoints,omitempty"`
	Binaries  []sdkNetworkBinaryJSON      `json:"binaries,omitempty"`
}

type sdkNetworkEndpointJSON struct {
	Host        string `json:"host,omitempty"`
	Port        uint32 `json:"port,omitempty"`
	Protocol    string `json:"protocol,omitempty"`
	Tls         string `json:"tls,omitempty"`
	Enforcement string `json:"enforcement,omitempty"`
	Access      string `json:"access,omitempty"`
}

type sdkNetworkBinaryJSON struct {
	Path string `json:"path,omitempty"`
}

func parseSDKNetworkRule(rj sdkNetworkPolicyRuleJSON) openshell.NetworkPolicyRule {
	rule := openshell.NetworkPolicyRule{Name: rj.Name}
	for _, ej := range rj.Endpoints {
		rule.Endpoints = append(rule.Endpoints, openshell.PolicyNetworkEndpoint{
			Host:        ej.Host,
			Port:        ej.Port,
			Protocol:    ej.Protocol,
			TLS:         ej.Tls,
			Enforcement: ej.Enforcement,
			Access:      ej.Access,
		})
	}
	for _, bj := range rj.Binaries {
		rule.Binaries = append(rule.Binaries, openshell.PolicyNetworkBinary{Path: bj.Path})
	}
	return rule
}

func marshalSDKNetworkRule(rule openshell.NetworkPolicyRule) sdkNetworkPolicyRuleJSON {
	rj := sdkNetworkPolicyRuleJSON{Name: rule.Name}
	for _, ep := range rule.Endpoints {
		rj.Endpoints = append(rj.Endpoints, sdkNetworkEndpointJSON{
			Host:        ep.Host,
			Port:        ep.Port,
			Protocol:    ep.Protocol,
			Tls:         ep.TLS,
			Enforcement: ep.Enforcement,
			Access:      ep.Access,
		})
	}
	for _, b := range rule.Binaries {
		rj.Binaries = append(rj.Binaries, sdkNetworkBinaryJSON{Path: b.Path})
	}
	return rj
}
