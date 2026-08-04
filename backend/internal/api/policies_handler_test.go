package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	openshellv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/openshellv1"
	sandboxv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/sandboxv1"
)

func TestGetSandboxPolicy(t *testing.T) {
	tests := []struct {
		statusFn   func(ctx context.Context, workspace, name string, version uint32, global bool) (*openshellv1.GetSandboxPolicyStatusResponse, error)
		listFn     func(ctx context.Context, workspace, name string, limit, offset uint32, global bool) (*openshellv1.ListSandboxPoliciesResponse, error)
		name       string
		wantStatus int
	}{
		{
			name: "success with latest and revisions",
			statusFn: func(_ context.Context, _, _ string, _ uint32, _ bool) (*openshellv1.GetSandboxPolicyStatusResponse, error) {
				return &openshellv1.GetSandboxPolicyStatusResponse{
					ActiveVersion: 2,
					Revision: &openshellv1.SandboxPolicyRevision{
						Version:    2,
						PolicyHash: "abc123",
						Status:     openshellv1.PolicyStatus_POLICY_STATUS_LOADED,
					},
				}, nil
			},
			listFn: func(_ context.Context, _, _ string, _, _ uint32, _ bool) (*openshellv1.ListSandboxPoliciesResponse, error) {
				return &openshellv1.ListSandboxPoliciesResponse{
					Revisions: []*openshellv1.SandboxPolicyRevision{
						{Version: 2, Status: openshellv1.PolicyStatus_POLICY_STATUS_LOADED},
						{Version: 1, Status: openshellv1.PolicyStatus_POLICY_STATUS_SUPERSEDED},
					},
				}, nil
			},
			wantStatus: http.StatusOK,
		},
		{
			name: "not found",
			statusFn: func(_ context.Context, _, _ string, _ uint32, _ bool) (*openshellv1.GetSandboxPolicyStatusResponse, error) {
				return nil, status.Error(codes.NotFound, "sandbox not found")
			},
			wantStatus: http.StatusNotFound,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			app := newTestApp(&mockGateway{
				getSandboxPolicyStatusFn: tc.statusFn,
				listSandboxPoliciesFn:    tc.listFn,
			})
			r := chi.NewRouter()
			r.Get("/workspaces/{workspace}/sandboxes/{name}/policy", app.GetSandboxPolicy)

			req := httptest.NewRequest(http.MethodGet, "/workspaces/default/sandboxes/my-sandbox/policy", nil)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != tc.wantStatus {
				t.Errorf("status = %d, want %d", w.Code, tc.wantStatus)
			}
		})
	}
}

func TestGetSandboxPolicyBody(t *testing.T) {
	app := newTestApp(&mockGateway{
		getSandboxPolicyStatusFn: func(_ context.Context, _, _ string, _ uint32, _ bool) (*openshellv1.GetSandboxPolicyStatusResponse, error) {
			return &openshellv1.GetSandboxPolicyStatusResponse{
				ActiveVersion: 3,
				Revision: &openshellv1.SandboxPolicyRevision{
					Version:    3,
					PolicyHash: "hash3",
					Status:     openshellv1.PolicyStatus_POLICY_STATUS_LOADED,
				},
			}, nil
		},
		listSandboxPoliciesFn: func(_ context.Context, _, _ string, _, _ uint32, _ bool) (*openshellv1.ListSandboxPoliciesResponse, error) {
			return &openshellv1.ListSandboxPoliciesResponse{
				Revisions: []*openshellv1.SandboxPolicyRevision{
					{Version: 3, Status: openshellv1.PolicyStatus_POLICY_STATUS_LOADED},
				},
			}, nil
		},
	})
	r := chi.NewRouter()
	r.Get("/workspaces/{workspace}/sandboxes/{name}/policy", app.GetSandboxPolicy)

	req := httptest.NewRequest(http.MethodGet, "/workspaces/default/sandboxes/my-sandbox/policy", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}

	var body map[string]any
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if v, ok := body["activeVersion"].(float64); !ok || v != 3 {
		t.Errorf("activeVersion = %v, want 3", body["activeVersion"])
	}
	latest, ok := body["latest"].(map[string]any)
	if !ok {
		t.Fatal("latest is not a map")
	}
	if latest["policyHash"] != "hash3" {
		t.Errorf("policyHash = %v, want hash3", latest["policyHash"])
	}
}

