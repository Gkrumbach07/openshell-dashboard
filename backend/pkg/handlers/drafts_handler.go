package handlers

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"

	openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"

	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/apiutils"
	"github.com/Gkrumbach07/openshell-dashboard/backend/pkg/models"
	"github.com/Gkrumbach07/openshell-dashboard/backend/pkg/services"
)

// draftSummaryResponse matches the frontend DraftSummary type.
type draftSummaryResponse struct {
	Sandboxes    []any `json:"sandboxes"`
	TotalPending int   `json:"totalPending"`
}

// ApproveDraftChunkRequest optionally carries the chunk's review token, which
// the frontend already has from its last GetDraftPolicy fetch. Absent for
// older clients or the approve-from-notification path.
type ApproveDraftChunkRequest struct {
	ReviewToken string `json:"reviewToken,omitempty"`
}

// RejectDraftChunkRequest carries the optional reviewer reason, surfaced back
// to the in-sandbox agent.
type RejectDraftChunkRequest struct {
	Reason string `json:"reason,omitempty"`
}

type DraftsHandler struct {
	svc services.PolicyServiceInterface
}

func NewDraftsHandler(svc services.PolicyServiceInterface) *DraftsHandler {
	return &DraftsHandler{svc: svc}
}

// GetDraftSummary returns an aggregated summary of pending draft policy chunks
// across all workspaces. TODO: No single gateway RPC provides a cross-workspace
// draft summary. When one becomes available, aggregate real data here. For now,
// return an empty response so the frontend route does not 404.
func (h *DraftsHandler) GetDraftSummary(w http.ResponseWriter, _ *http.Request) {
	apiutils.WriteJSON(w, http.StatusOK, draftSummaryResponse{
		Sandboxes:    []any{},
		TotalPending: 0,
	})
}

// GetDraftPolicy returns the draft-policy inbox for a sandbox. Optional
// ?status=pending|approved|rejected filter.
func (h *DraftsHandler) GetDraftPolicy(w http.ResponseWriter, r *http.Request) {
	var opts []openshell.GetDraftOption
	if status := r.URL.Query().Get("status"); status != "" {
		opts = append(opts, openshell.WithStatusFilter(status))
	}
	draft, err := h.svc.GetDraft(r.Context(), r.PathValue("workspace"), r.PathValue("name"), opts...)
	if err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	apiutils.WriteJSON(w, http.StatusOK, models.FromSDKDraftPolicy(draft))
}

// ApproveDraftChunk merges one proposed rule into the active policy.
func (h *DraftsHandler) ApproveDraftChunk(w http.ResponseWriter, r *http.Request) {
	workspace := r.PathValue("workspace")
	name := r.PathValue("name")
	chunkID := r.PathValue("chunk")

	var body ApproveDraftChunkRequest
	if r.ContentLength > 0 && !apiutils.DecodeBody(w, r, &body) {
		return
	}

	// The gateway binds each approval to a review_token that pins the exact
	// evaluated candidate (optimistic concurrency). Use the token the client
	// already has; only fall back to a GetDraft round-trip when it didn't send
	// one. Older gateways return an empty token, which the RPC accepts.
	reviewToken := body.ReviewToken
	if reviewToken == "" {
		var err error
		reviewToken, err = h.resolveDraftReviewToken(r.Context(), workspace, name, chunkID)
		if err != nil {
			apiutils.WriteSDKError(w, err)
			return
		}
	}

	result, err := h.svc.ApproveDraftChunk(r.Context(), workspace, name, chunkID, reviewToken)
	if err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	apiutils.WriteJSON(w, http.StatusOK, models.PolicyUpdateResult{
		Version:    result.PolicyVersion,
		PolicyHash: result.PolicyHash,
	})
}

