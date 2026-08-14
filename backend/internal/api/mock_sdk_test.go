package api

import (
	"context"

	openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"
)

// mockSDK is a mock of openshell.ClientInterface for testing.
// Sandboxes() and Providers() are wired; other sub-clients panic if called.
type mockSDK struct {
	sandboxes mockSDKSandboxes
	providers mockSDKProviders
}

func (m *mockSDK) Sandboxes() openshell.SandboxInterface    { return &m.sandboxes }
func (m *mockSDK) Providers() openshell.ProviderInterface   { return &m.providers }
func (m *mockSDK) Services() openshell.ServiceInterface     { panic("not implemented") }
func (m *mockSDK) Exec() openshell.ExecInterface            { panic("not implemented") }
func (m *mockSDK) Files() openshell.FileInterface           { panic("not implemented") }
func (m *mockSDK) Health() openshell.HealthInterface        { panic("not implemented") }
func (m *mockSDK) SSH() openshell.SSHInterface              { panic("not implemented") }
func (m *mockSDK) TCP() openshell.TCPInterface              { panic("not implemented") }
func (m *mockSDK) Config() openshell.ConfigInterface        { panic("not implemented") }
func (m *mockSDK) Policy() openshell.PolicyInterface        { panic("not implemented") }
func (m *mockSDK) Workspaces() openshell.WorkspaceInterface { panic("not implemented") }
func (m *mockSDK) Inference() openshell.InferenceInterface  { panic("not implemented") }
func (m *mockSDK) Close() error                             { return nil }

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

type mockSDKProviders struct {
	createFn func(ctx context.Context, workspace string, provider *openshell.Provider) (*openshell.Provider, error)
	getFn    func(ctx context.Context, workspace, name string) (*openshell.Provider, error)
	listFn   func(ctx context.Context, workspace string, opts ...openshell.ListOptions) ([]*openshell.Provider, error)
	updateFn func(ctx context.Context, workspace string, provider *openshell.Provider) (*openshell.Provider, error)
	deleteFn func(ctx context.Context, workspace, name string) error
	profiles mockSDKProfiles
	refresh  mockSDKRefresh
}

func (m *mockSDKProviders) Profiles() openshell.ProfileInterface { return &m.profiles }
func (m *mockSDKProviders) Refresh() openshell.RefreshInterface  { return &m.refresh }

func (m *mockSDKProviders) Create(ctx context.Context, workspace string, provider *openshell.Provider) (*openshell.Provider, error) {
	if m.createFn != nil {
		return m.createFn(ctx, workspace, provider)
	}
	if provider != nil {
		return provider, nil
	}
	return &openshell.Provider{}, nil
}

func (m *mockSDKProviders) Get(ctx context.Context, workspace, name string) (*openshell.Provider, error) {
	if m.getFn != nil {
		return m.getFn(ctx, workspace, name)
	}
	return &openshell.Provider{Name: name, Workspace: workspace}, nil
}

func (m *mockSDKProviders) List(ctx context.Context, workspace string, opts ...openshell.ListOptions) ([]*openshell.Provider, error) {
	if m.listFn != nil {
		return m.listFn(ctx, workspace, opts...)
	}
	return nil, nil
}

func (m *mockSDKProviders) Update(ctx context.Context, workspace string, provider *openshell.Provider) (*openshell.Provider, error) {
	if m.updateFn != nil {
		return m.updateFn(ctx, workspace, provider)
	}
	return provider, nil
}

func (m *mockSDKProviders) Delete(ctx context.Context, workspace, name string) error {
	if m.deleteFn != nil {
		return m.deleteFn(ctx, workspace, name)
	}
	return nil
}

func (m *mockSDKProviders) Ensure(_ context.Context, _ string, _ *openshell.Provider) (*openshell.Provider, error) {
	panic("not implemented")
}

type mockSDKRefresh struct {
	getStatusFn func(ctx context.Context, workspace, provider, credentialKey string) ([]*openshell.RefreshStatus, error)
	configureFn func(ctx context.Context, workspace string, config *openshell.RefreshConfig) (*openshell.RefreshStatus, error)
	rotateFn    func(ctx context.Context, workspace, provider, credentialKey string) (*openshell.RefreshStatus, error)
	deleteFn    func(ctx context.Context, workspace, provider, credentialKey string) (bool, error)
}