func TestUpdateSandboxPolicy(t *testing.T) {
	tests := []struct {
		mockFn     func(ctx context.Context, workspace, name string, policy *sandboxv1.SandboxPolicy, expectedResourceVersion uint64) (*openshellv1.UpdateConfigResponse, error)
		name       string
		body       string
		wantCode   string
		wantStatus int
	}{
		{
			name: "success",
			body: `{"policy":{"version":1,"networkPolicies":{"test":{"endpoints":[{"host":"example.com","port":443}]}}},"expectedResourceVersion":5}`,
			mockFn: func(_ context.Context, _, _ string, _ *sandboxv1.SandboxPolicy, _ uint64) (*openshellv1.UpdateConfigResponse, error) {
				return &openshellv1.UpdateConfigResponse{Version: 2, PolicyHash: "newhash"}, nil
			},
			wantStatus: http.StatusOK,
		},
		{
			name:       "missing policy",
			body:       `{"expectedResourceVersion":5}`,
			wantStatus: http.StatusBadRequest,
			wantCode:   "invalid_policy",
		},
		{
			name:       "invalid policy schema",
			body:       `{"policy":{"notAField":true}}`,
			wantStatus: http.StatusBadRequest,
			wantCode:   "invalid_policy",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			app := newTestApp(&mockGateway{updateSandboxPolicyFn: tc.mockFn})
			r := chi.NewRouter()
			r.Put("/workspaces/{workspace}/sandboxes/{name}/policy", app.UpdateSandboxPolicy)

			req := httptest.NewRequest(http.MethodPut, "/workspaces/default/sandboxes/my-sandbox/policy", strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != tc.wantStatus {
				t.Errorf("status = %d, want %d; body: %s", w.Code, tc.wantStatus, w.Body.String())
			}
			if tc.wantCode != "" {
				var errResp ErrorResponse
				if err := json.NewDecoder(w.Body).Decode(&errResp); err != nil {
					t.Fatalf("decode: %v", err)
				}
				if errResp.Code != tc.wantCode {
					t.Errorf("code = %q, want %q", errResp.Code, tc.wantCode)
				}
			}
		})
	}
}

func TestSetGlobalPolicy(t *testing.T) {
	tests := []struct {
		mockFn     func(ctx context.Context, policy *sandboxv1.SandboxPolicy) (*openshellv1.UpdateConfigResponse, error)
		name       string
		body       string
		wantStatus int
	}{
		{
			name: "success",
			body: `{"policy":{"version":1,"filesystem":{"includeWorkdir":true}}}`,
			mockFn: func(_ context.Context, _ *sandboxv1.SandboxPolicy) (*openshellv1.UpdateConfigResponse, error) {
				return &openshellv1.UpdateConfigResponse{Version: 1, PolicyHash: "globalhash"}, nil
			},
			wantStatus: http.StatusOK,
		},
		{
			name:       "missing policy",
			body:       `{}`,
			wantStatus: http.StatusBadRequest,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			app := newTestApp(&mockGateway{setGlobalPolicyFn: tc.mockFn})
			r := chi.NewRouter()
			r.Put("/global-policy", app.SetGlobalPolicy)

			req := httptest.NewRequest(http.MethodPut, "/global-policy", strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != tc.wantStatus {
				t.Errorf("status = %d, want %d; body: %s", w.Code, tc.wantStatus, w.Body.String())
			}
		})
	}
}

func TestDeleteGlobalPolicy(t *testing.T) {
	tests := []struct {
		mockFn     func(ctx context.Context) error
		name       string
		wantStatus int
	}{
		{
			name: "success",
			mockFn: func(_ context.Context) error {
				return nil
			},
			wantStatus: http.StatusOK,
		},
		{
			name: "gateway error",
			mockFn: func(_ context.Context) error {
				return status.Error(codes.PermissionDenied, "not an admin")
			},
			wantStatus: http.StatusForbidden,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			app := newTestApp(&mockGateway{deleteGlobalPolicyFn: tc.mockFn})
			r := chi.NewRouter()
			r.Delete("/global-policy", app.DeleteGlobalPolicy)

			req := httptest.NewRequest(http.MethodDelete, "/global-policy", nil)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != tc.wantStatus {
				t.Errorf("status = %d, want %d", w.Code, tc.wantStatus)
			}
		})
	}
}

