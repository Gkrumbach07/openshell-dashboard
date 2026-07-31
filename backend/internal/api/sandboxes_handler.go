package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	openshell "github.com/rhuss/openshell-sdk-go/openshell/v1"

	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/models"
)

// CreateSandboxRequest is the create-sandbox body. Policy is required by the
// gateway (SandboxSpec.policy) and is validated here before the gRPC call.
type CreateSandboxRequest struct {
	Name        string            `json:"name"`
	Labels      map[string]string `json:"labels,omitempty"`
	Annotations map[string]string `json:"annotations,omitempty"`
	Image       string            `json:"image"`
	LogLevel    string            `json:"logLevel,omitempty"`
	Environment map[string]string `json:"environment,omitempty"`
	Providers   []string          `json:"providers,omitempty"`
	// GpuCount requests GPUs via ResourceRequirements.gpu. 0 means no GPU.
	GpuCount uint32 `json:"gpuCount,omitempty"`
	// Cpu / Memory are K8s-style quantities ("2", "500m", "4Gi") placed in
	// template.resources as {"limits": {...}} — the same shape the CLI sends.
	Cpu    string `json:"cpu,omitempty"`
	Memory string `json:"memory,omitempty"`
	// Policy is a protojson-encoded openshell.sandbox.v1.SandboxPolicy.
	Policy json.RawMessage `json:"policy"`
}

func (app *App) ListSandboxes(w http.ResponseWriter, r *http.Request) {
	var opts []openshell.ListOptions
	if sel := r.URL.Query().Get("labelSelector"); sel != "" {
		opts = append(opts, openshell.ListOptions{LabelSelector: sel})
	}
	sandboxes, err := app.client.Sandboxes().List(r.Context(), chi.URLParam(r, "workspace"), opts...)
	if err != nil {
		writeSDKError(w, err)
		return
	}
	out := make([]models.Sandbox, 0, len(sandboxes))
	for _, sandbox := range sandboxes {
		out = append(out, models.FromSandbox(sandbox))
	}
	writeJSON(w, http.StatusOK, out)
}

func (app *App) CreateSandbox(w http.ResponseWriter, r *http.Request) {
	var body CreateSandboxRequest
	if !decodeBody(w, r, &body) {
		return
	}
	if body.Name != "" && !validDNS1123(body.Name) {
		writeError(w, http.StatusBadRequest, "invalid_name", "sandbox name must be a valid DNS-1123 label")
		return
	}
	if body.Image == "" {
		writeError(w, http.StatusBadRequest, "invalid_image", "image is required")
		return
	}
	if len(body.Policy) == 0 {
		writeError(w, http.StatusBadRequest, "invalid_policy", "policy is required — SandboxSpec.policy is a required field")
		return
	}
	policy, err := models.ParsePolicy(body.Policy)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_policy", "policy does not match the SandboxPolicy schema: "+err.Error())
		return
	}

	spec := &openshell.SandboxSpec{
		LogLevel:    body.LogLevel,
		Environment: body.Environment,
		Template:    &openshell.SandboxTemplate{Image: body.Image},
		Policy:      policy,
		Providers:   body.Providers,
	}
	if body.GpuCount > 0 {
		gpu := body.GpuCount
		spec.GPUCount = &gpu
	}
	sandbox, err := app.client.Sandboxes().Create(r.Context(), chi.URLParam(r, "workspace"), body.Name, spec, body.Labels)
	if err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, models.FromSandbox(sandbox))
}

func (app *App) GetSandbox(w http.ResponseWriter, r *http.Request) {
	sandbox, err := app.client.Sandboxes().Get(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"))
	if err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.FromSandbox(sandbox))
}

func (app *App) DeleteSandbox(w http.ResponseWriter, r *http.Request) {
	if err := app.client.Sandboxes().Delete(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name")); err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}
