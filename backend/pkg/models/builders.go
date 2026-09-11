package models

import "encoding/json"

// CreateSandboxRequest is the create-sandbox body. Policy is required by the
// gateway (SandboxSpec.policy) and is validated in BuildSDKSandboxSpec before
// the SDK call.
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

// CreateSandboxTemplateRequest is the create-template body for a reusable
// workspace-scoped workload template. The workload image is required.
type CreateSandboxTemplateRequest struct {
	Labels      map[string]string   `json:"labels,omitempty"`
	Annotations map[string]string   `json:"annotations,omitempty"`
	Spec        SandboxTemplateSpec `json:"spec"`
	Name        string              `json:"name"`
}

// CreateSandboxFromTemplateRequest is the create-sandbox-from-template body.
// Only governance fields are accepted alongside the template reference — the
// workload (image, environment, resources) comes from the named template.
// Policy is required by the gateway (SandboxSpec.policy).
type CreateSandboxFromTemplateRequest struct {
	Labels       map[string]string `json:"labels,omitempty"`
	Annotations  map[string]string `json:"annotations,omitempty"`
	Name         string            `json:"name"`
	TemplateName string            `json:"templateName"`
	Providers    []string          `json:"providers,omitempty"`
	Policy       json.RawMessage   `json:"policy"`
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
