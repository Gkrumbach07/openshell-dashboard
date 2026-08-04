package gateway

import (
	"context"
	"fmt"

	openshellv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/openshellv1"
	sandboxv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/sandboxv1"
)

// UpdateSandboxPolicy replaces a sandbox's policy via UpdateConfig. Only
// network_policies and inference fields may differ from the create-time
// policy — filesystem/landlock/process are immutable and must match version 1.
func (c *Client) UpdateSandboxPolicy(ctx context.Context, workspace, name string, policy *sandboxv1.SandboxPolicy, expectedResourceVersion uint64) (*openshellv1.UpdateConfigResponse, error) {
	resp, err := c.openshell.UpdateConfig(ctx, &openshellv1.UpdateConfigRequest{
		Name:                    name,
		Policy:                  policy,
		ExpectedResourceVersion: expectedResourceVersion,
		Workspace:               workspace,
	})
	if err != nil {
		return nil, fmt.Errorf("update sandbox policy %q in workspace %q: %w", name, workspace, err)
	}
	return resp, nil
}

// SetGlobalPolicy applies a gateway-global policy to all sandboxes (no
// merge). Platform Admin operation.
func (c *Client) SetGlobalPolicy(ctx context.Context, policy *sandboxv1.SandboxPolicy) (*openshellv1.UpdateConfigResponse, error) {
	resp, err := c.openshell.UpdateConfig(ctx, &openshellv1.UpdateConfigRequest{
		Policy: policy,
		Global: true,
	})
	if err != nil {
		return nil, fmt.Errorf("set global policy: %w", err)
	}
	return resp, nil
}

// DeleteGlobalPolicy removes the gateway-global policy lock, restoring
// sandbox-level policy control.
func (c *Client) DeleteGlobalPolicy(ctx context.Context) error {
	_, err := c.openshell.UpdateConfig(ctx, &openshellv1.UpdateConfigRequest{
		Global:        true,
		DeleteSetting: true,
		SettingKey:    "policy",
	})
	if err != nil {
		return fmt.Errorf("delete global policy: %w", err)
	}
	return nil
}

// GetSandboxPolicyStatus fetches one policy revision and the active version.
// version 0 means latest. global=true queries global revisions (name ignored).
func (c *Client) GetSandboxPolicyStatus(ctx context.Context, workspace, name string, version uint32, global bool) (*openshellv1.GetSandboxPolicyStatusResponse, error) {
	resp, err := c.openshell.GetSandboxPolicyStatus(ctx, &openshellv1.GetSandboxPolicyStatusRequest{
		Name:      name,
		Version:   version,
		Global:    global,
		Workspace: workspace,
	})
	if err != nil {
		return nil, fmt.Errorf("get sandbox policy status %q in workspace %q: %w", name, workspace, err)
	}
	return resp, nil
}

// ListSandboxPolicies lists policy revision history for a sandbox, or the
// global policy revisions when global=true.
func (c *Client) ListSandboxPolicies(ctx context.Context, workspace, name string, limit, offset uint32, global bool) (*openshellv1.ListSandboxPoliciesResponse, error) {
	resp, err := c.openshell.ListSandboxPolicies(ctx, &openshellv1.ListSandboxPoliciesRequest{
		Name:      name,
		Limit:     limit,
		Offset:    offset,
		Global:    global,
		Workspace: workspace,
	})
	if err != nil {
		return nil, fmt.Errorf("list sandbox policies %q in workspace %q: %w", name, workspace, err)
	}
	return resp, nil
}

// GetDraftPolicy fetches draft policy recommendations for a sandbox.
// statusFilter is "pending", "approved", "rejected", or "" for all.
func (c *Client) GetDraftPolicy(ctx context.Context, workspace, name, statusFilter string) (*openshellv1.GetDraftPolicyResponse, error) {
	resp, err := c.openshell.GetDraftPolicy(ctx, &openshellv1.GetDraftPolicyRequest{
		Name:         name,
		StatusFilter: statusFilter,
		Workspace:    workspace,
	})
	if err != nil {
		return nil, fmt.Errorf("get draft policy for sandbox %q in workspace %q: %w", name, workspace, err)
	}
	return resp, nil
}

// ApproveDraftChunk merges one draft chunk into the active policy.
func (c *Client) ApproveDraftChunk(ctx context.Context, workspace, name, chunkID string) (*openshellv1.ApproveDraftChunkResponse, error) {
	resp, err := c.openshell.ApproveDraftChunk(ctx, &openshellv1.ApproveDraftChunkRequest{
		Name:      name,
		ChunkId:   chunkID,
		Workspace: workspace,
	})
	if err != nil {
		return nil, fmt.Errorf("approve draft chunk %q for sandbox %q: %w", chunkID, name, err)
	}
	return resp, nil
}

