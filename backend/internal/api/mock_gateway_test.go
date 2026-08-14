package api

import (
	"context"

	datamodelv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/datamodelv1"
	inferencev1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/inferencev1"
	openshellv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/openshellv1"
	sandboxv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/sandboxv1"
)

// mockGateway implements gateway.Interface for handler tests.
// Each field is a function that the test can override to control behavior.
type mockGateway struct {
	healthFn                 func(ctx context.Context) (*openshellv1.HealthResponse, error)
	getGatewayInfoFn         func(ctx context.Context) (*openshellv1.GetGatewayInfoResponse, error)
	getCurrentUserFn         func(ctx context.Context) (*openshellv1.GetCurrentUserResponse, error)
	execSandboxInteractiveFn func(ctx context.Context) (openshellv1.OpenShell_ExecSandboxInteractiveClient, error)
	createSandboxFn          func(ctx context.Context, workspace, name string, spec *openshellv1.SandboxSpec, labels, annotations map[string]string) (*openshellv1.Sandbox, error)
	getSandboxFn             func(ctx context.Context, workspace, name string) (*openshellv1.Sandbox, error)
	listSandboxesFn          func(ctx context.Context, workspace string, limit, offset uint32, labelSelector string) ([]*openshellv1.Sandbox, error)
	execSandboxFn            func(ctx context.Context, sandboxID string, command []string, stdin []byte, workdir string, timeoutSeconds uint32) ([]byte, []byte, int32, error)
	deleteSandboxFn          func(ctx context.Context, workspace, name string) (bool, error)
	createWorkspaceFn        func(ctx context.Context, name string, labels map[string]string) (*datamodelv1.Workspace, error)
	getWorkspaceFn           func(ctx context.Context, name string) (*datamodelv1.Workspace, error)
	listWorkspacesFn         func(ctx context.Context, limit, offset uint32, labelSelector string) ([]*datamodelv1.Workspace, error)
	deleteWorkspaceFn        func(ctx context.Context, name string) (bool, error)
	addWorkspaceMemberFn     func(ctx context.Context, workspace, principalSubject string, role openshellv1.WorkspaceRole) (*openshellv1.WorkspaceMember, error)
	removeWorkspaceMemberFn  func(ctx context.Context, workspace, principalSubject string) (bool, error)
	listWorkspaceMembersFn   func(ctx context.Context, workspace string, limit, offset uint32) ([]*openshellv1.WorkspaceMember, error)
	updateSandboxPolicyFn    func(ctx context.Context, workspace, name string, policy *sandboxv1.SandboxPolicy, expectedResourceVersion uint64) (*openshellv1.UpdateConfigResponse, error)
	setGlobalPolicyFn        func(ctx context.Context, policy *sandboxv1.SandboxPolicy) (*openshellv1.UpdateConfigResponse, error)
	deleteGlobalPolicyFn     func(ctx context.Context) error
	getSandboxPolicyStatusFn func(ctx context.Context, workspace, name string, version uint32, global bool) (*openshellv1.GetSandboxPolicyStatusResponse, error)
	listSandboxPoliciesFn    func(ctx context.Context, workspace, name string, limit, offset uint32, global bool) (*openshellv1.ListSandboxPoliciesResponse, error)
	getDraftPolicyFn         func(ctx context.Context, workspace, name, statusFilter string) (*openshellv1.GetDraftPolicyResponse, error)
	approveDraftChunkFn      func(ctx context.Context, workspace, name, chunkID string) (*openshellv1.ApproveDraftChunkResponse, error)
	rejectDraftChunkFn       func(ctx context.Context, workspace, name, chunkID, reason string) (*openshellv1.RejectDraftChunkResponse, error)
	approveAllDraftChunksFn  func(ctx context.Context, workspace, name string, includeSecurityFlagged bool) (*openshellv1.ApproveAllDraftChunksResponse, error)
	getGatewaySettingsFn     func(ctx context.Context) (*sandboxv1.GetGatewayConfigResponse, error)
	setSettingFn             func(ctx context.Context, key, value string) error
	deleteSettingFn          func(ctx context.Context, key string) error
	editDraftChunkFn         func(ctx context.Context, workspace, name, chunkID string, proposedRule *sandboxv1.NetworkPolicyRule) error
	undoDraftChunkFn         func(ctx context.Context, workspace, name, chunkID string) (*openshellv1.UndoDraftChunkResponse, error)
	clearDraftChunksFn       func(ctx context.Context, workspace, name string) (*openshellv1.ClearDraftChunksResponse, error)
	getDraftHistoryFn        func(ctx context.Context, workspace, name string) (*openshellv1.GetDraftHistoryResponse, error)
	getSandboxLogsFn         func(ctx context.Context, workspace, sandboxID string, lines uint32, sinceMs int64, sources []string, minLevel string) (*openshellv1.GetSandboxLogsResponse, error)
	exposeServiceFn          func(ctx context.Context, workspace, sandbox, service string, targetPort uint32, domain bool) (*openshellv1.ServiceEndpointResponse, error)
	listServicesFn           func(ctx context.Context, workspace, sandbox string) ([]*openshellv1.ServiceEndpointResponse, error)
	deleteServiceFn          func(ctx context.Context, workspace, sandbox, service string) (bool, error)
	setInferenceRouteFn      func(ctx context.Context, workspace, routeName, providerName, modelID string, timeoutSecs uint64, noVerify bool) (*inferencev1.SetInferenceRouteResponse, error)
	getInferenceRouteFn      func(ctx context.Context, workspace, routeName string) (*inferencev1.GetInferenceRouteResponse, error)
	deleteInferenceRouteFn   func(ctx context.Context, workspace, routeName string) (*inferencev1.DeleteInferenceRouteResponse, error)
}

