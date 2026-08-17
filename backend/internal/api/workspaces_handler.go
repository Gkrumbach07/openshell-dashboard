package api

import (
	"net/http"
	"net/url"

	"github.com/go-chi/chi/v5"

	openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"

	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/models"
)

// CreateWorkspaceRequest is the create-workspace body.
type CreateWorkspaceRequest struct {
	Labels map[string]string `json:"labels,omitempty"`
	Name   string            `json:"name"`
}

func (app *App) ListWorkspaces(w http.ResponseWriter, r *http.Request) {
	var opts []openshell.ListOptions
	if sel := r.URL.Query().Get("labelSelector"); sel != "" {
		opts = append(opts, openshell.ListOptions{LabelSelector: sel})
	}
	workspaces, err := app.sdk.Workspaces().List(r.Context(), opts...)
	if err != nil {
		writeSDKError(w, err)
		return
	}
	out := make([]models.Workspace, 0, len(workspaces))
	for _, ws := range workspaces {
		out = append(out, models.FromSDKWorkspace(ws))
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
	workspace, err := app.sdk.Workspaces().Create(r.Context(), body.Name, body.Labels)
	if err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, models.FromSDKWorkspace(workspace))
}

func (app *App) GetWorkspace(w http.ResponseWriter, r *http.Request) {
	workspace, err := app.sdk.Workspaces().Get(r.Context(), chi.URLParam(r, "workspace"))
	if err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.FromSDKWorkspace(workspace))
}

func (app *App) DeleteWorkspace(w http.ResponseWriter, r *http.Request) {
	if err := app.sdk.Workspaces().Delete(r.Context(), chi.URLParam(r, "workspace")); err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}

// AddMemberRequest is the add-member body. Role is USER or ADMIN.
type AddMemberRequest struct {
	PrincipalSubject string `json:"principalSubject"`
	Role             string `json:"role"`
}

func (app *App) ListMembers(w http.ResponseWriter, r *http.Request) {
	members, err := app.sdk.Workspaces().ListMembers(r.Context(), chi.URLParam(r, "workspace"))
	if err != nil {
		writeSDKError(w, err)
		return
	}
	out := make([]models.WorkspaceMember, 0, len(members))
	for _, member := range members {
		out = append(out, models.FromSDKWorkspaceMember(member))
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
	role, ok := models.SDKWorkspaceRoleFromString(body.Role)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_role", "role must be USER or ADMIN")
		return
	}
	member, err := app.sdk.Workspaces().AddMember(r.Context(), chi.URLParam(r, "workspace"), body.PrincipalSubject, role)
	if err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, models.FromSDKWorkspaceMember(member))
}

func (app *App) RemoveMember(w http.ResponseWriter, r *http.Request) {
	// Subjects are OIDC sub claims and may contain URL-escaped characters.
	subject, err := url.PathUnescape(chi.URLParam(r, "subject"))
	if err != nil || subject == "" {
		writeError(w, http.StatusBadRequest, "invalid_subject", "invalid member subject")
		return
	}
	if err := app.sdk.Workspaces().RemoveMember(r.Context(), chi.URLParam(r, "workspace"), subject); err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"removed": true})
}
