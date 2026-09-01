package handlers

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/models"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/services/policy"
)

// PolicyHandler translates HTTP requests into policy.Service calls. Covers
// the SDK's PolicyInterface (client.Policy()).
//
// Most operations are sandbox-scoped and mounted under
// /api/sandboxes/{name}/policy (RegisterRoutes). ListRevisions is
// workspace-scoped (matching the SDK's own List(ctx, workspace, ...)
// signature) and mounted separately at /api/policy/revisions
// (RegisterWorkspaceRoutes) -- see pkg/server.
type PolicyHandler struct {
	*Handler
	service policy.Service
}

// NewPolicyHandler wires a PolicyHandler around the given service.
func NewPolicyHandler(service policy.Service) *PolicyHandler {
	return &PolicyHandler{
		Handler: newHandler(nil),
		service: service,
	}
}

// RegisterRoutes mounts sandbox-scoped policy routes onto r. r is expected
// to already carry the "name" URL param for the parent sandbox.
func (h *PolicyHandler) RegisterRoutes(r chi.Router) {
	r.Get("/draft", h.GetDraft)
	r.Get("/draft/history", h.GetDraftHistory)
	r.Post("/draft/clear", h.ClearDraftChunks)
	r.Post("/draft/approve-all", h.ApproveAllDraftChunks)
	r.Post("/draft/chunks/{chunkID}/approve", h.ApproveDraftChunk)
	r.Post("/draft/chunks/{chunkID}/reject", h.RejectDraftChunk)
	r.Post("/draft/chunks/{chunkID}/edit", h.EditDraftChunk)
	r.Post("/draft/chunks/{chunkID}/undo", h.UndoDraftChunk)
	r.Get("/status", h.GetStatus)
}

// RegisterWorkspaceRoutes mounts the workspace-scoped ListRevisions route.
// Intended to be mounted at /api/policy in pkg/server.
func (h *PolicyHandler) RegisterWorkspaceRoutes(r chi.Router) {
	r.Get("/revisions", h.ListRevisions)
}

func (h *PolicyHandler) GetDraft(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")
	name := chi.URLParam(r, "name")

	draft, err := h.service.GetDraft(r.Context(), workspace, name)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err)
		return
	}
	h.writeJSON(w, http.StatusOK, draft)
}

func (h *PolicyHandler) GetDraftHistory(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")
	name := chi.URLParam(r, "name")

	history, err := h.service.GetDraftHistory(r.Context(), workspace, name)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err)
		return
	}
	h.writeJSON(w, http.StatusOK, history)
}

func (h *PolicyHandler) ClearDraftChunks(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")
	name := chi.URLParam(r, "name")

	result, err := h.service.ClearDraftChunks(r.Context(), workspace, name)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err)
		return
	}
	h.writeJSON(w, http.StatusOK, result)
}

func (h *PolicyHandler) ApproveAllDraftChunks(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")
	name := chi.URLParam(r, "name")

	result, err := h.service.ApproveAllDraftChunks(r.Context(), workspace, name)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err)
		return
	}
	h.writeJSON(w, http.StatusOK, result)
}

func (h *PolicyHandler) ApproveDraftChunk(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")
	name := chi.URLParam(r, "name")
	chunkID := chi.URLParam(r, "chunkID")

	result, err := h.service.ApproveDraftChunk(r.Context(), workspace, name, chunkID)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err)
		return
	}
	h.writeJSON(w, http.StatusOK, result)
}

func (h *PolicyHandler) RejectDraftChunk(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")
	name := chi.URLParam(r, "name")
	chunkID := chi.URLParam(r, "chunkID")

	var req struct {
		Reason string `json:"reason"`
	}
	if err := h.decodeJSON(r, &req); err != nil {
		h.writeError(w, http.StatusBadRequest, err)
		return
	}

	if err := h.service.RejectDraftChunk(r.Context(), workspace, name, chunkID, req.Reason); err != nil {
		h.writeError(w, http.StatusInternalServerError, err)
		return
	}
	h.writeJSON(w, http.StatusNoContent, nil)
}

func (h *PolicyHandler) EditDraftChunk(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")
	name := chi.URLParam(r, "name")
	chunkID := chi.URLParam(r, "chunkID")

	var rule models.NetworkPolicyRule
	if err := h.decodeJSON(r, &rule); err != nil {
		h.writeError(w, http.StatusBadRequest, err)
		return
	}

	if err := h.service.EditDraftChunk(r.Context(), workspace, name, chunkID, &rule); err != nil {
		h.writeError(w, http.StatusInternalServerError, err)
		return
	}
	h.writeJSON(w, http.StatusNoContent, nil)
}

func (h *PolicyHandler) UndoDraftChunk(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")
	name := chi.URLParam(r, "name")
	chunkID := chi.URLParam(r, "chunkID")

	result, err := h.service.UndoDraftChunk(r.Context(), workspace, name, chunkID)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err)
		return
	}
	h.writeJSON(w, http.StatusOK, result)
}

func (h *PolicyHandler) GetStatus(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")
	name := chi.URLParam(r, "name")

	status, err := h.service.GetStatus(r.Context(), workspace, name)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err)
		return
	}
	h.writeJSON(w, http.StatusOK, status)
}

func (h *PolicyHandler) ListRevisions(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")

	revisions, err := h.service.ListRevisions(r.Context(), workspace)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err)
		return
	}
	h.writeJSON(w, http.StatusOK, revisions)
}
