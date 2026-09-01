// Package openshell provides factories and interfaces for Openshell SDK
package openshell

import (
	"context"

	ops "github.com/rhuss/openshell-sdk-go/openshell/v1"
)

type Factory interface {
	NewClient(ctx context.Context, config ClientConfig) (ops.ClientInterface, error)
}

type ClientConfig struct {
	Address string
}

// Client is the OpenShell SDK surface services depend on. The production
// implementation wraps the generated gRPC stubs; tests and downstream
// consumers may substitute any type satisfying this interface.
// type Client interface {
// 	// --- Health (SDK: HealthInterface, client.Health()) ---
// 	// GetGatewayInfo also covers SDK HealthInterface.GetGatewayInfo.
//
// 	GetGatewayInfo(ctx context.Context) (*models.GatewayInfo, error)
// 	CheckHealth(ctx context.Context) (*models.HealthResult, error)
// 	GetCurrentUser(ctx context.Context) (*models.CurrentUser, error)
//
// 	// --- Sandboxes (SDK: SandboxInterface, client.Sandboxes()) ---
//
// 	GetSandbox(ctx context.Context, workspace, name string) (*models.Sandbox, error)
// 	ListSandboxes(ctx context.Context, workspace string) ([]*models.Sandbox, error)
// 	CreateSandbox(ctx context.Context, workspace, name string, spec *models.SandboxSpec, labels map[string]string) (*models.Sandbox, error)
// 	DeleteSandbox(ctx context.Context, workspace, name string) error
// 	AttachSandboxProvider(ctx context.Context, workspace, sandboxName, providerName string, expectedResourceVersion uint64) (*models.AttachProviderResult, error)
// 	DetachSandboxProvider(ctx context.Context, workspace, sandboxName, providerName string, expectedResourceVersion uint64) (*models.DetachProviderResult, error)
// 	ListSandboxProviders(ctx context.Context, workspace, sandboxName string) ([]*models.Provider, error)
// 	WaitSandboxReady(ctx context.Context, workspace, name string) (*models.Sandbox, error)
// 	// WatchSandbox streams state-change events until ctx is cancelled or the
// 	// returned stop func is called. Handlers relay this as Server-Sent Events.
// 	WatchSandbox(ctx context.Context, workspace, name string) (<-chan *models.SandboxEvent, func(), error)
// 	GetSandboxLogs(ctx context.Context, workspace, sandboxName string, opts models.LogOptions) (*models.LogResult, error)
//
// 	// --- Exec (SDK: ExecInterface, client.Exec()) ---
//
// 	ExecRun(ctx context.Context, workspace, sandboxName string, command []string) (*models.ExecResult, error)
// 	// ExecStream(ctx context.Context, workspace, sandboxName string, command []string) (ExecStream, error)
// 	// ExecInteractive(ctx context.Context, workspace, sandboxName string, command []string, cols, rows uint32) (InteractiveSession, error)
//
// 	// --- Providers (SDK: ProviderInterface, client.Providers()) ---
//
// 	CreateProvider(ctx context.Context, workspace string, provider *models.Provider) (*models.Provider, error)
// 	GetProvider(ctx context.Context, workspace, name string) (*models.Provider, error)
// 	ListProviders(ctx context.Context, workspace string, opts models.ListOptions) ([]*models.Provider, error)
// 	UpdateProvider(ctx context.Context, workspace string, provider *models.Provider) (*models.Provider, error)
// 	DeleteProvider(ctx context.Context, workspace, name string) error
// 	EnsureProvider(ctx context.Context, workspace string, provider *models.Provider) (*models.Provider, error)
//
// 	// --- Profiles (SDK: ProfileInterface, client.Providers().Profiles()) ---
//
// 	ListProfiles(ctx context.Context, workspace string, opts models.ListOptions) ([]*models.ProviderProfile, error)
// 	GetProfile(ctx context.Context, workspace, id string) (*models.ProviderProfile, error)
// 	ImportProfiles(ctx context.Context, workspace string, items []models.ProfileImportItem) (*models.ImportResult, error)
// 	UpdateProfile(ctx context.Context, workspace, id string, expectedResourceVersion uint64, item models.ProfileImportItem) (*models.UpdateResult, error)
// 	LintProfiles(ctx context.Context, workspace string, items []models.ProfileImportItem) (*models.LintResult, error)
// 	DeleteProfile(ctx context.Context, workspace, id string) (bool, error)
//
// 	// --- Refresh (SDK: RefreshInterface, client.Providers().Refresh()) ---
//
// 	GetRefreshStatus(ctx context.Context, workspace, provider, credentialKey string) ([]*models.RefreshStatus, error)
// 	ConfigureRefresh(ctx context.Context, workspace string, config *models.RefreshConfig) (*models.RefreshStatus, error)
// 	RotateRefresh(ctx context.Context, workspace, provider, credentialKey string) (*models.RefreshStatus, error)
// 	DeleteRefresh(ctx context.Context, workspace, provider, credentialKey string) (bool, error)
//
// 	// --- Services (SDK: ServiceInterface, client.Services()) ---
//
// 	ExposeService(ctx context.Context, workspace, sandboxName, serviceName string, targetPort uint32, domain bool) (*models.ServiceEndpoint, error)
// 	GetService(ctx context.Context, workspace, sandboxName, serviceName string) (*models.ServiceEndpoint, error)
// 	ListServices(ctx context.Context, workspace, sandboxName string) ([]*models.ServiceEndpoint, error)
// 	DeleteService(ctx context.Context, workspace, sandboxName, serviceName string) error
//
// 	// --- Files (SDK: FileInterface, client.Files()) ---
// 	//
// 	// The SDK's Upload/Download take local filesystem paths (it's a CLI/
// 	// script-oriented SDK). The BFF instead proxies bytes between the HTTP
// 	// request/response and the sandbox, so these take io.Reader/io.Writer.
//
// 	UploadFile(ctx context.Context, workspace, sandboxName, remotePath string, r io.Reader) error
// 	DownloadFile(ctx context.Context, workspace, sandboxName, remotePath string, w io.Writer) error
//
// 	// --- SSH (SDK: SSHInterface, client.SSH()) ---
//
// 	CreateSSHSession(ctx context.Context, workspace, sandboxName string) (*models.SSHSession, error)
// 	RevokeSSHSession(ctx context.Context, workspace, token string) (bool, error)
// 	// OpenSSHTunnel returns a raw bidirectional stream to a sandbox port.
// 	// Not yet wired to an HTTP transport (would need a WebSocket upgrade);
// 	// kept here so the contract exists when that's built.
// 	OpenSSHTunnel(ctx context.Context, workspace, sandboxName string, port uint32) (io.ReadWriteCloser, error)
//
// 	// --- TCP (SDK: TCPInterface, client.TCP()) ---
// 	//
// 	// SDK's Listen() opens a *local* net.Listener for CLI-style port
// 	// forwarding -- there's no server-side BFF equivalent, so it's omitted
// 	// here. Forward() is kept for a future WebSocket-backed proxy endpoint.
//
// 	ForwardTCP(ctx context.Context, workspace, sandboxName string, port uint32) (io.ReadWriteCloser, error)
//
// 	// --- Config (SDK: ConfigInterface, client.Config()) ---
//
// 	GetSandboxConfig(ctx context.Context, workspace, sandboxName string) (*models.SandboxConfig, error)
// 	GetGatewayConfig(ctx context.Context) (*models.GatewayConfig, error)
// 	UpdateConfig(ctx context.Context, workspace string, update *models.ConfigUpdate) (*models.ConfigUpdateResult, error)
//
// 	// --- Policy (SDK: PolicyInterface, client.Policy()) ---
//
// 	GetPolicyDraft(ctx context.Context, workspace, sandboxName string) (*models.DraftPolicy, error)
// 	ApprovePolicyDraftChunk(ctx context.Context, workspace, sandboxName, chunkID string) (*models.ApproveResult, error)
// 	RejectPolicyDraftChunk(ctx context.Context, workspace, sandboxName, chunkID, reason string) error
// 	ApproveAllPolicyDraftChunks(ctx context.Context, workspace, sandboxName string) (*models.ApproveAllResult, error)
// 	ClearPolicyDraftChunks(ctx context.Context, workspace, sandboxName string) (*models.ClearResult, error)
// 	GetPolicyDraftHistory(ctx context.Context, workspace, sandboxName string) ([]models.DraftHistoryEntry, error)
// 	GetPolicyStatus(ctx context.Context, workspace, sandboxName string) (*models.PolicyStatusResult, error)
// 	ListPolicyRevisions(ctx context.Context, workspace string) ([]models.SandboxPolicyRevision, error)
// 	EditPolicyDraftChunk(ctx context.Context, workspace, sandboxName, chunkID string, proposedRule *models.NetworkPolicyRule) error
// 	UndoPolicyDraftChunk(ctx context.Context, workspace, sandboxName, chunkID string) (*models.UndoResult, error)
//
// 	// --- Workspaces (SDK: WorkspaceInterface, client.Workspaces()) ---
//
// 	CreateWorkspace(ctx context.Context, name string, labels map[string]string) (*models.Workspace, error)
// 	GetWorkspace(ctx context.Context, name string) (*models.Workspace, error)
// 	ListWorkspaces(ctx context.Context, opts models.ListOptions) ([]*models.Workspace, error)
// 	DeleteWorkspace(ctx context.Context, name string) error
// 	AddWorkspaceMember(ctx context.Context, workspace, principalSubject, role string) (*models.WorkspaceMember, error)
// 	RemoveWorkspaceMember(ctx context.Context, workspace, principalSubject string) error
// 	ListWorkspaceMembers(ctx context.Context, workspace string) ([]*models.WorkspaceMember, error)
//
// 	// --- Inference (SDK: InferenceInterface, client.Inference()) ---
//
// 	SetInferenceRoute(ctx context.Context, workspace string, config *models.InferenceRouteConfig) (*models.InferenceRoute, error)
// 	GetInferenceRoute(ctx context.Context, workspace, routeName string) (*models.InferenceRoute, error)
// 	DeleteInferenceRoute(ctx context.Context, workspace, routeName string) error
// }

// // ExecStream is an iterator over streaming command output, mirroring the
// // SDK's ExecStream. Next returns io.EOF when the command finishes.
// type ExecStream interface {
// 	Next() (*models.ExecChunk, error)
// 	ExitCode() (int, error)
// 	Close() error
// }
//
// // InteractiveSession is a bidirectional terminal session, mirroring the
// // SDK's InteractiveSession.
// type InteractiveSession interface {
// 	Read(p []byte) (int, error)
// 	Write(p []byte) (int, error)
// 	Resize(cols, rows uint32) error
// 	ExitCode() (int, error)
// 	Close() error
// }

// Factory mints a Client scoped to a single request. Auth middleware
// resolves the caller's bearer token onto ctx; the Factory implementation
// decides how that becomes an authenticated Client (real dial, mock, etc.).
