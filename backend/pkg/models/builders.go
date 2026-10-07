package models

import "encoding/json"

// ServiceExposure mirrors openshell.v1.SandboxServiceExposure: a loopback HTTP
// service of the sandbox to expose as the sandbox is created. An empty Service
// is the sandbox's unnamed service, which is the one `openshell sandbox create
// --expose <port>` registers.
type ServiceExposure struct {
	Service    string `json:"service"`
	TargetPort uint32 `json:"targetPort"`
}

// CreateSandboxRequest is the create-sandbox body. Policy is required and is
// validated in BuildSDKSandboxSpec before the SDK call. Gateway 0.1.2 accepts
// a create that has none, but on the compat stack such a sandbox never
// becomes ready: its configuration is rejected ("Effective configuration
// could not be activated; replace the policy or repair attached providers").
//
// Image is optional. Without one the gateway runs its own default image, as
// it does for `openshell sandbox create` without --from, and the sandbox it
// returns names the image it chose.
//
// Command is SandboxSpec.command, the argv of the sandbox's main process: it
// is launched once and no shell parses it. Without one the sandbox runs its
// image's login shell. TTY is SandboxSpec.tty; the gateway sets it by itself
// for a sandbox without a command.
//
// RuntimeClassName and DriverConfig are fields of the sandbox's inline
// template. RuntimeClassName is for the Kubernetes compute driver; the Docker
// and VM drivers refuse a sandbox that names one. DriverConfig is a JSON
// object keyed by compute driver name, and the gateway refuses it unless its
// administrator enabled allow_driver_config.
//
// ServiceExposures are registered with the sandbox by the same request. A
// service the gateway cannot expose fails the create, and the gateway deletes
// the sandbox it had just made.
type CreateSandboxRequest struct {
	Labels           map[string]string `json:"labels,omitempty"`
	Annotations      map[string]string `json:"annotations,omitempty"`
	Environment      map[string]string `json:"environment,omitempty"`
	DriverConfig     map[string]any    `json:"driverConfig,omitempty"`
	Name             string            `json:"name"`
	Image            string            `json:"image"`
	LogLevel         string            `json:"logLevel,omitempty"`
	CPU              string            `json:"cpu,omitempty"`
	Memory           string            `json:"memory,omitempty"`
	RuntimeClassName string            `json:"runtimeClassName,omitempty"`
	Providers        []string          `json:"providers,omitempty"`
	Command          []string          `json:"command,omitempty"`
	ServiceExposures []ServiceExposure `json:"serviceExposures,omitempty"`
	Policy           json.RawMessage   `json:"policy"`
	GpuCount         uint32            `json:"gpuCount,omitempty"`
	TTY              bool              `json:"tty,omitempty"`
}

// CreateSandboxTemplateRequest is the create-template body for a reusable
// workspace-scoped workload template. The gateway requires the workload and
// not its image: a template without one stands for the gateway's default
// image, resolved when a sandbox is created from it.
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
//
// Command, TTY and ServiceExposures mean what they mean on
// CreateSandboxRequest. They are not part of a template, so the gateway takes
// them beside one.
type CreateSandboxFromTemplateRequest struct {
	Labels           map[string]string `json:"labels,omitempty"`
	Annotations      map[string]string `json:"annotations,omitempty"`
	Name             string            `json:"name"`
	TemplateName     string            `json:"templateName"`
	Providers        []string          `json:"providers,omitempty"`
	Command          []string          `json:"command,omitempty"`
	ServiceExposures []ServiceExposure `json:"serviceExposures,omitempty"`
	Policy           json.RawMessage   `json:"policy"`
	TTY              bool              `json:"tty,omitempty"`
}

// CreateProviderRequest is the create-provider body. It mirrors the gateway's
// Provider message and is forwarded as it is: the BFF translates nothing.
//
// Credentials are write-only: accepted here, forwarded to the gateway, never
// returned. Their keys are the gateway's stored keys — a profile credential's
// env var names when it declares any, its name only when it declares none.
//
// ProfileWorkspace is Provider.profile_workspace, the scope the gateway looks
// Type up in. Empty is the platform scope, which holds the built-in and the
// platform profiles and where a profile imported into a workspace does not
// exist; the provider's own workspace resolves the profile that workspace
// sees. The gateway rejects any other value. The Add Provider form names the
// scope of the profile that was chosen.
type CreateProviderRequest struct {
	Credentials      map[string]string `json:"credentials,omitempty"`
	Config           map[string]string `json:"config,omitempty"`
	Labels           map[string]string `json:"labels,omitempty"`
	Name             string            `json:"name"`
	Type             string            `json:"type"`
	ProfileWorkspace string            `json:"profileWorkspace,omitempty"`
}