func (m *mockSDKRefresh) GetStatus(ctx context.Context, workspace, provider, credentialKey string) ([]*openshell.RefreshStatus, error) {
	if m.getStatusFn != nil {
		return m.getStatusFn(ctx, workspace, provider, credentialKey)
	}
	return nil, nil
}

func (m *mockSDKRefresh) Configure(ctx context.Context, workspace string, config *openshell.RefreshConfig) (*openshell.RefreshStatus, error) {
	if m.configureFn != nil {
		return m.configureFn(ctx, workspace, config)
	}
	return &openshell.RefreshStatus{CredentialKey: config.CredentialKey, Strategy: config.Strategy}, nil
}

func (m *mockSDKRefresh) Rotate(ctx context.Context, workspace, provider, credentialKey string) (*openshell.RefreshStatus, error) {
	if m.rotateFn != nil {
		return m.rotateFn(ctx, workspace, provider, credentialKey)
	}
	return &openshell.RefreshStatus{CredentialKey: credentialKey}, nil
}

func (m *mockSDKRefresh) Delete(ctx context.Context, workspace, provider, credentialKey string) (bool, error) {
	if m.deleteFn != nil {
		return m.deleteFn(ctx, workspace, provider, credentialKey)
	}
	return true, nil
}

type mockSDKProfiles struct {
	listFn   func(ctx context.Context, workspace string, opts ...openshell.ListOptions) ([]*openshell.ProviderProfile, error)
	getFn    func(ctx context.Context, workspace, id string) (*openshell.ProviderProfile, error)
	importFn func(ctx context.Context, workspace string, items []openshell.ProfileImportItem) (*openshell.ImportResult, error)
	updateFn func(ctx context.Context, workspace, id string, expectedResourceVersion uint64, item openshell.ProfileImportItem) (*openshell.UpdateResult, error)
	lintFn   func(ctx context.Context, workspace string, items []openshell.ProfileImportItem) (*openshell.LintResult, error)
	deleteFn func(ctx context.Context, workspace, id string) (bool, error)
}

func (m *mockSDKProfiles) List(ctx context.Context, workspace string, opts ...openshell.ListOptions) ([]*openshell.ProviderProfile, error) {
	if m.listFn != nil {
		return m.listFn(ctx, workspace, opts...)
	}
	return nil, nil
}

func (m *mockSDKProfiles) Get(ctx context.Context, workspace, id string) (*openshell.ProviderProfile, error) {
	if m.getFn != nil {
		return m.getFn(ctx, workspace, id)
	}
	return &openshell.ProviderProfile{ID: id}, nil
}

func (m *mockSDKProfiles) Import(ctx context.Context, workspace string, items []openshell.ProfileImportItem) (*openshell.ImportResult, error) {
	if m.importFn != nil {
		return m.importFn(ctx, workspace, items)
	}
	result := &openshell.ImportResult{Imported: true}
	for _, item := range items {
		result.Profiles = append(result.Profiles, item.Profile)
	}
	return result, nil
}

func (m *mockSDKProfiles) Update(ctx context.Context, workspace, id string, expectedResourceVersion uint64, item openshell.ProfileImportItem) (*openshell.UpdateResult, error) {
	if m.updateFn != nil {
		return m.updateFn(ctx, workspace, id, expectedResourceVersion, item)
	}
	profile := item.Profile
	return &openshell.UpdateResult{Updated: true, Profile: &profile}, nil
}

func (m *mockSDKProfiles) Lint(ctx context.Context, workspace string, items []openshell.ProfileImportItem) (*openshell.LintResult, error) {
	if m.lintFn != nil {
		return m.lintFn(ctx, workspace, items)
	}
	return &openshell.LintResult{Valid: true}, nil
}

func (m *mockSDKProfiles) Delete(ctx context.Context, workspace, id string) (bool, error) {
	if m.deleteFn != nil {
		return m.deleteFn(ctx, workspace, id)
	}
	return true, nil
}
