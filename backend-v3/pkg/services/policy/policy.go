// Package policy is the business-logic layer for sandbox network policy
// management through a draft/review/approval workflow. Mirrors the SDK's
// PolicyInterface (client.Policy()) --
// https://ro14nd.de/openshell-sdk-go/api/policy.html.
package policy

import (
	"context"

	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/clients/openshell"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/models"
)

// Service is the contract PolicyHandler depends on.
//
// ListRevisions is workspace-scoped rather than sandbox-scoped, matching
// the upstream SDK's PolicyInterface.List(ctx, workspace, ...) signature.
type Service interface {
	GetDraft(ctx context.Context, workspace, sandboxName string) (*models.DraftPolicy, error)
	ApproveDraftChunk(ctx context.Context, workspace, sandboxName, chunkID string) (*models.ApproveResult, error)
	RejectDraftChunk(ctx context.Context, workspace, sandboxName, chunkID, reason string) error
	ApproveAllDraftChunks(ctx context.Context, workspace, sandboxName string) (*models.ApproveAllResult, error)
	ClearDraftChunks(ctx context.Context, workspace, sandboxName string) (*models.ClearResult, error)
	GetDraftHistory(ctx context.Context, workspace, sandboxName string) ([]models.DraftHistoryEntry, error)
	GetStatus(ctx context.Context, workspace, sandboxName string) (*models.PolicyStatusResult, error)
	ListRevisions(ctx context.Context, workspace string) ([]models.SandboxPolicyRevision, error)
	EditDraftChunk(ctx context.Context, workspace, sandboxName, chunkID string, proposedRule *models.NetworkPolicyRule) error
	UndoDraftChunk(ctx context.Context, workspace, sandboxName, chunkID string) (*models.UndoResult, error)
}

type service struct {
	clients openshell.Factory
}

// NewService builds the default upstream implementation.
func NewService(clients openshell.Factory) Service {
	return &service{clients: clients}
}

func (s *service) GetDraft(ctx context.Context, workspace, sandboxName string) (*models.DraftPolicy, error) {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return nil, err
	}
	return client.GetPolicyDraft(ctx, workspace, sandboxName)
}

func (s *service) ApproveDraftChunk(ctx context.Context, workspace, sandboxName, chunkID string) (*models.ApproveResult, error) {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return nil, err
	}
	return client.ApprovePolicyDraftChunk(ctx, workspace, sandboxName, chunkID)
}

func (s *service) RejectDraftChunk(ctx context.Context, workspace, sandboxName, chunkID, reason string) error {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return err
	}
	return client.RejectPolicyDraftChunk(ctx, workspace, sandboxName, chunkID, reason)
}

func (s *service) ApproveAllDraftChunks(ctx context.Context, workspace, sandboxName string) (*models.ApproveAllResult, error) {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return nil, err
	}
	return client.ApproveAllPolicyDraftChunks(ctx, workspace, sandboxName)
}

func (s *service) ClearDraftChunks(ctx context.Context, workspace, sandboxName string) (*models.ClearResult, error) {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return nil, err
	}
	return client.ClearPolicyDraftChunks(ctx, workspace, sandboxName)
}

func (s *service) GetDraftHistory(ctx context.Context, workspace, sandboxName string) ([]models.DraftHistoryEntry, error) {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return nil, err
	}
	return client.GetPolicyDraftHistory(ctx, workspace, sandboxName)
}

func (s *service) GetStatus(ctx context.Context, workspace, sandboxName string) (*models.PolicyStatusResult, error) {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return nil, err
	}
	return client.GetPolicyStatus(ctx, workspace, sandboxName)
}

func (s *service) ListRevisions(ctx context.Context, workspace string) ([]models.SandboxPolicyRevision, error) {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return nil, err
	}
	return client.ListPolicyRevisions(ctx, workspace)
}

func (s *service) EditDraftChunk(ctx context.Context, workspace, sandboxName, chunkID string, proposedRule *models.NetworkPolicyRule) error {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return err
	}
	return client.EditPolicyDraftChunk(ctx, workspace, sandboxName, chunkID, proposedRule)
}

func (s *service) UndoDraftChunk(ctx context.Context, workspace, sandboxName, chunkID string) (*models.UndoResult, error) {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return nil, err
	}
	return client.UndoPolicyDraftChunk(ctx, workspace, sandboxName, chunkID)
}