func TestGetDraftPolicy(t *testing.T) {
	tests := []struct {
		mockFn     func(ctx context.Context, workspace, name, statusFilter string) (*openshellv1.GetDraftPolicyResponse, error)
		name       string
		url        string
		wantStatus int
	}{
		{
			name: "success without filter",
			url:  "/workspaces/default/sandboxes/my-sandbox/drafts",
			mockFn: func(_ context.Context, _, _, _ string) (*openshellv1.GetDraftPolicyResponse, error) {
				return &openshellv1.GetDraftPolicyResponse{
					DraftVersion: 1,
					Chunks: []*openshellv1.PolicyChunk{
						{Id: "chunk-1", Status: "pending", RuleName: "rule-a"},
					},
				}, nil
			},
			wantStatus: http.StatusOK,
		},
		{
			name: "with status filter",
			url:  "/workspaces/default/sandboxes/my-sandbox/drafts?status=pending",
			mockFn: func(_ context.Context, _, _, filter string) (*openshellv1.GetDraftPolicyResponse, error) {
				if filter != "pending" {
					return nil, status.Error(codes.InvalidArgument, "unexpected filter")
				}
				return &openshellv1.GetDraftPolicyResponse{DraftVersion: 1}, nil
			},
			wantStatus: http.StatusOK,
		},
		{
			name: "not found",
			url:  "/workspaces/default/sandboxes/missing/drafts",
			mockFn: func(_ context.Context, _, _, _ string) (*openshellv1.GetDraftPolicyResponse, error) {
				return nil, status.Error(codes.NotFound, "sandbox not found")
			},
			wantStatus: http.StatusNotFound,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			app := newTestApp(&mockGateway{getDraftPolicyFn: tc.mockFn})
			r := chi.NewRouter()
			r.Get("/workspaces/{workspace}/sandboxes/{name}/drafts", app.GetDraftPolicy)

			req := httptest.NewRequest(http.MethodGet, tc.url, nil)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != tc.wantStatus {
				t.Errorf("status = %d, want %d", w.Code, tc.wantStatus)
			}
		})
	}
}

func TestApproveDraftChunk(t *testing.T) {
	tests := []struct {
		mockFn     func(ctx context.Context, workspace, name, chunkID string) (*openshellv1.ApproveDraftChunkResponse, error)
		name       string
		wantStatus int
	}{
		{
			name: "success",
			mockFn: func(_ context.Context, _, _, _ string) (*openshellv1.ApproveDraftChunkResponse, error) {
				return &openshellv1.ApproveDraftChunkResponse{PolicyVersion: 3, PolicyHash: "h3"}, nil
			},
			wantStatus: http.StatusOK,
		},
		{
			name: "not found",
			mockFn: func(_ context.Context, _, _, _ string) (*openshellv1.ApproveDraftChunkResponse, error) {
				return nil, status.Error(codes.NotFound, "chunk not found")
			},
			wantStatus: http.StatusNotFound,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			app := newTestApp(&mockGateway{approveDraftChunkFn: tc.mockFn})
			r := chi.NewRouter()
			r.Post("/workspaces/{workspace}/sandboxes/{name}/drafts/{chunk}/approve", app.ApproveDraftChunk)

			req := httptest.NewRequest(http.MethodPost, "/workspaces/default/sandboxes/my-sandbox/drafts/chunk-1/approve", nil)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != tc.wantStatus {
				t.Errorf("status = %d, want %d", w.Code, tc.wantStatus)
			}
		})
	}
}

func TestRejectDraftChunk(t *testing.T) {
	tests := []struct {
		mockFn     func(ctx context.Context, workspace, name, chunkID, reason string) (*openshellv1.RejectDraftChunkResponse, error)
		name       string
		body       string
		wantStatus int
	}{
		{
			name: "with reason",
			body: `{"reason":"too broad"}`,
			mockFn: func(_ context.Context, _, _, _, reason string) (*openshellv1.RejectDraftChunkResponse, error) {
				if reason != "too broad" {
					return nil, status.Error(codes.InvalidArgument, "unexpected reason")
				}
				return &openshellv1.RejectDraftChunkResponse{}, nil
			},
			wantStatus: http.StatusOK,
		},
		{
			name: "without reason",
			body: "",
			mockFn: func(_ context.Context, _, _, _, _ string) (*openshellv1.RejectDraftChunkResponse, error) {
				return &openshellv1.RejectDraftChunkResponse{}, nil
			},
			wantStatus: http.StatusOK,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			app := newTestApp(&mockGateway{rejectDraftChunkFn: tc.mockFn})
			r := chi.NewRouter()
			r.Post("/workspaces/{workspace}/sandboxes/{name}/drafts/{chunk}/reject", app.RejectDraftChunk)

			var bodyReader *strings.Reader
			if tc.body != "" {
				bodyReader = strings.NewReader(tc.body)
			} else {
				bodyReader = strings.NewReader("")
			}
			req := httptest.NewRequest(http.MethodPost, "/workspaces/default/sandboxes/my-sandbox/drafts/chunk-1/reject", bodyReader)
			if tc.body != "" {
				req.Header.Set("Content-Type", "application/json")
			} else {
				req.ContentLength = 0
			}
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != tc.wantStatus {
				t.Errorf("status = %d, want %d; body: %s", w.Code, tc.wantStatus, w.Body.String())
			}
		})
	}
}

