// Package server wires the BFF REST API consumed by the React frontend.
package server

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"

	openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"

	apiutils "github.com/Gkrumbach07/openshell-dashboard/backend/internal/apiutils"
	"github.com/Gkrumbach07/openshell-dashboard/backend/pkg/auth"
	"github.com/Gkrumbach07/openshell-dashboard/backend/pkg/handlers"
	"github.com/Gkrumbach07/openshell-dashboard/backend/pkg/models"
	"github.com/Gkrumbach07/openshell-dashboard/backend/pkg/services"
)

// App wires the OpenShell SDK client, auth middleware, and REST routes.
type App struct { //nolint:govet // fieldalignment: readability over padding
	// authConfig is serialized to the browser via GET /auth/config — never
	// put secrets in it.
	auth          *auth.Middleware
	authConfig    models.AuthConfigResponse
	staticDir     string
	maxUploadSize int64
	execTimeout   uint32

	drafts     *handlers.DraftsHandler
	files      *handlers.FilesHandler
	gateway    *handlers.GatewayHandler
	inference  *handlers.InferenceHandler
	logs       *handlers.LogsHandler
	policies   *handlers.PoliciesHandler
	providers  *handlers.ProvidersHandler
	sandboxes  *handlers.SandboxHandler
	services   *handlers.ServicesHandler
	settings   *handlers.SettingsHandler
	terminal   *handlers.TerminalHandler
	templates  *handlers.TemplatesHandler
	workspaces *handlers.WorkspacesHandler
}

// NewApp builds the application.
func NewApp(sdkClient openshell.ClientInterface, execUpload services.StdinExecer, authMiddleware *auth.Middleware, staticDir string, authCfg models.AuthConfigResponse) *App {
	app := &App{
		auth:          authMiddleware,
		authConfig:    authCfg,
		staticDir:     staticDir,
		maxUploadSize: 64 << 20,
		execTimeout:   30,
	}

	sandboxSvc := services.NewSandboxService(sdkClient.Sandboxes())
	configSvc := services.NewConfig(sdkClient.Config())
	execSvc := services.NewExecService(sdkClient.Exec())
	policySvc := services.NewPolicyService(sdkClient.Policy())

	app.drafts = handlers.NewDraftsHandler(policySvc)
	app.files = handlers.NewFilesHandler(services.NewFileService(execUpload), execSvc, sandboxSvc, handlers.FilesHandlerConfig{ExecTimeout: app.execTimeout, MaxUploadSize: app.maxUploadSize})
	app.gateway = handlers.NewGatewayHandler(services.NewGatewayService(sdkClient), authMiddleware, authCfg)
	app.inference = handlers.NewInferenceHandler(services.NewInferenceService(sdkClient.Inference()))
	app.logs = handlers.NewLogsHandler(sandboxSvc)
	app.policies = handlers.NewPoliciesHandler(policySvc, configSvc)
	app.providers = handlers.NewProvidersHandler(services.NewProviderService(sdkClient.Providers()))
	app.sandboxes = handlers.NewSandboxHandler(sandboxSvc)
	app.services = handlers.NewServicesHandler(services.NewServiceService(sdkClient.Services()))
	app.settings = handlers.NewSettingsHandler(configSvc)
	app.terminal = handlers.NewTerminalHandler(execSvc)
	app.templates = handlers.NewTemplatesHandler(services.NewTemplateService(sdkClient))
	app.workspaces = handlers.NewWorkspacesHandler(services.NewWorkspaceService(sdkClient.Workspaces()))

	return app
}

