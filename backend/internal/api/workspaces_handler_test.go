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

	datamodelv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/datamodelv1"
	openshellv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/openshellv1"
)

func TestListWorkspaces(t *testing.T) {
	tests := []struct {
		mockFn     func(ctx context.Context, limit, offset uint32, labelSelector string) ([]*datamodelv1.Workspace, error)
		name       string
		wantStatus int
		wantLen    int
	}{
		{
			name: "returns workspaces",
			mockFn: func(_ context.Context, _, _ uint32, _ string) ([]*datamodelv1.Workspace, error) {
				return []*datamodelv1.Workspace{
					{
						Metadata: &datamodelv1.ObjectMeta{Name: "team-a"},
						Status:   &datamodelv1.WorkspaceStatus{Phase: datamodelv1.WorkspacePhase_WORKSPACE_PHASE_ACTIVE},
					},
					{
						Metadata: &datamodelv1.ObjectMeta{Name: "team-b"},
						Status:   &datamodelv1.WorkspaceStatus{Phase: datamodelv1.WorkspacePhase_WORKSPACE_PHASE_TERMINATING},
					},
				}, nil
			},
			wantStatus: http.StatusOK,
			wantLen:    2,
		},
		{
			name: "empty list",
			mockFn: func(_ context.Context, _, _ uint32, _ string) ([]*datamodelv1.Workspace, error) {
				return nil, nil
			},
			wantStatus: http.StatusOK,
			wantLen:    0,
		},
		{
			name: "unauthenticated",
			mockFn: func(_ context.Context, _, _ uint32, _ string) ([]*datamodelv1.Workspace, error) {
				return nil, status.Error(codes.Unauthenticated, "missing token")
			},
			wantStatus: http.StatusUnauthorized,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			app := newTestApp(&mockGateway{listWorkspacesFn: tc.mockFn})
			r := chi.NewRouter()
			r.Get("/workspaces", app.ListWorkspaces)

			req := httptest.NewRequest(http.MethodGet, "/workspaces", nil)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != tc.wantStatus {
				t.Errorf("status = %d, want %d", w.Code, tc.wantStatus)
			}
			if tc.wantStatus == http.StatusOK {
				var body []json.RawMessage
				if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
					t.Fatalf("decode: %v", err)
				}
				if len(body) != tc.wantLen {
					t.Errorf("got %d workspaces, want %d", len(body), tc.wantLen)
				}
			}
		})
	}
}

