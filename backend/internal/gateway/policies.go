package gateway

import (
	"context"

	openshellv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/openshellv1"
	sandboxv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/sandboxv1"
)

// UpdateSandboxPolicy replaces a sandbox's policy via UpdateConfig. Only
// network_policies and inference fields may differ from the create-time
// policy — filesystem/landlock/process are immutable and must match version 1.
func (c *Client) UpdateSandboxPolicy(ctx context.Context, workspace, name string, policy *sandboxv1.SandboxPolicy, expectedResourceVersion uint64) (*openshellv1.UpdateConfigResponse, error) {
	return c.openshell.UpdateConfig(ctx, &openshellv1.UpdateConfigRequest{
		Name:                    name,
		Policy:                  policy,
		ExpectedResourceVersion: expectedResourceVersion,
		Workspace:               workspace,
	})
}

// SetGlobalPolicy applies a gateway-global policy to all sandboxes (no
// merge). Platform Admin operation.
func (c *Client) SetGlobalPolicy(ctx context.Context, policy *sandboxv1.SandboxPolicy) (*openshellv1.UpdateConfigResponse, error) {
	return c.openshell.UpdateConfig(ctx, &openshellv1.UpdateConfigRequest{
		Policy: policy,
		Global: true,
	})
}

// DeleteGlobalPolicy removes the gateway-global policy lock, restoring
// sandbox-level policy control.
func (c *Client) DeleteGlobalPolicy(ctx context.Context) error {
	_, err := c.openshell.UpdateConfig(ctx, &openshellv1.UpdateConfigRequest{
		Global:        true,
		DeleteSetting: true,
		SettingKey:    "policy",
	})
	return err
}

// GetSandboxPolicyStatus fetches one policy revision and the active version.
// version 0 means latest. global=true queries global revisions (name ignored).
func (c *Client) GetSandboxPolicyStatus(ctx context.Context, workspace, name string, version uint32, global bool) (*openshellv1.GetSandboxPolicyStatusResponse, error) {
	return c.openshell.GetSandboxPolicyStatus(ctx, &openshellv1.GetSandboxPolicyStatusRequest{
		Name:      name,
		Version:   version,
		Global:    global,
		Workspace: workspace,
	})
}

// ListSandboxPolicies lists policy revision history for a sandbox, or the
// global policy revisions when global=true.
func (c *Client) ListSandboxPolicies(ctx context.Context, workspace, name string, limit, offset uint32, global bool) (*openshellv1.ListSandboxPoliciesResponse, error) {
	return c.openshell.ListSandboxPolicies(ctx, &openshellv1.ListSandboxPoliciesRequest{
		Name:      name,
		Limit:     limit,
		Offset:    offset,
		Global:    global,
		Workspace: workspace,
	})
}

// GetDraftPolicy fetches draft policy recommendations for a sandbox.
// statusFilter is "pending", "approved", "rejected", or "" for all.
func (c *Client) GetDraftPolicy(ctx context.Context, workspace, name, statusFilter string) (*openshellv1.GetDraftPolicyResponse, error) {
	return c.openshell.GetDraftPolicy(ctx, &openshellv1.GetDraftPolicyRequest{
		Name:         name,
		StatusFilter: statusFilter,
		Workspace:    workspace,
	})
}

// ApproveDraftChunk merges one draft chunk into the active policy.
func (c *Client) ApproveDraftChunk(ctx context.Context, workspace, name, chunkID string) (*openshellv1.ApproveDraftChunkResponse, error) {
	return c.openshell.ApproveDraftChunk(ctx, &openshellv1.ApproveDraftChunkRequest{
		Name:      name,
		ChunkId:   chunkID,
		Workspace: workspace,
	})
}

// RejectDraftChunk rejects one draft chunk; the optional reason is surfaced
// back to the in-sandbox agent.
func (c *Client) RejectDraftChunk(ctx context.Context, workspace, name, chunkID, reason string) (*openshellv1.RejectDraftChunkResponse, error) {
	return c.openshell.RejectDraftChunk(ctx, &openshellv1.RejectDraftChunkRequest{
		Name:      name,
		ChunkId:   chunkID,
		Reason:    reason,
		Workspace: workspace,
	})
}

// ApproveAllDraftChunks approves all pending chunks; security-flagged chunks
// are skipped unless includeSecurityFlagged is set.
func (c *Client) ApproveAllDraftChunks(ctx context.Context, workspace, name string, includeSecurityFlagged bool) (*openshellv1.ApproveAllDraftChunksResponse, error) {
	return c.openshell.ApproveAllDraftChunks(ctx, &openshellv1.ApproveAllDraftChunksRequest{
		Name:                   name,
		IncludeSecurityFlagged: includeSecurityFlagged,
		Workspace:              workspace,
	})
}

func (c *Client) GetGatewaySettings(ctx context.Context) (*sandboxv1.GetGatewayConfigResponse, error) {
	return c.openshell.GetGatewayConfig(ctx, &sandboxv1.GetGatewayConfigRequest{})
}

func (c *Client) SetSetting(ctx context.Context, key, value string) error {
	_, err := c.openshell.UpdateConfig(ctx, &openshellv1.UpdateConfigRequest{
		SettingKey:   key,
		SettingValue: &sandboxv1.SettingValue{Value: &sandboxv1.SettingValue_StringValue{StringValue: value}},
		Global:       true,
	})
	return err
}

func (c *Client) DeleteSetting(ctx context.Context, key string) error {
	_, err := c.openshell.UpdateConfig(ctx, &openshellv1.UpdateConfigRequest{
		SettingKey:    key,
		DeleteSetting: true,
		Global:        true,
	})
	return err
}

func (c *Client) EditDraftChunk(ctx context.Context, workspace, name, chunkID string, proposedRule *sandboxv1.NetworkPolicyRule) error {
	_, err := c.openshell.EditDraftChunk(ctx, &openshellv1.EditDraftChunkRequest{
		Name:         name,
		ChunkId:      chunkID,
		ProposedRule: proposedRule,
		Workspace:    workspace,
	})
	return err
}

func (c *Client) UndoDraftChunk(ctx context.Context, workspace, name, chunkID string) (*openshellv1.UndoDraftChunkResponse, error) {
	return c.openshell.UndoDraftChunk(ctx, &openshellv1.UndoDraftChunkRequest{
		Name:      name,
		ChunkId:   chunkID,
		Workspace: workspace,
	})
}

func (c *Client) ClearDraftChunks(ctx context.Context, workspace, name string) (*openshellv1.ClearDraftChunksResponse, error) {
	return c.openshell.ClearDraftChunks(ctx, &openshellv1.ClearDraftChunksRequest{
		Name:      name,
		Workspace: workspace,
	})
}

func (c *Client) GetDraftHistory(ctx context.Context, workspace, name string) (*openshellv1.GetDraftHistoryResponse, error) {
	return c.openshell.GetDraftHistory(ctx, &openshellv1.GetDraftHistoryRequest{
		Name:      name,
		Workspace: workspace,
	})
}