// Routes builds the chi router.
func (app *App) Routes() http.Handler {
	r := chi.NewRouter()
	r.Use(chimiddleware.RequestID)
	r.Use(chimiddleware.Logger)
	r.Use(chimiddleware.Recoverer)

	r.Route("/api/v1", func(r chi.Router) {
		// Public: frontend bootstrap config, no token needed.
		r.Get("/auth/config", app.GetAuthConfig)
		// BFF liveness (does not call the gateway).
		r.Get("/healthz", app.GetHealthz)
		r.Get("/readyz", app.gateway.GetReadyz)

		r.Group(func(r chi.Router) {
			r.Use(app.auth.Handler)

			r.Get("/auth/whoami", app.gateway.GetWhoAmI)
			r.Get("/gateway", app.gateway.GetGateway)
			r.Get("/draft-summary", app.drafts.GetDraftSummary)

			r.Route("/global-policy", func(r chi.Router) {
				r.Get("/", app.policies.GetGlobalPolicy)
				r.Put("/", app.policies.SetGlobalPolicy)
			})

			r.Get("/settings/global", app.settings.GetGlobalSettings)
			r.Put("/settings/global", app.settings.SetGlobalSetting)
			r.Delete("/settings/global", app.settings.DeleteGlobalSetting)
			r.Delete("/global-policy", app.policies.DeleteGlobalPolicy)

			r.Route("/workspaces", func(r chi.Router) {
				r.Get("/", app.workspaces.ListWorkspaces)
				r.Post("/", app.workspaces.CreateWorkspace)
				r.Route("/{workspace}", func(r chi.Router) {
					r.Get("/", app.workspaces.GetWorkspace)
					r.Delete("/", app.workspaces.DeleteWorkspace)

					r.Get("/members", app.workspaces.ListMembers)
					r.Post("/members", app.workspaces.AddMember)
					r.Delete("/members/{subject}", app.workspaces.RemoveMember)

					r.Get("/templates", app.templates.ListSandboxTemplates)
					r.Post("/templates", app.templates.CreateSandboxTemplate)
					r.Get("/templates/{name}", app.templates.GetSandboxTemplate)
					r.Delete("/templates/{name}", app.templates.DeleteSandboxTemplate)

					r.Get("/sandboxes", app.sandboxes.ListSandboxes)
					r.Post("/sandboxes", app.sandboxes.CreateSandbox)
					r.Post("/sandboxes/from-template", app.templates.CreateSandboxFromTemplate)
					r.Get("/sandboxes/{name}", app.sandboxes.GetSandbox)
					r.Delete("/sandboxes/{name}", app.sandboxes.DeleteSandbox)
					r.Post("/sandboxes/{name}/stop", app.sandboxes.StopSandbox)
					r.Post("/sandboxes/{name}/start", app.sandboxes.StartSandbox)
					r.Get("/sandboxes/{name}/logs", app.logs.GetSandboxLogs)
					r.Get("/sandboxes/{name}/terminal", app.terminal.Terminal)
					r.Get("/sandboxes/{name}/providers", app.logs.ListSandboxProviders)
					r.Post("/sandboxes/{name}/providers/{provider}", app.logs.AttachSandboxProvider)
					r.Delete("/sandboxes/{name}/providers/{provider}", app.logs.DetachSandboxProvider)
					r.Get("/sandboxes/{name}/policy", app.policies.GetSandboxPolicy)
					r.Put("/sandboxes/{name}/policy", app.policies.UpdateSandboxPolicy)
					r.Get("/sandboxes/{name}/drafts", app.drafts.GetDraftPolicy)
					r.Post("/sandboxes/{name}/drafts/{chunk}/approve", app.drafts.ApproveDraftChunk)
					r.Post("/sandboxes/{name}/drafts/{chunk}/reject", app.drafts.RejectDraftChunk)
					r.Post("/sandboxes/{name}/drafts/approve-all", app.drafts.ApproveAllDraftChunks)
					r.Put("/sandboxes/{name}/drafts/{chunk}", app.drafts.EditDraftChunk)
					r.Post("/sandboxes/{name}/drafts/{chunk}/undo", app.drafts.UndoDraftChunk)
					r.Post("/sandboxes/{name}/drafts/clear", app.drafts.ClearDraftChunks)
					r.Get("/sandboxes/{name}/drafts/history", app.drafts.GetDraftHistory)
					r.Post("/sandboxes/{name}/files", app.files.UploadFile)
					r.Get("/sandboxes/{name}/files", app.files.DownloadFile)

					r.Get("/sandboxes/{name}/services", app.services.ListServices)
					r.Post("/sandboxes/{name}/services", app.services.ExposeService)
					r.Delete("/sandboxes/{name}/services/{svc}", app.services.DeleteService)

					r.Get("/inference", app.inference.GetInferenceRoute)
					r.Put("/inference", app.inference.SetInferenceRoute)
					r.Delete("/inference", app.inference.DeleteInferenceRoute)

					r.Get("/providers", app.providers.ListProviders)
					r.Post("/providers", app.providers.CreateProvider)
					r.Get("/providers/{name}", app.providers.GetProvider)
					r.Put("/providers/{name}", app.providers.UpdateProvider)
					r.Delete("/providers/{name}", app.providers.DeleteProvider)
					r.Get("/providers/{name}/refresh-status", app.providers.GetProviderRefreshStatus)
					r.Post("/providers/{name}/refresh", app.providers.ConfigureProviderRefresh)
					r.Post("/providers/{name}/refresh/rotate", app.providers.RotateProviderCredential)
					r.Delete("/providers/{name}/refresh", app.providers.DeleteProviderRefresh)

					r.Get("/provider-profiles", app.providers.ListProviderProfiles)
					r.Post("/provider-profiles", app.providers.ImportProviderProfiles)
					r.Post("/provider-profiles/lint", app.providers.LintProviderProfiles)
					r.Get("/provider-profiles/{profileId}", app.providers.GetProviderProfile)
					r.Put("/provider-profiles/{profileId}", app.providers.UpdateProviderProfile)
					r.Delete("/provider-profiles/{profileId}", app.providers.DeleteProviderProfile)
				})
			})
		})
	})

	if app.staticDir != "" {
		r.NotFound(app.serveStatic)
	}

	return r
}

// serveStatic serves the built frontend with SPA fallback to index.html.
func (app *App) serveStatic(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") {
		apiutils.WriteError(w, http.StatusNotFound, apiutils.NotFound, "unknown API route")
		return
	}
	requested := filepath.Join(app.staticDir, filepath.Clean("/"+r.URL.Path))
	if info, err := os.Stat(requested); err == nil && !info.IsDir() {
		http.ServeFile(w, r, requested)
		return
	}
	http.ServeFile(w, r, filepath.Join(app.staticDir, "index.html"))
}

// GetHealthz reports BFF liveness without touching the gateway.
func (app *App) GetHealthz(w http.ResponseWriter, _ *http.Request) {
	apiutils.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// GetAuthConfig is public — the frontend needs it before any auth exists.
func (app *App) GetAuthConfig(w http.ResponseWriter, _ *http.Request) {
	apiutils.WriteJSON(w, http.StatusOK, app.authConfig)
}
