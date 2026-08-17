package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"
)

func TestGetSandboxPolicy(t *testing.T) {
	sdk := &mockSDK{}
	sdk.policy.getStatusFn = func(_ context.Context, _, _ string, _ ...openshell.GetStatusOption) (*openshell.PolicyStatusResult, error) {
		return &openshell.PolicyStatusResult{
			ActiveVersion: 2,
			Revision: openshell.SandboxPolicyRevision{
				Version:    2,
				PolicyHash: "abc123",
				Status:     openshell.PolicyLoadStatusLoaded,
			},
		}, nil
	}
	app := newTestAppWithSDK(sdk)
	r := chi.NewRouter()
	r.Get("/workspaces/{workspace}/sandboxes/{name}/policy", app.GetSandboxPolicy)
	req := httptest.NewRequest(http.MethodGet, "/workspaces/default/sandboxes/my-sandbox/policy", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d; body: %s", w.Code, w.Body.String())
	}
	var body map[string]any
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["activeVersion"] != float64(2) {
		t.Errorf("activeVersion = %v, want 2", body["activeVersion"])
	}
	revisions, _ := body["revisions"].([]any)
	if len(revisions) != 1 {
		t.Errorf("got %d revisions, want 1 (latest only)", len(revisions))
	}
}

func TestGetSandboxPolicyNotFound(t *testing.T) {
	sdk := &mockSDK{}
	sdk.policy.getStatusFn = func(_ context.Context, _, _ string, _ ...openshell.GetStatusOption) (*openshell.PolicyStatusResult, error) {
		return nil, &openshell.StatusError{Code: openshell.ErrorNotFound, Message: "sandbox not found"}
	}
	app := newTestAppWithSDK(sdk)
	r := chi.NewRouter()
	r.Get("/workspaces/{workspace}/sandboxes/{name}/policy", app.GetSandboxPolicy)
	req := httptest.NewRequest(http.MethodGet, "/workspaces/default/sandboxes/missing/policy", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", w.Code)
	}
}

func TestUpdateSandboxPolicy(t *testing.T) {
	tests := []struct {
		name       string
		body       string
		wantStatus int
	}{
		{name: "success", body: `{"policy":{"version":1}}`, wantStatus: http.StatusOK},
		{name: "missing policy", body: `{}`, wantStatus: http.StatusBadRequest},
		{name: "invalid json", body: `not-json`, wantStatus: http.StatusBadRequest},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			app := newTestAppWithSDK(&mockSDK{})
			r := chi.NewRouter()
			r.Put("/workspaces/{workspace}/sandboxes/{name}/policy", app.UpdateSandboxPolicy)
			req := httptest.NewRequest(http.MethodPut, "/workspaces/default/sandboxes/my-sandbox/policy", strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			if w.Code != tc.wantStatus {
				t.Errorf("status = %d, want %d; body: %s", w.Code, tc.wantStatus, w.Body.String())
			}
		})
	}
}

