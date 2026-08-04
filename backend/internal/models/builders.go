package models

import (
	"encoding/json"
	"fmt"

	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"

	datamodelv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/datamodelv1"
	openshellv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/openshellv1"
	sandboxv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/sandboxv1"
)

// CreateSandboxRequest is the create-sandbox body. Policy is required by the
// gateway (SandboxSpec.policy) and is validated here before the gRPC call.
type CreateSandboxRequest struct {
	Labels      map[string]string `json:"labels,omitempty"`
	Annotations map[string]string `json:"annotations,omitempty"`
	Environment map[string]string `json:"environment,omitempty"`
	Name        string            `json:"name"`
	Image       string            `json:"image"`
	LogLevel    string            `json:"logLevel,omitempty"`
	CPU         string            `json:"cpu,omitempty"`
	Memory      string            `json:"memory,omitempty"`
	Providers   []string          `json:"providers,omitempty"`
	Policy      json.RawMessage   `json:"policy"`
	GpuCount    uint32            `json:"gpuCount,omitempty"`
}

// CreateProviderRequest is the create-provider body. Credentials are
// write-only: accepted here, forwarded to the gateway, never returned.
type CreateProviderRequest struct {
	Credentials map[string]string `json:"credentials,omitempty"`
	Config      map[string]string `json:"config,omitempty"`
	Labels      map[string]string `json:"labels,omitempty"`
	Name        string            `json:"name"`
	Type        string            `json:"type"`
}

// BuildSandboxSpec constructs the proto SandboxSpec from a create request,
// handling template, policy, resources, and providers.
func BuildSandboxSpec(req CreateSandboxRequest) (*openshellv1.SandboxSpec, error) {
	policy, err := ParsePolicy(req.Policy)
	if err != nil {
		return nil, fmt.Errorf("policy does not match the SandboxPolicy schema: %w", err)
	}

	template := &openshellv1.SandboxTemplate{Image: req.Image}
	if req.CPU != "" || req.Memory != "" {
		limits := map[string]any{}
		if req.CPU != "" {
			limits["cpu"] = req.CPU
		}
		if req.Memory != "" {
			limits["memory"] = req.Memory
		}
		resources, structErr := structpb.NewStruct(map[string]any{"limits": limits})
		if structErr != nil {
			return nil, fmt.Errorf("invalid cpu/memory values: %w", structErr)
		}
		template.Resources = resources
	}

	spec := &openshellv1.SandboxSpec{
		LogLevel:    req.LogLevel,
		Environment: req.Environment,
		Template:    template,
		Policy:      policy,
		Providers:   req.Providers,
	}
	if req.GpuCount > 0 {
		spec.ResourceRequirements = &openshellv1.ResourceRequirements{
			Gpu: &openshellv1.GpuResourceRequirements{Count: proto.Uint32(req.GpuCount)},
		}
	}
	return spec, nil
}

// ToProviderProto builds the proto Provider from a create request.
func ToProviderProto(req CreateProviderRequest) *datamodelv1.Provider {
	return &datamodelv1.Provider{
		Metadata: &datamodelv1.ObjectMeta{
			Name:   req.Name,
			Labels: req.Labels,
		},
		Type:        req.Type,
		Credentials: req.Credentials,
		Config:      req.Config,
	}
}

// ParseNetworkPolicyRule unmarshals protojson into a NetworkPolicyRule.
func ParseNetworkPolicyRule(raw json.RawMessage) (*sandboxv1.NetworkPolicyRule, error) {
	rule := &sandboxv1.NetworkPolicyRule{}
	if err := protojson.Unmarshal(raw, rule); err != nil {
		return nil, err
	}
	return rule, nil
}