func TestApproveAllDraftChunks(t *testing.T) {
	tests := []struct {
		mockFn     func(ctx context.Context, workspace, name string, includeSecurityFlagged bool) (*openshellv1.ApproveAllDraftChunksResponse, error)
		name       string
		body       string
		wantStatus int
	}{
		{
			name: "without security flagged",
			body: "",
			mockFn: func(_ context.Context, _, _ string, include bool) (*openshellv1.ApproveAllDraftChunksResponse, error) {
				if include {
					return nil, status.Error(codes.InvalidArgument, "should not include security flagged")
				}
				return &openshellv1.ApproveAllDraftChunksResponse{
					PolicyVersion:  4,
					PolicyHash:     "h4",
					ChunksApproved: 3,
					ChunksSkipped:  1,
				}, nil
			},
			wantStatus: http.StatusOK,
		},
		{
			name: "with security flagged",
			body: `{"includeSecurityFlagged":true}`,
			mockFn: func(_ context.Context, _, _ string, include bool) (*openshellv1.ApproveAllDraftChunksResponse, error) {
				if !include {
					return nil, status.Error(codes.InvalidArgument, "should include security flagged")
				}
				return &openshellv1.ApproveAllDraftChunksResponse{
					PolicyVersion:  4,
					PolicyHash:     "h4",
					ChunksApproved: 4,
					ChunksSkipped:  0,
				}, nil
			},
			wantStatus: http.StatusOK,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			app := newTestApp(&mockGateway{approveAllDraftChunksFn: tc.mockFn})
			r := chi.NewRouter()
			r.Post("/workspaces/{workspace}/sandboxes/{name}/drafts/approve-all", app.ApproveAllDraftChunks)

			var bodyReader *strings.Reader
			if tc.body != "" {
				bodyReader = strings.NewReader(tc.body)
			} else {
				bodyReader = strings.NewReader("")
			}
			req := httptest.NewRequest(http.MethodPost, "/workspaces/default/sandboxes/my-sandbox/drafts/approve-all", bodyReader)
			if tc.body != "" {
				req.Header.Set("Content-Type", "application/json")
			} else {
				req.ContentLength = 0
			}
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != tc.wantStatus {
				t.Errorf("status = %d, want %d; body: %s", w.Code, tc.wantStatus, w.Body.String())
			}
		})
	}
}

func TestApproveAllDraftChunksBody(t *testing.T) {
	app := newTestApp(&mockGateway{
		approveAllDraftChunksFn: func(_ context.Context, _, _ string, _ bool) (*openshellv1.ApproveAllDraftChunksResponse, error) {
			return &openshellv1.ApproveAllDraftChunksResponse{
				PolicyVersion:  5,
				PolicyHash:     "h5",
				ChunksApproved: 3,
				ChunksSkipped:  1,
			}, nil
		},
	})
	r := chi.NewRouter()
	r.Post("/workspaces/{workspace}/sandboxes/{name}/drafts/approve-all", app.ApproveAllDraftChunks)

	req := httptest.NewRequest(http.MethodPost, "/workspaces/default/sandboxes/my-sandbox/drafts/approve-all", strings.NewReader(""))
	req.ContentLength = 0
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}

	var body map[string]any
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if v, ok := body["chunksApproved"].(float64); !ok || v != 3 {
		t.Errorf("chunksApproved = %v, want 3", body["chunksApproved"])
	}
	if v, ok := body["chunksSkipped"].(float64); !ok || v != 1 {
		t.Errorf("chunksSkipped = %v, want 1", body["chunksSkipped"])
	}
}
