package api

import (
	"context"

	openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"
)

// mockSDK is a minimal mock of openshell.ClientInterface for testing.
// Only the Sandboxes() sub-client is wired; other sub-clients panic if called.
type mockSDK struct {
	sandboxes mockSDKSandboxes
}

func (m *mockSDK) Sandboxes() openshell.SandboxInterface  { return &m.sandboxes }
func (m *mockSDK) Providers() openshell.ProviderInterface  { panic("not implemented") }
func (m *mockSDK) Services() openshell.ServiceInterface    { panic("not implemented") }
func (m *mockSDK) Exec() openshell.ExecInterface           { panic("not implemented") }
func (m *mockSDK) Files() openshell.FileInterface          { panic("not implemented") }
func (m *mockSDK) Health() openshell.HealthInterface       { panic("not implemented") }
func (m *mockSDK) SSH() openshell.SSHInterface             { panic("not implemented") }
func (m *mockSDK) TCP() openshell.TCPInterface             { panic("not implemented") }
func (m *mockSDK) Config() openshell.ConfigInterface       { panic("not implemented") }
func (m *mockSDK) Policy() openshell.PolicyInterface       { panic("not implemented") }
func (m *mockSDK) Workspaces() openshell.WorkspaceInterface { panic("not implemented") }
func (m *mockSDK) Inference() openshell.InferenceInterface { panic("not implemented") }
func (m *mockSDK) Close() error                            { return nil }

// mockSDKSandboxes provides injectable sandbox operations.
type mockSDKSandboxes struct {
	listFn   func(ctx context.Context, workspace string, opts ...openshell.ListOptions) ([]*openshell.Sandbox, error)
	createFn func(ctx context.Context, workspace, name string, spec *openshell.SandboxSpec, labels map[string]string, opts ...openshell.CreateOptions) (*openshell.Sandbox, error)
	getFn    func(ctx context.Context, workspace, name string) (*openshell.Sandbox, error)
	deleteFn func(ctx context.Context, workspace, name string) error
}

func (m *mockSDKSandboxes) List(ctx context.Context, workspace string, opts ...openshell.ListOptions) ([]*openshell.Sandbox, error) {
	if m.listFn != nil {
		return m.listFn(ctx, workspace, opts...)
	}
	return nil, nil
}

func (m *mockSDKSandboxes) Create(ctx context.Context, workspace, name string, spec *openshell.SandboxSpec, labels map[string]string, opts ...openshell.CreateOptions) (*openshell.Sandbox, error) {
	if m.createFn != nil {
		return m.createFn(ctx, workspace, name, spec, labels, opts...)
	}
	return &openshell.Sandbox{Name: name}, nil
}

func (m *mockSDKSandboxes) Get(ctx context.Context, workspace, name string) (*openshell.Sandbox, error) {
	if m.getFn != nil {
		return m.getFn(ctx, workspace, name)
	}
	return &openshell.Sandbox{Name: name}, nil
}

func (m *mockSDKSandboxes) Delete(ctx context.Context, workspace, name string) error {
	if m.deleteFn != nil {
		return m.deleteFn(ctx, workspace, name)
	}
	return nil
}

func (m *mockSDKSandboxes) AttachProvider(_ context.Context, _, _, _ string, _ uint64) (*openshell.AttachProviderResult, error) {
	panic("not implemented")
}

func (m *mockSDKSandboxes) DetachProvider(_ context.Context, _, _, _ string, _ uint64) (*openshell.DetachProviderResult, error) {
	panic("not implemented")
}

func (m *mockSDKSandboxes) ListProviders(_ context.Context, _, _ string) ([]*openshell.Provider, error) {
	panic("not implemented")
}

func (m *mockSDKSandboxes) Watch(_ context.Context, _, _ string, _ ...openshell.WatchOptions) (openshell.WatchInterface[*openshell.Sandbox], error) {
	panic("not implemented")
}

func (m *mockSDKSandboxes) WaitReady(_ context.Context, _, _ string, _ ...openshell.WaitOptions) (*openshell.Sandbox, error) {
	panic("not implemented")
}

func (m *mockSDKSandboxes) WaitDeleted(_ context.Context, _, _ string, _ ...openshell.WaitOptions) error {
	panic("not implemented")
}

func (m *mockSDKSandboxes) GetLogs(_ context.Context, _, _ string, _ ...openshell.LogOption) (*openshell.LogResult, error) {
	panic("not implemented")
}

func (m *mockSDKSandboxes) Start(_ context.Context, _, _ string) (*openshell.Sandbox, error) {
	panic("not implemented")
}

func (m *mockSDKSandboxes) Stop(_ context.Context, _, _ string) (*openshell.Sandbox, error) {
	panic("not implemented")
}

func (m *mockSDKSandboxes) WaitStopped(_ context.Context, _, _ string, _ ...openshell.WaitOptions) (*openshell.Sandbox, error) {
	panic("not implemented")
}
