package gateway

import (
	"context"
	"io"

	openshellv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/openshellv1"
)

// CreateSandbox creates a sandbox. spec.policy is required by the gateway.
func (c *Client) CreateSandbox(ctx context.Context, workspace, name string, spec *openshellv1.SandboxSpec, labels, annotations map[string]string) (*openshellv1.Sandbox, error) {
	resp, err := c.openshell.CreateSandbox(ctx, &openshellv1.CreateSandboxRequest{
		Spec:        spec,
		Name:        name,
		Labels:      labels,
		Annotations: annotations,
		Workspace:   workspace,
	})
	if err != nil {
		return nil, err
	}
	return resp.Sandbox, nil
}

// GetSandbox fetches a sandbox by name within a workspace.
func (c *Client) GetSandbox(ctx context.Context, workspace, name string) (*openshellv1.Sandbox, error) {
	resp, err := c.openshell.GetSandbox(ctx, &openshellv1.GetSandboxRequest{
		Name:      name,
		Workspace: workspace,
	})
	if err != nil {
		return nil, err
	}
	return resp.Sandbox, nil
}

// ListSandboxes lists sandboxes in a workspace.
func (c *Client) ListSandboxes(ctx context.Context, workspace string, limit, offset uint32, labelSelector string) ([]*openshellv1.Sandbox, error) {
	resp, err := c.openshell.ListSandboxes(ctx, &openshellv1.ListSandboxesRequest{
		Limit:         limit,
		Offset:        offset,
		LabelSelector: labelSelector,
		Workspace:     workspace,
	})
	if err != nil {
		return nil, err
	}
	return resp.Sandboxes, nil
}

// ExecSandbox runs a non-interactive command inside a sandbox and collects the
// streamed stdout/stderr/exit. Uses sandbox_id (not name).
func (c *Client) ExecSandbox(ctx context.Context, sandboxID string, command []string, stdin []byte, workdir string, timeoutSeconds uint32) ([]byte, []byte, int32, error) {
	stream, err := c.openshell.ExecSandbox(ctx, &openshellv1.ExecSandboxRequest{
		SandboxId:      sandboxID,
		Command:        command,
		Stdin:          stdin,
		Workdir:        workdir,
		TimeoutSeconds: timeoutSeconds,
	})
	if err != nil {
		return nil, nil, -1, err
	}

	var stdout, stderr []byte
	var exitCode int32 = -1
	for {
		event, err := stream.Recv()
		if err != nil {
			if err == io.EOF {
				break
			}
			return stdout, stderr, exitCode, err
		}
		switch p := event.Payload.(type) {
		case *openshellv1.ExecSandboxEvent_Stdout:
			stdout = append(stdout, p.Stdout.Data...)
		case *openshellv1.ExecSandboxEvent_Stderr:
			stderr = append(stderr, p.Stderr.Data...)
		case *openshellv1.ExecSandboxEvent_Exit:
			exitCode = p.Exit.ExitCode
		}
	}
	return stdout, stderr, exitCode, nil
}

// DeleteSandbox deletes a sandbox by name. This is the only lifecycle
// operation besides create — the gateway API has no stop/start.
func (c *Client) DeleteSandbox(ctx context.Context, workspace, name string) (bool, error) {
	resp, err := c.openshell.DeleteSandbox(ctx, &openshellv1.DeleteSandboxRequest{
		Name:      name,
		Workspace: workspace,
	})
	if err != nil {
		return false, err
	}
	return resp.Deleted, nil
}