// RejectDraftChunk rejects one draft chunk; the optional reason is surfaced
// back to the in-sandbox agent.
func (c *Client) RejectDraftChunk(ctx context.Context, workspace, name, chunkID, reason string) (*openshellv1.RejectDraftChunkResponse, error) {
	resp, err := c.openshell.RejectDraftChunk(ctx, &openshellv1.RejectDraftChunkRequest{
		Name:      name,
		ChunkId:   chunkID,
		Reason:    reason,
		Workspace: workspace,
	})
	if err != nil {
		return nil, fmt.Errorf("reject draft chunk %q for sandbox %q: %w", chunkID, name, err)
	}
	return resp, nil
}

// ApproveAllDraftChunks approves all pending chunks; security-flagged chunks
// are skipped unless includeSecurityFlagged is set.
func (c *Client) ApproveAllDraftChunks(ctx context.Context, workspace, name string, includeSecurityFlagged bool) (*openshellv1.ApproveAllDraftChunksResponse, error) {
	resp, err := c.openshell.ApproveAllDraftChunks(ctx, &openshellv1.ApproveAllDraftChunksRequest{
		Name:                   name,
		IncludeSecurityFlagged: includeSecurityFlagged,
		Workspace:              workspace,
	})
	if err != nil {
		return nil, fmt.Errorf("approve all draft chunks for sandbox %q in workspace %q: %w", name, workspace, err)
	}
	return resp, nil
}

func (c *Client) GetGatewaySettings(ctx context.Context) (*sandboxv1.GetGatewayConfigResponse, error) {
	resp, err := c.openshell.GetGatewayConfig(ctx, &sandboxv1.GetGatewayConfigRequest{})
	if err != nil {
		return nil, fmt.Errorf("get gateway settings: %w", err)
	}
	return resp, nil
}

func (c *Client) SetSetting(ctx context.Context, key, value string) error {
	_, err := c.openshell.UpdateConfig(ctx, &openshellv1.UpdateConfigRequest{
		SettingKey:   key,
		SettingValue: &sandboxv1.SettingValue{Value: &sandboxv1.SettingValue_StringValue{StringValue: value}},
		Global:       true,
	})
	if err != nil {
		return fmt.Errorf("set setting %q: %w", key, err)
	}
	return nil
}

func (c *Client) DeleteSetting(ctx context.Context, key string) error {
	_, err := c.openshell.UpdateConfig(ctx, &openshellv1.UpdateConfigRequest{
		SettingKey:    key,
		DeleteSetting: true,
		Global:        true,
	})
	if err != nil {
		return fmt.Errorf("delete setting %q: %w", key, err)
	}
	return nil
}

func (c *Client) EditDraftChunk(ctx context.Context, workspace, name, chunkID string, proposedRule *sandboxv1.NetworkPolicyRule) error {
	_, err := c.openshell.EditDraftChunk(ctx, &openshellv1.EditDraftChunkRequest{
		Name:         name,
		ChunkId:      chunkID,
		ProposedRule: proposedRule,
		Workspace:    workspace,
	})
	if err != nil {
		return fmt.Errorf("edit draft chunk %q for sandbox %q: %w", chunkID, name, err)
	}
	return nil
}

func (c *Client) UndoDraftChunk(ctx context.Context, workspace, name, chunkID string) (*openshellv1.UndoDraftChunkResponse, error) {
	resp, err := c.openshell.UndoDraftChunk(ctx, &openshellv1.UndoDraftChunkRequest{
		Name:      name,
		ChunkId:   chunkID,
		Workspace: workspace,
	})
	if err != nil {
		return nil, fmt.Errorf("undo draft chunk %q for sandbox %q: %w", chunkID, name, err)
	}
	return resp, nil
}

func (c *Client) ClearDraftChunks(ctx context.Context, workspace, name string) (*openshellv1.ClearDraftChunksResponse, error) {
	resp, err := c.openshell.ClearDraftChunks(ctx, &openshellv1.ClearDraftChunksRequest{
		Name:      name,
		Workspace: workspace,
	})
	if err != nil {
		return nil, fmt.Errorf("clear draft chunks for sandbox %q in workspace %q: %w", name, workspace, err)
	}
	return resp, nil
}

func (c *Client) GetDraftHistory(ctx context.Context, workspace, name string) (*openshellv1.GetDraftHistoryResponse, error) {
	resp, err := c.openshell.GetDraftHistory(ctx, &openshellv1.GetDraftHistoryRequest{
		Name:      name,
		Workspace: workspace,
	})
	if err != nil {
		return nil, fmt.Errorf("get draft history for sandbox %q in workspace %q: %w", name, workspace, err)
	}
	return resp, nil
}
