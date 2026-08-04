package gateway

import (
	"context"

	datamodelv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/datamodelv1"
	inferencev1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/inferencev1"
	openshellv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/openshellv1"
	sandboxv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/sandboxv1"
)

// Interface defines the gateway operations the API handlers depend on.
// The concrete *Client implements it; tests provide stubs.
type Interface interface {
	Health(ctx context.Context) (*openshellv1.HealthResponse, error)
	GetGatewayInfo(ctx context.Context) (*openshellv1.GetGatewayInfoResponse, error)
	GetCurrentUser(ctx context.Context) (*openshellv1.GetCurrentUserResponse, error)
	ExecSandboxInteractive(ctx context.Context) (openshellv1.OpenShell_ExecSandboxInteractiveClient, error)

	// Sandboxes
	CreateSandbox(ctx context.Context, workspace, name string, spec *openshellv1.SandboxSpec, labels, annotations map[string]string) (*openshellv1.Sandbox, error)
	GetSandbox(ctx context.Context, workspace, name string) (*openshellv1.Sandbox, error)
	ListSandboxes(ctx context.Context, workspace string, limit, offset uint32, labelSelector string) ([]*openshellv1.Sandbox, error)
	ExecSandbox(ctx context.Context, sandboxID string, command []string, stdin []byte, workdir string, timeoutSeconds uint32) ([]byte, []byte, int32, error)
	DeleteSandbox(ctx context.Context, workspace, name string) (bool, error)

	// Workspaces
	CreateWorkspace(ctx context.Context, name string, labels map[string]string) (*datamodelv1.Workspace, error)
	GetWorkspace(ctx context.Context, name string) (*datamodelv1.Workspace, error)
	ListWorkspaces(ctx context.Context, limit, offset uint32, labelSelector string) ([]*datamodelv1.Workspace, error)
	DeleteWorkspace(ctx context.Context, name string) (bool, error)
	AddWorkspaceMember(ctx context.Context, workspace, principalSubject string, role openshellv1.WorkspaceRole) (*openshellv1.WorkspaceMember, error)
	RemoveWorkspaceMember(ctx context.Context, workspace, principalSubject string) (bool, error)
	ListWorkspaceMembers(ctx context.Context, workspace string, limit, offset uint32) ([]*openshellv1.WorkspaceMember, error)

	// Providers
	CreateProvider(ctx context.Context, workspace string, provider *datamodelv1.Provider) (*datamodelv1.Provider, error)
	GetProvider(ctx context.Context, workspace, name string) (*datamodelv1.Provider, error)
	ListProviders(ctx context.Context, workspace string, limit, offset uint32) ([]*datamodelv1.Provider, error)
	DeleteProvider(ctx context.Context, workspace, name string) (bool, error)
	UpdateProvider(ctx context.Context, workspace string, provider *datamodelv1.Provider, credentialExpiresAtMs map[string]int64) (*datamodelv1.Provider, error)
	GetProviderRefreshStatus(ctx context.Context, workspace, provider, credentialKey string) (*openshellv1.GetProviderRefreshStatusResponse, error)
	ConfigureProviderRefresh(ctx context.Context, workspace, provider, credentialKey string, strategy openshellv1.ProviderCredentialRefreshStrategy, material map[string]string, secretMaterialKeys []string, expiresAtMs *int64) (*openshellv1.ConfigureProviderRefreshResponse, error)
	RotateProviderCredential(ctx context.Context, workspace, provider, credentialKey string) (*openshellv1.RotateProviderCredentialResponse, error)
	DeleteProviderRefresh(ctx context.Context, workspace, provider, credentialKey string) (bool, error)
	ListProviderProfiles(ctx context.Context, workspace string, limit, offset uint32) ([]*openshellv1.ProviderProfile, error)
	GetProviderProfile(ctx context.Context, id, workspace string) (*openshellv1.ProviderProfile, error)
	ImportProviderProfiles(ctx context.Context, workspace string, profiles []*openshellv1.ProviderProfileImportItem) (*openshellv1.ImportProviderProfilesResponse, error)
	UpdateProviderProfile(ctx context.Context, workspace, id string, profile *openshellv1.ProviderProfileImportItem, expectedResourceVersion uint64) (*openshellv1.UpdateProviderProfilesResponse, error)
	DeleteProviderProfile(ctx context.Context, id, workspace string) (bool, error)
	LintProviderProfiles(ctx context.Context, workspace string, profiles []*openshellv1.ProviderProfileImportItem) (*openshellv1.LintProviderProfilesResponse, error)

	// Policies
	UpdateSandboxPolicy(ctx context.Context, workspace, name string, policy *sandboxv1.SandboxPolicy, expectedResourceVersion uint64) (*openshellv1.UpdateConfigResponse, error)
	SetGlobalPolicy(ctx context.Context, policy *sandboxv1.SandboxPolicy) (*openshellv1.UpdateConfigResponse, error)
	DeleteGlobalPolicy(ctx context.Context) error
	GetSandboxPolicyStatus(ctx context.Context, workspace, name string, version uint32, global bool) (*openshellv1.GetSandboxPolicyStatusResponse, error)
	ListSandboxPolicies(ctx context.Context, workspace, name string, limit, offset uint32, global bool) (*openshellv1.ListSandboxPoliciesResponse, error)
	GetDraftPolicy(ctx context.Context, workspace, name, statusFilter string) (*openshellv1.GetDraftPolicyResponse, error)
	ApproveDraftChunk(ctx context.Context, workspace, name, chunkID string) (*openshellv1.ApproveDraftChunkResponse, error)
	RejectDraftChunk(ctx context.Context, workspace, name, chunkID, reason string) (*openshellv1.RejectDraftChunkResponse, error)
	ApproveAllDraftChunks(ctx context.Context, workspace, name string, includeSecurityFlagged bool) (*openshellv1.ApproveAllDraftChunksResponse, error)
	GetGatewaySettings(ctx context.Context) (*sandboxv1.GetGatewayConfigResponse, error)
	SetSetting(ctx context.Context, key, value string) error
	DeleteSetting(ctx context.Context, key string) error
	EditDraftChunk(ctx context.Context, workspace, name, chunkID string, proposedRule *sandboxv1.NetworkPolicyRule) error
	UndoDraftChunk(ctx context.Context, workspace, name, chunkID string) (*openshellv1.UndoDraftChunkResponse, error)
	ClearDraftChunks(ctx context.Context, workspace, name string) (*openshellv1.ClearDraftChunksResponse, error)
	GetDraftHistory(ctx context.Context, workspace, name string) (*openshellv1.GetDraftHistoryResponse, error)

	// Logs / sandbox providers
	GetSandboxLogs(ctx context.Context, workspace, sandboxID string, lines uint32, sinceMs int64, sources []string, minLevel string) (*openshellv1.GetSandboxLogsResponse, error)
	ListSandboxProviders(ctx context.Context, workspace, sandboxName string) (*openshellv1.ListSandboxProvidersResponse, error)
	AttachSandboxProvider(ctx context.Context, workspace, sandboxName, providerName string, expectedResourceVersion uint64) (*openshellv1.AttachSandboxProviderResponse, error)
	DetachSandboxProvider(ctx context.Context, workspace, sandboxName, providerName string, expectedResourceVersion uint64) (*openshellv1.DetachSandboxProviderResponse, error)

	// Services
	ExposeService(ctx context.Context, workspace, sandbox, service string, targetPort uint32, domain bool) (*openshellv1.ServiceEndpointResponse, error)
	ListServices(ctx context.Context, workspace, sandbox string) ([]*openshellv1.ServiceEndpointResponse, error)
	DeleteService(ctx context.Context, workspace, sandbox, service string) (bool, error)

	// Inference
	SetInferenceRoute(ctx context.Context, workspace, routeName, providerName, modelID string, timeoutSecs uint64, noVerify bool) (*inferencev1.SetInferenceRouteResponse, error)
	GetInferenceRoute(ctx context.Context, workspace, routeName string) (*inferencev1.GetInferenceRouteResponse, error)
	DeleteInferenceRoute(ctx context.Context, workspace, routeName string) (*inferencev1.DeleteInferenceRouteResponse, error)
}

// Verify *Client implements Interface at compile time.
var _ Interface = (*Client)(nil)
