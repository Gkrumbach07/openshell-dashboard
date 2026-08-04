package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"

	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/models"

	openshellv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/openshellv1"
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

func (app *App) ListSandboxes(w http.ResponseWriter, r *http.Request) {
	sandboxes, err := app.gateway.ListSandboxes(r.Context(), chi.URLParam(r, "workspace"), 0, 0, r.URL.Query().Get("labelSelector"))
	if err != nil {
		writeGrpcError(w, err)
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

	template := &openshellv1.SandboxTemplate{Image: body.Image}
	if body.CPU != "" || body.Memory != "" {
		limits := map[string]any{}
		if body.CPU != "" {
			limits["cpu"] = body.CPU
		}
		if body.Memory != "" {
			limits["memory"] = body.Memory
		}
		var resources *structpb.Struct
		resources, err = structpb.NewStruct(map[string]any{"limits": limits})
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_resources", "invalid cpu/memory values")
			return
		}
		template.Resources = resources
	}

	spec := &openshellv1.SandboxSpec{
		LogLevel:    body.LogLevel,
		Environment: body.Environment,
		Template:    template,
		Policy:      policy,
		Providers:   body.Providers,
	}
	if body.GpuCount > 0 {
		spec.ResourceRequirements = &openshellv1.ResourceRequirements{
			Gpu: &openshellv1.GpuResourceRequirements{Count: proto.Uint32(body.GpuCount)},
		}
	}
	sandbox, err := app.gateway.CreateSandbox(r.Context(), chi.URLParam(r, "workspace"), body.Name, spec, body.Labels, body.Annotations)
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, models.FromSandbox(sandbox))
}

func (app *App) GetSandbox(w http.ResponseWriter, r *http.Request) {
	sandbox, err := app.gateway.GetSandbox(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"))
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.FromSandbox(sandbox))
}

func (app *App) DeleteSandbox(w http.ResponseWriter, r *http.Request) {
	deleted, err := app.gateway.DeleteSandbox(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"))
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": deleted})
}