func (m *mockGateway) Health(ctx context.Context) (*openshellv1.HealthResponse, error) {
	return m.healthFn(ctx)
}
func (m *mockGateway) GetGatewayInfo(ctx context.Context) (*openshellv1.GetGatewayInfoResponse, error) {
	return m.getGatewayInfoFn(ctx)
}
func (m *mockGateway) GetCurrentUser(ctx context.Context) (*openshellv1.GetCurrentUserResponse, error) {
	return m.getCurrentUserFn(ctx)
}
func (m *mockGateway) ExecSandboxInteractive(ctx context.Context) (openshellv1.OpenShell_ExecSandboxInteractiveClient, error) {
	return m.execSandboxInteractiveFn(ctx)
}
func (m *mockGateway) CreateSandbox(ctx context.Context, workspace, name string, spec *openshellv1.SandboxSpec, labels, annotations map[string]string) (*openshellv1.Sandbox, error) {
	return m.createSandboxFn(ctx, workspace, name, spec, labels, annotations)
}
func (m *mockGateway) GetSandbox(ctx context.Context, workspace, name string) (*openshellv1.Sandbox, error) {
	return m.getSandboxFn(ctx, workspace, name)
}
func (m *mockGateway) ListSandboxes(ctx context.Context, workspace string, limit, offset uint32, labelSelector string) ([]*openshellv1.Sandbox, error) {
	return m.listSandboxesFn(ctx, workspace, limit, offset, labelSelector)
}
func (m *mockGateway) ExecSandbox(ctx context.Context, sandboxID string, command []string, stdin []byte, workdir string, timeoutSeconds uint32) ([]byte, []byte, int32, error) {
	return m.execSandboxFn(ctx, sandboxID, command, stdin, workdir, timeoutSeconds)
}
func (m *mockGateway) DeleteSandbox(ctx context.Context, workspace, name string) (bool, error) {
	return m.deleteSandboxFn(ctx, workspace, name)
}
func (m *mockGateway) CreateWorkspace(ctx context.Context, name string, labels map[string]string) (*datamodelv1.Workspace, error) {
	return m.createWorkspaceFn(ctx, name, labels)
}
func (m *mockGateway) GetWorkspace(ctx context.Context, name string) (*datamodelv1.Workspace, error) {
	return m.getWorkspaceFn(ctx, name)
}
func (m *mockGateway) ListWorkspaces(ctx context.Context, limit, offset uint32, labelSelector string) ([]*datamodelv1.Workspace, error) {
	return m.listWorkspacesFn(ctx, limit, offset, labelSelector)
}
func (m *mockGateway) DeleteWorkspace(ctx context.Context, name string) (bool, error) {
	return m.deleteWorkspaceFn(ctx, name)
}
func (m *mockGateway) AddWorkspaceMember(ctx context.Context, workspace, principalSubject string, role openshellv1.WorkspaceRole) (*openshellv1.WorkspaceMember, error) {
	return m.addWorkspaceMemberFn(ctx, workspace, principalSubject, role)
}
func (m *mockGateway) RemoveWorkspaceMember(ctx context.Context, workspace, principalSubject string) (bool, error) {
	return m.removeWorkspaceMemberFn(ctx, workspace, principalSubject)
}
func (m *mockGateway) ListWorkspaceMembers(ctx context.Context, workspace string, limit, offset uint32) ([]*openshellv1.WorkspaceMember, error) {
	return m.listWorkspaceMembersFn(ctx, workspace, limit, offset)
}
func (m *mockGateway) UpdateSandboxPolicy(ctx context.Context, workspace, name string, policy *sandboxv1.SandboxPolicy, expectedResourceVersion uint64) (*openshellv1.UpdateConfigResponse, error) {
	return m.updateSandboxPolicyFn(ctx, workspace, name, policy, expectedResourceVersion)
}
func (m *mockGateway) SetGlobalPolicy(ctx context.Context, policy *sandboxv1.SandboxPolicy) (*openshellv1.UpdateConfigResponse, error) {
	return m.setGlobalPolicyFn(ctx, policy)
}
func (m *mockGateway) DeleteGlobalPolicy(ctx context.Context) error {
	return m.deleteGlobalPolicyFn(ctx)
}
func (m *mockGateway) GetSandboxPolicyStatus(ctx context.Context, workspace, name string, version uint32, global bool) (*openshellv1.GetSandboxPolicyStatusResponse, error) {
	return m.getSandboxPolicyStatusFn(ctx, workspace, name, version, global)
}
func (m *mockGateway) ListSandboxPolicies(ctx context.Context, workspace, name string, limit, offset uint32, global bool) (*openshellv1.ListSandboxPoliciesResponse, error) {
	return m.listSandboxPoliciesFn(ctx, workspace, name, limit, offset, global)
}
func (m *mockGateway) GetDraftPolicy(ctx context.Context, workspace, name, statusFilter string) (*openshellv1.GetDraftPolicyResponse, error) {
	return m.getDraftPolicyFn(ctx, workspace, name, statusFilter)
}
func (m *mockGateway) ApproveDraftChunk(ctx context.Context, workspace, name, chunkID string) (*openshellv1.ApproveDraftChunkResponse, error) {
	return m.approveDraftChunkFn(ctx, workspace, name, chunkID)
}
func (m *mockGateway) RejectDraftChunk(ctx context.Context, workspace, name, chunkID, reason string) (*openshellv1.RejectDraftChunkResponse, error) {
	return m.rejectDraftChunkFn(ctx, workspace, name, chunkID, reason)
}
func (m *mockGateway) ApproveAllDraftChunks(ctx context.Context, workspace, name string, includeSecurityFlagged bool) (*openshellv1.ApproveAllDraftChunksResponse, error) {
	return m.approveAllDraftChunksFn(ctx, workspace, name, includeSecurityFlagged)
}
func (m *mockGateway) GetGatewaySettings(ctx context.Context) (*sandboxv1.GetGatewayConfigResponse, error) {
	return m.getGatewaySettingsFn(ctx)
}
func (m *mockGateway) SetSetting(ctx context.Context, key, value string) error {
	return m.setSettingFn(ctx, key, value)
}
func (m *mockGateway) DeleteSetting(ctx context.Context, key string) error {
	return m.deleteSettingFn(ctx, key)
}
func (m *mockGateway) EditDraftChunk(ctx context.Context, workspace, name, chunkID string, proposedRule *sandboxv1.NetworkPolicyRule) error {
	return m.editDraftChunkFn(ctx, workspace, name, chunkID, proposedRule)
}
func (m *mockGateway) UndoDraftChunk(ctx context.Context, workspace, name, chunkID string) (*openshellv1.UndoDraftChunkResponse, error) {
	return m.undoDraftChunkFn(ctx, workspace, name, chunkID)
}
func (m *mockGateway) ClearDraftChunks(ctx context.Context, workspace, name string) (*openshellv1.ClearDraftChunksResponse, error) {
	return m.clearDraftChunksFn(ctx, workspace, name)
}
func (m *mockGateway) GetDraftHistory(ctx context.Context, workspace, name string) (*openshellv1.GetDraftHistoryResponse, error) {
	return m.getDraftHistoryFn(ctx, workspace, name)
}
func (m *mockGateway) GetSandboxLogs(ctx context.Context, workspace, sandboxID string, lines uint32, sinceMs int64, sources []string, minLevel string) (*openshellv1.GetSandboxLogsResponse, error) {
	return m.getSandboxLogsFn(ctx, workspace, sandboxID, lines, sinceMs, sources, minLevel)
}
func (m *mockGateway) ExposeService(ctx context.Context, workspace, sandbox, service string, targetPort uint32, domain bool) (*openshellv1.ServiceEndpointResponse, error) {
	return m.exposeServiceFn(ctx, workspace, sandbox, service, targetPort, domain)
}
func (m *mockGateway) ListServices(ctx context.Context, workspace, sandbox string) ([]*openshellv1.ServiceEndpointResponse, error) {
	return m.listServicesFn(ctx, workspace, sandbox)
}
func (m *mockGateway) DeleteService(ctx context.Context, workspace, sandbox, service string) (bool, error) {
	return m.deleteServiceFn(ctx, workspace, sandbox, service)
}
func (m *mockGateway) SetInferenceRoute(ctx context.Context, workspace, routeName, providerName, modelID string, timeoutSecs uint64, noVerify bool) (*inferencev1.SetInferenceRouteResponse, error) {
	return m.setInferenceRouteFn(ctx, workspace, routeName, providerName, modelID, timeoutSecs, noVerify)
}
func (m *mockGateway) GetInferenceRoute(ctx context.Context, workspace, routeName string) (*inferencev1.GetInferenceRouteResponse, error) {
	return m.getInferenceRouteFn(ctx, workspace, routeName)
}
func (m *mockGateway) DeleteInferenceRoute(ctx context.Context, workspace, routeName string) (*inferencev1.DeleteInferenceRouteResponse, error) {
	return m.deleteInferenceRouteFn(ctx, workspace, routeName)
}

func newTestApp(gw *mockGateway) *App {
	return &App{gateway: gw, sdk: &mockSDK{}}
}

func newTestAppWithSDK(sdk *mockSDK) *App {
	return &App{sdk: sdk}
}
