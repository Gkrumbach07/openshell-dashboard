package api

import (
	"net/http"
	"net/url"

	"github.com/go-chi/chi/v5"

	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/models"
)

// CreateWorkspaceRequest is the create-workspace body.
type CreateWorkspaceRequest struct {
	Labels map[string]string `json:"labels,omitempty"`
	Name   string            `json:"name"`
}

func (app *App) ListWorkspaces(w http.ResponseWriter, r *http.Request) {
	workspaces, err := app.gateway.ListWorkspaces(r.Context(), 0, 0, r.URL.Query().Get("labelSelector"))
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	out := make([]models.Workspace, 0, len(workspaces))
	for _, ws := range workspaces {
		out = append(out, models.FromWorkspace(ws))
	}
	writeJSON(w, http.StatusOK, out)
}

func (app *App) CreateWorkspace(w http.ResponseWriter, r *http.Request) {
	var body CreateWorkspaceRequest
	if !decodeBody(w, r, &body) {
		return
	}
	if !validDNS1123(body.Name) {
		writeError(w, http.StatusBadRequest, "invalid_name", "workspace name must be a valid DNS-1123 label")
		return
	}
	workspace, err := app.gateway.CreateWorkspace(r.Context(), body.Name, body.Labels)
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, models.FromWorkspace(workspace))
}

func (app *App) GetWorkspace(w http.ResponseWriter, r *http.Request) {
	workspace, err := app.gateway.GetWorkspace(r.Context(), chi.URLParam(r, "workspace"))
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.FromWorkspace(workspace))
}

func (app *App) DeleteWorkspace(w http.ResponseWriter, r *http.Request) {
	deleted, err := app.gateway.DeleteWorkspace(r.Context(), chi.URLParam(r, "workspace"))
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": deleted})
}

// AddMemberRequest is the add-member body. Role is USER or ADMIN.
type AddMemberRequest struct {
	PrincipalSubject string `json:"principalSubject"`
	Role             string `json:"role"`
}

func (app *App) ListMembers(w http.ResponseWriter, r *http.Request) {
	members, err := app.gateway.ListWorkspaceMembers(r.Context(), chi.URLParam(r, "workspace"), 0, 0)
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	out := make([]models.WorkspaceMember, 0, len(members))
	for _, member := range members {
		out = append(out, models.FromWorkspaceMember(member))
	}
	writeJSON(w, http.StatusOK, out)
}

func (app *App) AddMember(w http.ResponseWriter, r *http.Request) {
	var body AddMemberRequest
	if !decodeBody(w, r, &body) {
		return
	}
	if body.PrincipalSubject == "" {
		writeError(w, http.StatusBadRequest, "invalid_subject", "principalSubject is required")
		return
	}
	role, ok := models.WorkspaceRoleFromString(body.Role)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_role", "role must be USER or ADMIN")
		return
	}
	member, err := app.gateway.AddWorkspaceMember(r.Context(), chi.URLParam(r, "workspace"), body.PrincipalSubject, role)
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, models.FromWorkspaceMember(member))
}

func (app *App) RemoveMember(w http.ResponseWriter, r *http.Request) {
	// Subjects are OIDC sub claims and may contain URL-escaped characters.
	subject, err := url.PathUnescape(chi.URLParam(r, "subject"))
	if err != nil || subject == "" {
		writeError(w, http.StatusBadRequest, "invalid_subject", "invalid member subject")
		return
	}
	removed, err := app.gateway.RemoveWorkspaceMember(r.Context(), chi.URLParam(r, "workspace"), subject)
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"removed": removed})
}
