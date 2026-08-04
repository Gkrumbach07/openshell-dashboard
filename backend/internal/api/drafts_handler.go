package api

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/models"
)

// draftSummaryResponse matches the frontend DraftSummary type.
type draftSummaryResponse struct {
	Sandboxes    []any `json:"sandboxes"`
	TotalPending int   `json:"totalPending"`
}

// GetDraftSummary returns an aggregated summary of pending draft policy chunks
// across all workspaces. TODO: No single gateway RPC provides a cross-workspace
// draft summary. When one becomes available, aggregate real data here. For now,
// return an empty response so the frontend route does not 404.
func (app *App) GetDraftSummary(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, draftSummaryResponse{
		Sandboxes:    []any{},
		TotalPending: 0,
	})
}

// GetDraftPolicy returns the draft-policy inbox for a sandbox. Optional
// ?status=pending|approved|rejected filter.
func (app *App) GetDraftPolicy(w http.ResponseWriter, r *http.Request) {
	resp, err := app.gateway.GetDraftPolicy(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"), r.URL.Query().Get("status"))
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.FromDraftPolicy(resp))
}

// ApproveDraftChunk merges one proposed rule into the active policy.
func (app *App) ApproveDraftChunk(w http.ResponseWriter, r *http.Request) {
	resp, err := app.gateway.ApproveDraftChunk(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"), chi.URLParam(r, "chunk"))
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.PolicyUpdateResult{
		Version:    resp.GetPolicyVersion(),
		PolicyHash: resp.GetPolicyHash(),
	})
}

// RejectDraftChunkRequest carries the optional reviewer reason, surfaced back
// to the in-sandbox agent.
type RejectDraftChunkRequest struct {
	Reason string `json:"reason,omitempty"`
}

// RejectDraftChunk rejects one proposed rule.
func (app *App) RejectDraftChunk(w http.ResponseWriter, r *http.Request) {
	var body RejectDraftChunkRequest
	if r.ContentLength > 0 && !decodeBody(w, r, &body) {
		return
	}
	if _, err := app.gateway.RejectDraftChunk(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"), chi.URLParam(r, "chunk"), body.Reason); err != nil {
		writeGrpcError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"rejected": true})
}

// ApproveAllDraftChunksRequest mirrors the include_security_flagged option.
type ApproveAllDraftChunksRequest struct {
	IncludeSecurityFlagged bool `json:"includeSecurityFlagged,omitempty"`
}

// ApproveAllDraftChunks approves all pending chunks (security-flagged ones
// are skipped unless explicitly included).
func (app *App) ApproveAllDraftChunks(w http.ResponseWriter, r *http.Request) {
	var body ApproveAllDraftChunksRequest
	if r.ContentLength > 0 && !decodeBody(w, r, &body) {
		return
	}
	resp, err := app.gateway.ApproveAllDraftChunks(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"), body.IncludeSecurityFlagged)
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"policyVersion":  resp.GetPolicyVersion(),
		"policyHash":     resp.GetPolicyHash(),
		"chunksApproved": resp.GetChunksApproved(),
		"chunksSkipped":  resp.GetChunksSkipped(),
	})
}

// EditDraftChunkRequest carries the replacement proposed rule as protojson.
type EditDraftChunkRequest struct {
	ProposedRule json.RawMessage `json:"proposedRule"`
}

// EditDraftChunk replaces the proposed rule on a pending draft chunk.
func (app *App) EditDraftChunk(w http.ResponseWriter, r *http.Request) {
	var body EditDraftChunkRequest
	if !decodeBody(w, r, &body) {
		return
	}
	if len(body.ProposedRule) == 0 {
		writeError(w, http.StatusBadRequest, "invalid_rule", "proposedRule is required")
		return
	}
	rule, err := models.ParseNetworkPolicyRule(body.ProposedRule)
	if err != nil {
		slog.Error("invalid network policy rule", "error", err)
		writeError(w, http.StatusBadRequest, "invalid_rule", "invalid network policy rule")
		return
	}
	if err := app.gateway.EditDraftChunk(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"), chi.URLParam(r, "chunk"), rule); err != nil {
		writeGrpcError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"edited": true})
}

// UndoDraftChunk reverts an already-approved chunk, removing its rule from the
// active policy.
func (app *App) UndoDraftChunk(w http.ResponseWriter, r *http.Request) {
	resp, err := app.gateway.UndoDraftChunk(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"), chi.URLParam(r, "chunk"))
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.PolicyUpdateResult{
		Version:    resp.GetPolicyVersion(),
		PolicyHash: resp.GetPolicyHash(),
	})
}

// ClearDraftChunks removes all pending draft chunks for a sandbox.
func (app *App) ClearDraftChunks(w http.ResponseWriter, r *http.Request) {
	resp, err := app.gateway.ClearDraftChunks(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"))
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"chunksCleared": resp.GetChunksCleared(),
	})
}

// GetDraftHistory returns the chronological decision history for a sandbox's
// draft policy.
func (app *App) GetDraftHistory(w http.ResponseWriter, r *http.Request) {
	resp, err := app.gateway.GetDraftHistory(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"))
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.FromDraftHistory(resp))
}