func TestSetGlobalPolicy(t *testing.T) {
	app := newTestAppWithSDK(&mockSDK{})
	r := chi.NewRouter()
	r.Put("/global-policy", app.SetGlobalPolicy)
	req := httptest.NewRequest(http.MethodPut, "/global-policy", strings.NewReader(`{"policy":{"version":1}}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d; body: %s", w.Code, w.Body.String())
	}
}

func TestDeleteGlobalPolicy(t *testing.T) {
	app := newTestAppWithSDK(&mockSDK{})
	req := httptest.NewRequest(http.MethodDelete, "/global-policy", nil)
	w := httptest.NewRecorder()
	app.DeleteGlobalPolicy(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d", w.Code)
	}
}

func TestGetDraftPolicy(t *testing.T) {
	sdk := &mockSDK{}
	sdk.policy.getDraftFn = func(_ context.Context, _, _ string, _ ...openshell.GetDraftOption) (*openshell.DraftPolicy, error) {
		return &openshell.DraftPolicy{
			DraftVersion: 3,
			Chunks: []openshell.PolicyChunk{
				{ID: "c1", Status: "pending", RuleName: "allow-api"},
			},
		}, nil
	}
	app := newTestAppWithSDK(sdk)
	r := chi.NewRouter()
	r.Get("/workspaces/{workspace}/sandboxes/{name}/drafts", app.GetDraftPolicy)
	req := httptest.NewRequest(http.MethodGet, "/workspaces/default/sandboxes/my-sandbox/drafts", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d; body: %s", w.Code, w.Body.String())
	}
	var body map[string]any
	_ = json.NewDecoder(w.Body).Decode(&body)
	if body["draftVersion"] != float64(3) {
		t.Errorf("draftVersion = %v", body["draftVersion"])
	}
}

func TestApproveDraftChunk(t *testing.T) {
	app := newTestAppWithSDK(&mockSDK{})
	r := chi.NewRouter()
	r.Post("/workspaces/{workspace}/sandboxes/{name}/drafts/{chunk}/approve", app.ApproveDraftChunk)
	req := httptest.NewRequest(http.MethodPost, "/workspaces/default/sandboxes/my-sandbox/drafts/c1/approve", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d", w.Code)
	}
}

func TestRejectDraftChunk(t *testing.T) {
	app := newTestAppWithSDK(&mockSDK{})
	r := chi.NewRouter()
	r.Post("/workspaces/{workspace}/sandboxes/{name}/drafts/{chunk}/reject", app.RejectDraftChunk)
	req := httptest.NewRequest(http.MethodPost, "/workspaces/default/sandboxes/my-sandbox/drafts/c1/reject", strings.NewReader(`{"reason":"nope"}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d", w.Code)
	}
}

func TestApproveAllDraftChunks(t *testing.T) {
	sdk := &mockSDK{}
	sdk.policy.approveAllFn = func(_ context.Context, _, _ string, _ ...openshell.ApproveAllOption) (*openshell.ApproveAllResult, error) {
		return &openshell.ApproveAllResult{PolicyVersion: 4, ChunksApproved: 2, ChunksSkipped: 1}, nil
	}
	app := newTestAppWithSDK(sdk)
	r := chi.NewRouter()
	r.Post("/workspaces/{workspace}/sandboxes/{name}/drafts/approve-all", app.ApproveAllDraftChunks)
	req := httptest.NewRequest(http.MethodPost, "/workspaces/default/sandboxes/my-sandbox/drafts/approve-all", strings.NewReader(`{"includeSecurityFlagged":true}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d; body: %s", w.Code, w.Body.String())
	}
	var body map[string]any
	_ = json.NewDecoder(w.Body).Decode(&body)
	if body["chunksApproved"] != float64(2) {
		t.Errorf("chunksApproved = %v", body["chunksApproved"])
	}
}

func TestEditDraftChunk(t *testing.T) {
	app := newTestAppWithSDK(&mockSDK{})
	r := chi.NewRouter()
	r.Put("/workspaces/{workspace}/sandboxes/{name}/drafts/{chunk}", app.EditDraftChunk)
	req := httptest.NewRequest(http.MethodPut, "/workspaces/default/sandboxes/my-sandbox/drafts/c1", strings.NewReader(`{"proposedRule":{"name":"allow-api"}}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d; body: %s", w.Code, w.Body.String())
	}
}

func TestUndoDraftChunk(t *testing.T) {
	app := newTestAppWithSDK(&mockSDK{})
	r := chi.NewRouter()
	r.Post("/workspaces/{workspace}/sandboxes/{name}/drafts/{chunk}/undo", app.UndoDraftChunk)
	req := httptest.NewRequest(http.MethodPost, "/workspaces/default/sandboxes/my-sandbox/drafts/c1/undo", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d", w.Code)
	}
}

func TestClearDraftChunks(t *testing.T) {
	sdk := &mockSDK{}
	sdk.policy.clearFn = func(_ context.Context, _, _ string) (*openshell.ClearResult, error) {
		return &openshell.ClearResult{ChunksCleared: 3}, nil
	}
	app := newTestAppWithSDK(sdk)
	r := chi.NewRouter()
	r.Post("/workspaces/{workspace}/sandboxes/{name}/drafts/clear", app.ClearDraftChunks)
	req := httptest.NewRequest(http.MethodPost, "/workspaces/default/sandboxes/my-sandbox/drafts/clear", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d", w.Code)
	}
}

func TestGetDraftHistory(t *testing.T) {
	sdk := &mockSDK{}
	sdk.policy.historyFn = func(_ context.Context, _, _ string) ([]openshell.DraftHistoryEntry, error) {
		return []openshell.DraftHistoryEntry{{EventType: "approved", ChunkID: "c1"}}, nil
	}
	app := newTestAppWithSDK(sdk)
	r := chi.NewRouter()
	r.Get("/workspaces/{workspace}/sandboxes/{name}/drafts/history", app.GetDraftHistory)
	req := httptest.NewRequest(http.MethodGet, "/workspaces/default/sandboxes/my-sandbox/drafts/history", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d", w.Code)
	}
}

func TestGetDraftSummary(t *testing.T) {
	app := newTestAppWithSDK(&mockSDK{})
	req := httptest.NewRequest(http.MethodGet, "/draft-summary", nil)
	w := httptest.NewRecorder()
	app.GetDraftSummary(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d", w.Code)
	}
}
