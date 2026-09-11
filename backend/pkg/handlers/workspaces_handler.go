package handlers

import (
	"net/http"
	"net/url"

	openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"

	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/apiutils"
	"github.com/Gkrumbach07/openshell-dashboard/backend/pkg/models"
	"github.com/Gkrumbach07/openshell-dashboard/backend/pkg/services"
)

// CreateWorkspaceRequest is the create-workspace body.
type CreateWorkspaceRequest struct {
	Labels map[string]string `json:"labels,omitempty"`
	Name   string            `json:"name"`
}

type WorkspacesHandler struct {
	svc services.WorkspaceServiceInterface
}

func NewWorkspacesHandler(svc services.WorkspaceServiceInterface) *WorkspacesHandler {
	return &WorkspacesHandler{
		svc: svc,
	}
}

func (h *WorkspacesHandler) ListWorkspaces(w http.ResponseWriter, r *http.Request) {
	var opts []openshell.ListOptions
	if sel := r.URL.Query().Get("labelSelector"); sel != "" {
		opts = append(opts, openshell.ListOptions{LabelSelector: sel})
	}
	workspaces, err := h.svc.List(r.Context(), opts...)
	if err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	out := make([]models.Workspace, 0, len(workspaces))
	for _, ws := range workspaces {
		out = append(out, models.FromSDKWorkspace(ws))
	}
	apiutils.WriteJSON(w, http.StatusOK, out)
}

func (h *WorkspacesHandler) CreateWorkspace(w http.ResponseWriter, r *http.Request) {
	var body CreateWorkspaceRequest
	if !apiutils.DecodeBody(w, r, &body) {
		return
	}
	if !apiutils.ValidDNS1123(body.Name) {
		apiutils.WriteError(w, http.StatusBadRequest, apiutils.InvalidName, "workspace name must be a valid DNS-1123 label")
		return
	}
	workspace, err := h.svc.Create(r.Context(), body.Name, body.Labels)
	if err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	apiutils.WriteJSON(w, http.StatusCreated, models.FromSDKWorkspace(workspace))
}

func (h *WorkspacesHandler) GetWorkspace(w http.ResponseWriter, r *http.Request) {
	workspace, err := h.svc.Get(r.Context(), r.PathValue("workspace"))
	if err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	apiutils.WriteJSON(w, http.StatusOK, models.FromSDKWorkspace(workspace))
}

func (h *WorkspacesHandler) DeleteWorkspace(w http.ResponseWriter, r *http.Request) {
	if err := h.svc.Delete(r.Context(), r.PathValue("workspace")); err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	apiutils.WriteJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}

// AddMemberRequest is the add-member body. Role is USER or ADMIN.
type AddMemberRequest struct {
	PrincipalSubject string `json:"principalSubject"`
	Role             string `json:"role"`
}

func (h *WorkspacesHandler) ListMembers(w http.ResponseWriter, r *http.Request) {
	members, err := h.svc.ListMembers(r.Context(), r.PathValue("workspace"))
	if err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	out := make([]models.WorkspaceMember, 0, len(members))
	for _, member := range members {
		out = append(out, models.FromSDKWorkspaceMember(member))
	}
	apiutils.WriteJSON(w, http.StatusOK, out)
}

func (h *WorkspacesHandler) AddMember(w http.ResponseWriter, r *http.Request) {
	var body AddMemberRequest
	if !apiutils.DecodeBody(w, r, &body) {
		return
	}
	if body.PrincipalSubject == "" {
		apiutils.WriteError(w, http.StatusBadRequest, apiutils.InvalidSubject, "principalSubject is required")
		return
	}
	role, ok := models.SDKWorkspaceRoleFromString(body.Role)
	if !ok {
		apiutils.WriteError(w, http.StatusBadRequest, apiutils.InvalidRole, "role must be USER or ADMIN")
		return
	}
	member, err := h.svc.AddMember(r.Context(), r.PathValue("workspace"), body.PrincipalSubject, role)
	if err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	apiutils.WriteJSON(w, http.StatusCreated, models.FromSDKWorkspaceMember(member))
}

func (h *WorkspacesHandler) RemoveMember(w http.ResponseWriter, r *http.Request) {
	// Subjects are OIDC sub claims and may contain URL-escaped characters.
	subject, err := url.PathUnescape(r.PathValue("subject"))
	if err != nil || subject == "" {
		apiutils.WriteError(w, http.StatusBadRequest, apiutils.InvalidSubject, "invalid member subject")
		return
	}
	if err := h.svc.RemoveMember(r.Context(), r.PathValue("workspace"), subject); err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	apiutils.WriteJSON(w, http.StatusOK, map[string]bool{"removed": true})
}
