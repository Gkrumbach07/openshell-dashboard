package handlers

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/models"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/services/workspace"
)

// WorkspaceHandler translates HTTP requests into workspace.Service calls.
// Covers the SDK's WorkspaceInterface (client.Workspaces()). Platform-Admin
// surface (see CLAUDE.md personas). Mounted at /api/workspaces.
type WorkspaceHandler struct {
	*Handler
	service workspace.Service
}

// NewWorkspaceHandler wires a WorkspaceHandler around the given service.
func NewWorkspaceHandler(service workspace.Service) *WorkspaceHandler {
	return &WorkspaceHandler{
		Handler: newHandler(nil),
		service: service,
	}
}

func (h *WorkspaceHandler) RegisterRoutes(r chi.Router) {
	r.Get("/", h.List)
	r.Post("/", h.Create)
	r.Get("/{name}", h.Get)
	r.Delete("/{name}", h.Delete)
	r.Get("/{name}/members", h.ListMembers)
	r.Post("/{name}/members", h.AddMember)
	r.Delete("/{name}/members/{subject}", h.RemoveMember)
}

func (h *WorkspaceHandler) List(w http.ResponseWriter, r *http.Request) {
	workspaces, err := h.service.List(r.Context(), models.ListOptions{})
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err)
		return
	}
	h.writeJSON(w, http.StatusOK, workspaces)
}

func (h *WorkspaceHandler) Get(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")

	ws, err := h.service.Get(r.Context(), name)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err)
		return
	}
	h.writeJSON(w, http.StatusOK, ws)
}

func (h *WorkspaceHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name   string            `json:"name"`
		Labels map[string]string `json:"labels,omitempty"`
	}
	if err := h.decodeJSON(r, &req); err != nil {
		h.writeError(w, http.StatusBadRequest, err)
		return
	}

	ws, err := h.service.Create(r.Context(), req.Name, req.Labels)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err)
		return
	}
	h.writeJSON(w, http.StatusCreated, ws)
}

func (h *WorkspaceHandler) Delete(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")

	if err := h.service.Delete(r.Context(), name); err != nil {
		h.writeError(w, http.StatusInternalServerError, err)
		return
	}
	h.writeJSON(w, http.StatusNoContent, nil)
}

func (h *WorkspaceHandler) ListMembers(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")

	members, err := h.service.ListMembers(r.Context(), name)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err)
		return
	}
	h.writeJSON(w, http.StatusOK, members)
}

func (h *WorkspaceHandler) AddMember(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")

	var req struct {
		PrincipalSubject string `json:"principalSubject"`
		Role             string `json:"role"`
	}
	if err := h.decodeJSON(r, &req); err != nil {
		h.writeError(w, http.StatusBadRequest, err)
		return
	}

	member, err := h.service.AddMember(r.Context(), name, req.PrincipalSubject, req.Role)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err)
		return
	}
	h.writeJSON(w, http.StatusCreated, member)
}

func (h *WorkspaceHandler) RemoveMember(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	subject := chi.URLParam(r, "subject")

	if err := h.service.RemoveMember(r.Context(), name, subject); err != nil {
		h.writeError(w, http.StatusInternalServerError, err)
		return
	}
	h.writeJSON(w, http.StatusNoContent, nil)
}
