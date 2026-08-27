package api

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"

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
func (app *App) GetDraftSummary(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, draftSummaryResponse{
		Sandboxes:    []any{},
		TotalPending: 0,
	})
}

// GetDraftPolicy returns the draft-policy inbox for a sandbox. Optional
// ?status=pending|approved|rejected filter.
func (app *App) GetDraftPolicy(w http.ResponseWriter, r *http.Request) {
	var opts []openshell.GetDraftOption
	if status := r.URL.Query().Get("status"); status != "" {
		opts = append(opts, openshell.WithStatusFilter(status))
	}
	draft, err := app.sdk.Policy().GetDraft(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"), opts...)
	if err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.FromSDKDraftPolicy(draft))
}

// ApproveDraftChunk merges one proposed rule into the active policy.
func (app *App) ApproveDraftChunk(w http.ResponseWriter, r *http.Request) {
	workspace := chi.URLParam(r, "workspace")
	name := chi.URLParam(r, "name")
	chunkID := chi.URLParam(r, "chunk")

	// The gateway binds each approval to a review_token that pins the exact
	// evaluated candidate (optimistic concurrency). Resolve the current token
	// for this chunk from the draft before approving; older gateways return an
	// empty token, which the RPC accepts.
	reviewToken, err := app.resolveDraftReviewToken(r.Context(), workspace, name, chunkID)
	if err != nil {
		writeSDKError(w, err)
		return
	}

	result, err := app.sdk.Policy().ApproveDraftChunk(r.Context(), workspace, name, chunkID, reviewToken)
	if err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.PolicyUpdateResult{
		Version:    result.PolicyVersion,
		PolicyHash: result.PolicyHash,
	})
}

// resolveDraftReviewToken returns the review token bound to the given draft
// chunk, or an empty string if the chunk carries none. The token pins an
// approval to the exact candidate the gateway last evaluated.
func (app *App) resolveDraftReviewToken(ctx context.Context, workspace, name, chunkID string) (string, error) {
	draft, err := app.sdk.Policy().GetDraft(ctx, workspace, name)
	if err != nil {
		return "", err
	}
	for i := range draft.Chunks {
		if draft.Chunks[i].ID == chunkID {
			return draft.Chunks[i].ReviewToken, nil
		}
	}
	return "", nil
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
	if err := app.sdk.Policy().RejectDraftChunk(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"), chi.URLParam(r, "chunk"), body.Reason); err != nil {
		writeSDKError(w, err)
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
	var opts []openshell.ApproveAllOption
	if body.IncludeSecurityFlagged {
		opts = append(opts, openshell.WithIncludeSecurityFlagged())
	}
	result, err := app.sdk.Policy().ApproveAllDraftChunks(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"), opts...)
	if err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"policyVersion":  result.PolicyVersion,
		"policyHash":     result.PolicyHash,
		"chunksApproved": result.ChunksApproved,
		"chunksSkipped":  result.ChunksSkipped,
	})
}

// EditDraftChunkRequest carries the replacement proposed rule as JSON.
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
	rule, err := models.ParseSDKNetworkPolicyRule(body.ProposedRule)
	if err != nil {
		slog.Error("invalid network policy rule", "error", err)
		writeError(w, http.StatusBadRequest, "invalid_rule", "proposedRule does not match NetworkPolicyRule schema: "+err.Error())
		return
	}
	if err := app.sdk.Policy().EditDraftChunk(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"), chi.URLParam(r, "chunk"), rule); err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"edited": true})
}

// UndoDraftChunk reverts an already-approved chunk, removing its rule from the
// active policy.
func (app *App) UndoDraftChunk(w http.ResponseWriter, r *http.Request) {
	result, err := app.sdk.Policy().UndoDraftChunk(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"), chi.URLParam(r, "chunk"))
	if err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.PolicyUpdateResult{
		Version:    result.PolicyVersion,
		PolicyHash: result.PolicyHash,
	})
}

// ClearDraftChunks removes all pending draft chunks for a sandbox.
func (app *App) ClearDraftChunks(w http.ResponseWriter, r *http.Request) {
	result, err := app.sdk.Policy().ClearDraftChunks(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"))
	if err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"chunksCleared": result.ChunksCleared,
	})
}

// GetDraftHistory returns the chronological decision history for a sandbox's
// draft policy.
func (app *App) GetDraftHistory(w http.ResponseWriter, r *http.Request) {
	entries, err := app.sdk.Policy().GetDraftHistory(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"))
	if err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.FromSDKDraftHistory(entries))
}