func TestCreateWorkspace(t *testing.T) {
	tests := []struct {
		name       string
		body       string
		wantCode   string
		wantStatus int
	}{
		{
			name:       "success",
			body:       `{"name":"team-a"}`,
			wantStatus: http.StatusCreated,
		},
		{
			name:       "missing name",
			body:       `{"name":""}`,
			wantStatus: http.StatusBadRequest,
			wantCode:   "invalid_name",
		},
		{
			name:       "invalid name - uppercase",
			body:       `{"name":"Team-A"}`,
			wantStatus: http.StatusBadRequest,
			wantCode:   "invalid_name",
		},
		{
			name:       "invalid name - underscore",
			body:       `{"name":"team_a"}`,
			wantStatus: http.StatusBadRequest,
			wantCode:   "invalid_name",
		},
		{
			name:       "invalid JSON",
			body:       `not-json`,
			wantStatus: http.StatusBadRequest,
			wantCode:   "invalid_body",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			mock := &mockGateway{
				createWorkspaceFn: func(_ context.Context, name string, labels map[string]string) (*datamodelv1.Workspace, error) {
					return &datamodelv1.Workspace{
						Metadata: &datamodelv1.ObjectMeta{Name: name, Labels: labels},
						Status:   &datamodelv1.WorkspaceStatus{Phase: datamodelv1.WorkspacePhase_WORKSPACE_PHASE_ACTIVE},
					}, nil
				},
			}
			app := newTestApp(mock)
			r := chi.NewRouter()
			r.Post("/workspaces", app.CreateWorkspace)

			req := httptest.NewRequest(http.MethodPost, "/workspaces", strings.NewReader(tc.body))
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

func TestGetWorkspace(t *testing.T) {
	app := newTestApp(&mockGateway{
		getWorkspaceFn: func(_ context.Context, name string) (*datamodelv1.Workspace, error) {
			return &datamodelv1.Workspace{
				Metadata: &datamodelv1.ObjectMeta{Name: name},
				Status:   &datamodelv1.WorkspaceStatus{Phase: datamodelv1.WorkspacePhase_WORKSPACE_PHASE_ACTIVE},
			}, nil
		},
	})
	r := chi.NewRouter()
	r.Get("/workspaces/{workspace}", app.GetWorkspace)

	req := httptest.NewRequest(http.MethodGet, "/workspaces/team-a", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	var body map[string]any
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	meta, ok := body["metadata"].(map[string]any)
	if !ok {
		t.Fatal("metadata is not a map")
	}
	if meta["name"] != "team-a" {
		t.Errorf("name = %v, want team-a", meta["name"])
	}
	if body["phase"] != "ACTIVE" {
		t.Errorf("phase = %v, want ACTIVE", body["phase"])
	}
}

func TestDeleteWorkspace(t *testing.T) {
	app := newTestApp(&mockGateway{
		deleteWorkspaceFn: func(_ context.Context, _ string) (bool, error) {
			return true, nil
		},
	})
	r := chi.NewRouter()
	r.Delete("/workspaces/{workspace}", app.DeleteWorkspace)

	req := httptest.NewRequest(http.MethodDelete, "/workspaces/team-a", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	var body map[string]bool
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !body["deleted"] {
		t.Error("expected deleted=true")
	}
}

func TestAddMember(t *testing.T) {
	tests := []struct {
		name       string
		body       string
		wantCode   string
		wantStatus int
	}{
		{
			name:       "success",
			body:       `{"principalSubject":"user@example.com","role":"USER"}`,
			wantStatus: http.StatusCreated,
		},
		{
			name:       "missing subject",
			body:       `{"principalSubject":"","role":"USER"}`,
			wantStatus: http.StatusBadRequest,
			wantCode:   "invalid_subject",
		},
		{
			name:       "invalid role",
			body:       `{"principalSubject":"user@example.com","role":"SUPERADMIN"}`,
			wantStatus: http.StatusBadRequest,
			wantCode:   "invalid_role",
		},
		{
			name:       "admin role accepted",
			body:       `{"principalSubject":"admin@example.com","role":"ADMIN"}`,
			wantStatus: http.StatusCreated,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			mock := &mockGateway{
				addWorkspaceMemberFn: func(_ context.Context, _, subject string, role openshellv1.WorkspaceRole) (*openshellv1.WorkspaceMember, error) {
					return &openshellv1.WorkspaceMember{
						Metadata:         &datamodelv1.ObjectMeta{Name: subject},
						PrincipalSubject: subject,
						Role:             role,
					}, nil
				},
			}
			app := newTestApp(mock)
			r := chi.NewRouter()
			r.Post("/workspaces/{workspace}/members", app.AddMember)

			req := httptest.NewRequest(http.MethodPost, "/workspaces/default/members", strings.NewReader(tc.body))
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

func TestRemoveMember(t *testing.T) {
	app := newTestApp(&mockGateway{
		removeWorkspaceMemberFn: func(_ context.Context, _, _ string) (bool, error) {
			return true, nil
		},
	})
	r := chi.NewRouter()
	r.Delete("/workspaces/{workspace}/members/{subject}", app.RemoveMember)

	req := httptest.NewRequest(http.MethodDelete, "/workspaces/default/members/user@example.com", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
}

func TestListMembers(t *testing.T) {
	app := newTestApp(&mockGateway{
		listWorkspaceMembersFn: func(_ context.Context, _ string, _, _ uint32) ([]*openshellv1.WorkspaceMember, error) {
			return []*openshellv1.WorkspaceMember{
				{
					Metadata:         &datamodelv1.ObjectMeta{Name: "user1"},
					PrincipalSubject: "user1@example.com",
					Role:             openshellv1.WorkspaceRole_WORKSPACE_ROLE_USER,
				},
			}, nil
		},
	})
	r := chi.NewRouter()
	r.Get("/workspaces/{workspace}/members", app.ListMembers)

	req := httptest.NewRequest(http.MethodGet, "/workspaces/default/members", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	var body []map[string]any
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(body) != 1 {
		t.Fatalf("got %d members, want 1", len(body))
	}
	if body[0]["role"] != "USER" {
		t.Errorf("role = %v, want USER", body[0]["role"])
	}
}