// resolveDraftReviewToken returns the review token bound to the given draft
// chunk, or an empty string if the chunk carries none. The token pins an
// approval to the exact candidate the gateway last evaluated.
func (h *DraftsHandler) resolveDraftReviewToken(ctx context.Context, workspace, name, chunkID string) (string, error) {
	draft, err := h.svc.GetDraft(ctx, workspace, name)
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

// RejectDraftChunk rejects one proposed rule.
func (h *DraftsHandler) RejectDraftChunk(w http.ResponseWriter, r *http.Request) {
	var body RejectDraftChunkRequest
	if r.ContentLength > 0 && !apiutils.DecodeBody(w, r, &body) {
		return
	}
	if err := h.svc.RejectDraftChunk(r.Context(), r.PathValue("workspace"), r.PathValue("name"), r.PathValue("chunk"), body.Reason); err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	apiutils.WriteJSON(w, http.StatusOK, map[string]bool{"rejected": true})
}

// ApproveAllDraftChunksRequest mirrors the include_security_flagged option.
type ApproveAllDraftChunksRequest struct {
	IncludeSecurityFlagged bool `json:"includeSecurityFlagged,omitempty"`
}

// ApproveAllDraftChunks approves all pending chunks (security-flagged ones
// are skipped unless explicitly included).
func (h *DraftsHandler) ApproveAllDraftChunks(w http.ResponseWriter, r *http.Request) {
	var body ApproveAllDraftChunksRequest
	if r.ContentLength > 0 && !apiutils.DecodeBody(w, r, &body) {
		return
	}
	var opts []openshell.ApproveAllOption
	if body.IncludeSecurityFlagged {
		opts = append(opts, openshell.WithIncludeSecurityFlagged())
	}
	result, err := h.svc.ApproveAllDraftChunks(r.Context(), r.PathValue("workspace"), r.PathValue("name"), opts...)
	if err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	apiutils.WriteJSON(w, http.StatusOK, map[string]any{
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
func (h *DraftsHandler) EditDraftChunk(w http.ResponseWriter, r *http.Request) {
	var body EditDraftChunkRequest
	if !apiutils.DecodeBody(w, r, &body) {
		return
	}
	if len(body.ProposedRule) == 0 {
		apiutils.WriteError(w, http.StatusBadRequest, "invalid_rule", "proposedRule is required")
		return
	}
	rule, err := models.ParseSDKNetworkPolicyRule(body.ProposedRule)
	if err != nil {
		slog.Error("invalid network policy rule", "error", err)
		apiutils.WriteError(w, http.StatusBadRequest, "invalid_rule", "proposedRule does not match NetworkPolicyRule schema: "+err.Error())
		return
	}
	if err := h.svc.EditDraftChunk(r.Context(), r.PathValue("workspace"), r.PathValue("name"), r.PathValue("chunk"), rule); err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	apiutils.WriteJSON(w, http.StatusOK, map[string]bool{"edited": true})
}

// UndoDraftChunk reverts an already-approved chunk, removing its rule from the
// active policy.
func (h *DraftsHandler) UndoDraftChunk(w http.ResponseWriter, r *http.Request) {
	result, err := h.svc.UndoDraftChunk(r.Context(), r.PathValue("workspace"), r.PathValue("name"), r.PathValue("chunk"))
	if err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	apiutils.WriteJSON(w, http.StatusOK, models.PolicyUpdateResult{
		Version:    result.PolicyVersion,
		PolicyHash: result.PolicyHash,
	})
}

// ClearDraftChunks removes all pending draft chunks for a sandbox.
func (h *DraftsHandler) ClearDraftChunks(w http.ResponseWriter, r *http.Request) {
	result, err := h.svc.ClearDraftChunks(r.Context(), r.PathValue("workspace"), r.PathValue("name"))
	if err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	apiutils.WriteJSON(w, http.StatusOK, map[string]any{
		"chunksCleared": result.ChunksCleared,
	})
}

// GetDraftHistory returns the chronological decision history for a sandbox's
// draft policy.
func (h *DraftsHandler) GetDraftHistory(w http.ResponseWriter, r *http.Request) {
	entries, err := h.svc.GetDraftHistory(r.Context(), r.PathValue("workspace"), r.PathValue("name"))
	if err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	apiutils.WriteJSON(w, http.StatusOK, models.FromSDKDraftHistory(entries))
}
