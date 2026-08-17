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
	"github.com/NVIDIA/OpenShell/sdk/go/openshell/v1/types"
)

func TestGetSandboxLogs(t *testing.T) {
	sdk := &mockSDK{}
	sdk.sandboxes.getLogsFn = func(_ context.Context, workspace, name string, opts ...openshell.LogOption) (*openshell.LogResult, error) {
		if workspace != "default" || name != "my-sandbox" {
			t.Errorf("GetLogs(%s, %s), want (default, my-sandbox)", workspace, name)
		}
		cfg := types.ApplyLogOptions(opts)
		if cfg.Lines() != 50 {
			t.Errorf("lines = %d, want 50", cfg.Lines())
		}
		if !cfg.Since().Equal(time.UnixMilli(1000)) {
			t.Errorf("since = %v, want unix milli 1000", cfg.Since())
		}
		if got := cfg.Sources(); len(got) != 2 {
			t.Errorf("sources = %v, want [gateway sandbox]", got)
		}
		if cfg.MinLevel() != "INFO" {
			t.Errorf("minLevel = %q, want INFO", cfg.MinLevel())
		}
		return &openshell.LogResult{
			Lines:       []openshell.LogLine{{Message: "hello", Level: "INFO", Timestamp: time.UnixMilli(1234)}},
			BufferTotal: 100,
		}, nil
	}
	app := newTestAppWithSDK(sdk)
	r := chi.NewRouter()
	r.Get("/workspaces/{workspace}/sandboxes/{name}/logs", app.GetSandboxLogs)
	req := httptest.NewRequest(http.MethodGet, "/workspaces/default/sandboxes/my-sandbox/logs?lines=50&sinceMs=1000&source=gateway&source=sandbox&level=INFO", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d; body: %s", w.Code, w.Body.String())
	}
	var body map[string]any
	_ = json.NewDecoder(w.Body).Decode(&body)
	if body["bufferTotal"] != float64(100) {
		t.Errorf("bufferTotal = %v", body["bufferTotal"])
	}
	logs, _ := body["logs"].([]any)
	if len(logs) != 1 {
		t.Fatalf("got %d logs, want 1", len(logs))
	}
}

func TestGetSandboxLogsDefaults(t *testing.T) {
	sdk := &mockSDK{}
	sdk.sandboxes.getLogsFn = func(_ context.Context, _, _ string, opts ...openshell.LogOption) (*openshell.LogResult, error) {
		cfg := types.ApplyLogOptions(opts)
		if cfg.Lines() != 200 {
			t.Errorf("default lines = %d, want 200", cfg.Lines())
		}
		return &openshell.LogResult{}, nil
	}
	app := newTestAppWithSDK(sdk)
	r := chi.NewRouter()
	r.Get("/workspaces/{workspace}/sandboxes/{name}/logs", app.GetSandboxLogs)
	req := httptest.NewRequest(http.MethodGet, "/workspaces/default/sandboxes/my-sandbox/logs?lines=notanumber", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d", w.Code)
	}
}

func TestGetSandboxLogsNotFound(t *testing.T) {
	sdk := &mockSDK{}
	sdk.sandboxes.getLogsFn = func(_ context.Context, _, _ string, _ ...openshell.LogOption) (*openshell.LogResult, error) {
		return nil, &openshell.StatusError{Code: openshell.ErrorNotFound, Message: "sandbox not found"}
	}
	app := newTestAppWithSDK(sdk)
	r := chi.NewRouter()
	r.Get("/workspaces/{workspace}/sandboxes/{name}/logs", app.GetSandboxLogs)
	req := httptest.NewRequest(http.MethodGet, "/workspaces/default/sandboxes/missing/logs", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", w.Code)
	}
}

func TestListSandboxProviders(t *testing.T) {
	sdk := &mockSDK{}
	sdk.sandboxes.listProvidersFn = func(_ context.Context, _, _ string) ([]*openshell.Provider, error) {
		return []*openshell.Provider{
			{
				Name: "claude-prov",
				Type: "claude",
				Spec: openshell.ProviderSpec{
					CredentialHandles: map[string]types.CredentialHandle{
						"api_key": {Driver: "vault", Handle: "vault://must-not-leak"},
					},
				},
			},
		}, nil
	}
	app := newTestAppWithSDK(sdk)
	r := chi.NewRouter()
	r.Get("/workspaces/{workspace}/sandboxes/{name}/providers", app.ListSandboxProviders)

	req := httptest.NewRequest(http.MethodGet, "/workspaces/default/sandboxes/my-sandbox/providers", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", w.Code, w.Body.String())
	}
	body := w.Body.String()
	if strings.Contains(body, "must-not-leak") {
		t.Errorf("leaked credential handle: %s", body)
	}
	var got []map[string]any
	if err := json.Unmarshal([]byte(body), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d providers, want 1", len(got))
	}
	names, _ := got[0]["credentialNames"].([]any)
	if len(names) != 1 || names[0] != "api_key" {
		t.Errorf("credentialNames = %v, want [api_key]", got[0]["credentialNames"])
	}
}

func TestAttachDetachSandboxProvider(t *testing.T) {
	sdk := &mockSDK{}
	sdk.sandboxes.attachFn = func(_ context.Context, workspace, sandboxName, providerName string, expectedRV uint64) (*openshell.AttachProviderResult, error) {
		if workspace != "default" || sandboxName != "my-sandbox" || providerName != "claude-prov" {
			t.Errorf("attach args = %s/%s/%s", workspace, sandboxName, providerName)
		}
		if expectedRV != 42 {
			t.Errorf("expectedResourceVersion = %d, want 42", expectedRV)
		}
		return &openshell.AttachProviderResult{Attached: true, Sandbox: &openshell.Sandbox{Name: sandboxName}}, nil
	}
	sdk.sandboxes.detachFn = func(_ context.Context, _, sandboxName, _ string, _ uint64) (*openshell.DetachProviderResult, error) {
		return &openshell.DetachProviderResult{Detached: true, Sandbox: &openshell.Sandbox{Name: sandboxName}}, nil
	}
	app := newTestAppWithSDK(sdk)
	r := chi.NewRouter()
	r.Post("/workspaces/{workspace}/sandboxes/{name}/providers/{provider}", app.AttachSandboxProvider)
	r.Delete("/workspaces/{workspace}/sandboxes/{name}/providers/{provider}", app.DetachSandboxProvider)

	req := httptest.NewRequest(http.MethodPost, "/workspaces/default/sandboxes/my-sandbox/providers/claude-prov", strings.NewReader(`{"expectedResourceVersion":42}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("attach status = %d, want 200; body: %s", w.Code, w.Body.String())
	}
	var attach map[string]any
	if err := json.NewDecoder(w.Body).Decode(&attach); err != nil {
		t.Fatalf("decode attach: %v", err)
	}
	if attach["attached"] != true {
		t.Errorf("attached = %v", attach["attached"])
	}

	req = httptest.NewRequest(http.MethodDelete, "/workspaces/default/sandboxes/my-sandbox/providers/claude-prov", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("detach status = %d, want 200; body: %s", w.Code, w.Body.String())
	}
}
