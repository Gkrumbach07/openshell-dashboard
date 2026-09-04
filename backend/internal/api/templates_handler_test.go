package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"
)

func TestListSandboxTemplates(t *testing.T) {
	gpu := uint32(1)
	sdk := &mockSDK{}
	sdk.templates.listFn = func(_ context.Context, _ string, _ ...openshell.ListOptions) ([]*openshell.SandboxWorkloadTemplate, error) {
		return []*openshell.SandboxWorkloadTemplate{
			{
				ID: "id-1", Name: "gpu-kata", Workspace: "default",
				CreatedAt: time.Unix(1700000000, 0),
				Spec: openshell.SandboxWorkloadTemplateSpec{
					Workload: &openshell.SandboxWorkloadConfig{
						Image:       "nvcr.io/nvidia/openshell:latest",
						Environment: map[string]string{"FOO": "bar"},
						Resources: &openshell.SandboxResources{
							CPU: "2", Memory: "8Gi",
							GPU: &openshell.SandboxGPURequirements{Count: &gpu},
						},
					},
				},
			},
		}, nil
	}
	app := newTestAppWithSDK(sdk)
	r := chi.NewRouter()
	r.Get("/workspaces/{workspace}/templates", app.ListSandboxTemplates)

	req := httptest.NewRequest(http.MethodGet, "/workspaces/default/templates", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", w.Code, w.Body.String())
	}
	var body []map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(body) != 1 {
		t.Fatalf("len = %d, want 1", len(body))
	}
	spec, _ := body[0]["spec"].(map[string]any)
	workload, _ := spec["workload"].(map[string]any)
	if workload["image"] != "nvcr.io/nvidia/openshell:latest" {
		t.Errorf("image = %v, want nvcr.io/nvidia/openshell:latest", workload["image"])
	}
}

func TestCreateSandboxTemplate(t *testing.T) {
	tests := []struct {
		name       string
		body       string
		wantStatus int
	}{
		{
			name:       "success",
			body:       `{"name":"claude-harness","spec":{"workload":{"image":"ghcr.io/nvidia/openshell-community/sandboxes/base:latest"}}}`,
			wantStatus: http.StatusCreated,
		},
		{
			name:       "invalid name",
			body:       `{"name":"Bad_Name","spec":{"workload":{"image":"base"}}}`,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "missing image",
			body:       `{"name":"no-image","spec":{"workload":{}}}`,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "missing workload",
			body:       `{"name":"no-workload","spec":{}}`,
			wantStatus: http.StatusBadRequest,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			sdk := &mockSDK{}
			app := newTestAppWithSDK(sdk)
			r := chi.NewRouter()
			r.Post("/workspaces/{workspace}/templates", app.CreateSandboxTemplate)

			req := httptest.NewRequest(http.MethodPost, "/workspaces/default/templates", strings.NewReader(tc.body))
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != tc.wantStatus {
				t.Errorf("status = %d, want %d; body: %s", w.Code, tc.wantStatus, w.Body.String())
			}
		})
	}
}

func TestCreateSandboxTemplatePassesWorkload(t *testing.T) {
	sdk := &mockSDK{}
	var gotImage string
	sdk.templates.createFn = func(_ context.Context, _ string, template *openshell.SandboxWorkloadTemplate) (*openshell.SandboxWorkloadTemplate, error) {
		if template.Spec.Workload != nil {
			gotImage = template.Spec.Workload.Image
		}
		return template, nil
	}
	app := newTestAppWithSDK(sdk)
	r := chi.NewRouter()
	r.Post("/workspaces/{workspace}/templates", app.CreateSandboxTemplate)

	body := `{"name":"codex-harness","spec":{"workload":{"image":"base","environment":{"HARNESS":"codex"},"resources":{"cpu":"1","memory":"2Gi"}}}}`
	req := httptest.NewRequest(http.MethodPost, "/workspaces/default/templates", strings.NewReader(body))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body: %s", w.Code, w.Body.String())
	}
	if gotImage != "base" {
		t.Errorf("template image = %q, want base", gotImage)
	}
}

func TestDeleteSandboxTemplate(t *testing.T) {
	sdk := &mockSDK{}
	sdk.templates.deleteFn = func(_ context.Context, _, name string) (bool, error) {
		if name != "gpu-kata" {
			t.Errorf("name = %q, want gpu-kata", name)
		}
		return true, nil
	}
	app := newTestAppWithSDK(sdk)
	r := chi.NewRouter()
	r.Delete("/workspaces/{workspace}/templates/{name}", app.DeleteSandboxTemplate)

	req := httptest.NewRequest(http.MethodDelete, "/workspaces/default/templates/gpu-kata", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", w.Code, w.Body.String())
	}
}

func TestCreateSandboxFromTemplate(t *testing.T) {
	const policy = `"policy":{"version":1,"filesystem":{"includeWorkdir":true}}`
	tests := []struct {
		name       string
		body       string
		wantStatus int
	}{
		{
			name:       "success",
			body:       `{"name":"agent-1","templateName":"claude-harness","providers":["claude"],` + policy + `}`,
			wantStatus: http.StatusCreated,
		},
		{
			name:       "missing template",
			body:       `{"name":"agent-1",` + policy + `}`,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "missing policy",
			body:       `{"name":"agent-1","templateName":"claude-harness"}`,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "invalid name",
			body:       `{"name":"Bad_Name","templateName":"claude-harness",` + policy + `}`,
			wantStatus: http.StatusBadRequest,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			sdk := &mockSDK{}
			var gotTemplate string
			sdk.templates.createFromTemplateFn = func(_ context.Context, _, name, templateName string, _ *openshell.SandboxSpec, _ map[string]string, _ ...openshell.CreateOptions) (*openshell.Sandbox, error) {
				gotTemplate = templateName
				return &openshell.Sandbox{Name: name}, nil
			}
			app := newTestAppWithSDK(sdk)
			r := chi.NewRouter()
			r.Post("/workspaces/{workspace}/sandboxes/from-template", app.CreateSandboxFromTemplate)

			req := httptest.NewRequest(http.MethodPost, "/workspaces/default/sandboxes/from-template", strings.NewReader(tc.body))
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d; body: %s", w.Code, tc.wantStatus, w.Body.String())
			}
			if tc.wantStatus == http.StatusCreated && gotTemplate != "claude-harness" {
				t.Errorf("templateName = %q, want claude-harness", gotTemplate)
			}
		})
	}
}
