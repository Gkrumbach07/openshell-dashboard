// Package api exposes the BFF REST API consumed by the React frontend.
package api

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"

	openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"

	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/auth"
)

// App wires the OpenShell SDK client, auth middleware, and REST routes.
type App struct { //nolint:govet // fieldalignment: readability over padding
	sdk  openshell.ClientInterface
	auth *auth.Middleware
	// authConfig is serialized to the browser via GET /auth/config — never
	// put secrets in it.
	authConfig    AuthConfigResponse
	staticDir     string
	maxUploadSize int64
	execTimeout   uint32
}

// NewApp builds the application.
func NewApp(sdkClient openshell.ClientInterface, authMiddleware *auth.Middleware, staticDir string, authCfg AuthConfigResponse) *App {
	app := &App{
		sdk:        sdkClient,
		auth:       authMiddleware,
		authConfig: authCfg,
		staticDir:  staticDir,
	}
	if app.maxUploadSize == 0 {
		app.maxUploadSize = 64 << 20 // 64 MiB
	}
	if app.execTimeout == 0 {
		app.execTimeout = 30
	}
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
		r.Get("/readyz", app.GetReadyz)

		r.Group(func(r chi.Router) {
			r.Use(app.auth.Handler)

			r.Get("/auth/whoami", app.GetWhoAmI)
			r.Get("/gateway", app.GetGateway)
			r.Get("/draft-summary", app.GetDraftSummary)

			r.Get("/global-policy", app.GetGlobalPolicy)
			r.Put("/global-policy", app.SetGlobalPolicy)

			r.Get("/settings/global", app.GetGlobalSettings)
			r.Put("/settings/global", app.SetGlobalSetting)
			r.Delete("/settings/global", app.DeleteGlobalSetting)
			r.Delete("/global-policy", app.DeleteGlobalPolicy)

			r.Route("/workspaces", func(r chi.Router) {
				r.Get("/", app.ListWorkspaces)
				r.Post("/", app.CreateWorkspace)
				r.Route("/{workspace}", func(r chi.Router) {
					r.Get("/", app.GetWorkspace)
					r.Delete("/", app.DeleteWorkspace)

					r.Get("/members", app.ListMembers)
					r.Post("/members", app.AddMember)
					r.Delete("/members/{subject}", app.RemoveMember)

					r.Get("/sandboxes", app.ListSandboxes)
					r.Post("/sandboxes", app.CreateSandbox)
					r.Get("/sandboxes/{name}", app.GetSandbox)
					r.Delete("/sandboxes/{name}", app.DeleteSandbox)
					r.Get("/sandboxes/{name}/logs", app.GetSandboxLogs)
					r.Get("/sandboxes/{name}/terminal", app.Terminal)
					r.Get("/sandboxes/{name}/providers", app.ListSandboxProviders)
					r.Post("/sandboxes/{name}/providers/{provider}", app.AttachSandboxProvider)
					r.Delete("/sandboxes/{name}/providers/{provider}", app.DetachSandboxProvider)
					r.Get("/sandboxes/{name}/policy", app.GetSandboxPolicy)
					r.Put("/sandboxes/{name}/policy", app.UpdateSandboxPolicy)
					r.Get("/sandboxes/{name}/drafts", app.GetDraftPolicy)
					r.Post("/sandboxes/{name}/drafts/{chunk}/approve", app.ApproveDraftChunk)
					r.Post("/sandboxes/{name}/drafts/{chunk}/reject", app.RejectDraftChunk)
					r.Post("/sandboxes/{name}/drafts/approve-all", app.ApproveAllDraftChunks)
					r.Put("/sandboxes/{name}/drafts/{chunk}", app.EditDraftChunk)
					r.Post("/sandboxes/{name}/drafts/{chunk}/undo", app.UndoDraftChunk)
					r.Post("/sandboxes/{name}/drafts/clear", app.ClearDraftChunks)
					r.Get("/sandboxes/{name}/drafts/history", app.GetDraftHistory)
					r.Post("/sandboxes/{name}/files", app.UploadFile)
					r.Get("/sandboxes/{name}/files", app.DownloadFile)

					r.Get("/sandboxes/{name}/services", app.ListServices)
					r.Post("/sandboxes/{name}/services", app.ExposeService)
					r.Delete("/sandboxes/{name}/services/{svc}", app.DeleteService)

					r.Get("/inference", app.GetInferenceRoute)
					r.Put("/inference", app.SetInferenceRoute)
					r.Delete("/inference", app.DeleteInferenceRoute)

					r.Get("/providers", app.ListProviders)
					r.Post("/providers", app.CreateProvider)
					r.Get("/providers/{name}", app.GetProvider)
					r.Put("/providers/{name}", app.UpdateProvider)
					r.Delete("/providers/{name}", app.DeleteProvider)
					r.Get("/providers/{name}/refresh-status", app.GetProviderRefreshStatus)
					r.Post("/providers/{name}/refresh", app.ConfigureProviderRefresh)
					r.Post("/providers/{name}/refresh/rotate", app.RotateProviderCredential)
					r.Delete("/providers/{name}/refresh", app.DeleteProviderRefresh)

					r.Get("/provider-profiles", app.ListProviderProfiles)
					r.Post("/provider-profiles", app.ImportProviderProfiles)
					r.Post("/provider-profiles/lint", app.LintProviderProfiles)
					r.Get("/provider-profiles/{profileId}", app.GetProviderProfile)
					r.Put("/provider-profiles/{profileId}", app.UpdateProviderProfile)
					r.Delete("/provider-profiles/{profileId}", app.DeleteProviderProfile)
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
		writeError(w, http.StatusNotFound, "not_found", "unknown API route")
		return
	}
	requested := filepath.Join(app.staticDir, filepath.Clean("/"+r.URL.Path))
	if info, err := os.Stat(requested); err == nil && !info.IsDir() {
		http.ServeFile(w, r, requested)
		return
	}
	http.ServeFile(w, r, filepath.Join(app.staticDir, "index.html"))
}
