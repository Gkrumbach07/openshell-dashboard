package api

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	openshell "github.com/rhuss/openshell-sdk-go/openshell/v1"

	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/models"
)

// CreateProviderRequest is the create-provider body. Credentials are
// write-only: accepted here, forwarded to the gateway, never returned.
type CreateProviderRequest struct {
	Name        string            `json:"name"`
	Type        string            `json:"type"`
	Credentials map[string]string `json:"credentials,omitempty"`
	Config      map[string]string `json:"config,omitempty"`
	Labels      map[string]string `json:"labels,omitempty"`
}

func (app *App) ListProviders(w http.ResponseWriter, r *http.Request) {
	providers, err := app.client.Providers().List(r.Context(), chi.URLParam(r, "workspace"))
	if err != nil {
		writeSDKError(w, err)
		return
	}
	out := make([]models.Provider, 0, len(providers))
	for _, provider := range providers {
		out = append(out, models.FromProvider(provider))
	}
	writeJSON(w, http.StatusOK, out)
}

func (app *App) CreateProvider(w http.ResponseWriter, r *http.Request) {
	var body CreateProviderRequest
	if !decodeBody(w, r, &body) {
		return
	}
	if body.Name == "" || body.Type == "" {
		writeError(w, http.StatusBadRequest, "invalid_provider", "name and type are required")
		return
	}
	provider := &openshell.Provider{
		Name:   body.Name,
		Type:   body.Type,
		Labels: body.Labels,
		Spec: openshell.ProviderSpec{
			Credentials: body.Credentials,
			Config:      body.Config,
		},
	}
	created, err := app.client.Providers().Create(r.Context(), chi.URLParam(r, "workspace"), provider)
	if err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, models.FromProvider(created))
}

func (app *App) GetProvider(w http.ResponseWriter, r *http.Request) {
	provider, err := app.client.Providers().Get(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"))
	if err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.FromProvider(provider))
}

func (app *App) DeleteProvider(w http.ResponseWriter, r *http.Request) {
	if err := app.client.Providers().Delete(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name")); err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}

// UpdateProviderBody is the update-provider body. Only non-nil maps are
// applied; credential values are write-only just like create.
type UpdateProviderBody struct {
	Credentials          map[string]string `json:"credentials,omitempty"`
	Config               map[string]string `json:"config,omitempty"`
	CredentialExpiresAtMs map[string]int64  `json:"credentialExpiresAtMs,omitempty"`
}

func (app *App) UpdateProvider(w http.ResponseWriter, r *http.Request) {
	var body UpdateProviderBody
	if !decodeBody(w, r, &body) {
		return
	}
	workspace := chi.URLParam(r, "workspace")
	name := chi.URLParam(r, "name")

	existing, err := app.client.Providers().Get(r.Context(), workspace, name)
	if err != nil {
		writeSDKError(w, err)
		return
	}

	provider := existing
	if body.Credentials != nil {
		provider.Spec.Credentials = body.Credentials
	}
	if body.Config != nil {
		provider.Spec.Config = body.Config
	}
	if body.CredentialExpiresAtMs != nil {
		expires := make(map[string]time.Time, len(body.CredentialExpiresAtMs))
		for k, ms := range body.CredentialExpiresAtMs {
			expires[k] = time.UnixMilli(ms)
		}
		provider.Spec.CredentialExpiresAt = expires
	}

	updated, err := app.client.Providers().Update(r.Context(), workspace, provider)
	if err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.FromProvider(updated))
}

func (app *App) GetProviderRefreshStatus(w http.ResponseWriter, r *http.Request) {
	statuses, err := app.client.Providers().Refresh().GetStatus(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"), "")
	if err != nil {
		writeSDKError(w, err)
		return
	}
	out := make([]models.CredentialRefreshStatus, 0, len(statuses))
	for _, s := range statuses {
		out = append(out, models.FromCredentialRefreshStatus(s))
	}
	writeJSON(w, http.StatusOK, out)
}

var refreshStrategyMap = map[string]openshell.RefreshStrategy{
	"oauth2-refresh-token":       openshell.RefreshStrategyOAuth2RefreshToken,
	"oauth2-client-credentials":  openshell.RefreshStrategyOAuth2ClientCredentials,
	"google-service-account-jwt": openshell.RefreshStrategyGoogleServiceAccountJWT,
	"static":                     openshell.RefreshStrategyStatic,
	"external":                   openshell.RefreshStrategyExternal,
}

type ConfigureProviderRefreshBody struct {
	CredentialKey      string            `json:"credentialKey"`
	Strategy           string            `json:"strategy"`
	Material           map[string]string `json:"material,omitempty"`
	SecretMaterialKeys []string          `json:"secretMaterialKeys,omitempty"`
	ExpiresAtMs        *int64            `json:"expiresAtMs,omitempty"`
}

func (app *App) ConfigureProviderRefresh(w http.ResponseWriter, r *http.Request) {
	var body ConfigureProviderRefreshBody
	if !decodeBody(w, r, &body) {
		return
	}
	if body.CredentialKey == "" || body.Strategy == "" {
		writeError(w, http.StatusBadRequest, "invalid_request", "credentialKey and strategy are required")
		return
	}
	strategy, ok := refreshStrategyMap[body.Strategy]
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_strategy", "unknown refresh strategy: "+body.Strategy)
		return
	}
	cfg := &openshell.RefreshConfig{
		Provider:           chi.URLParam(r, "name"),
		CredentialKey:      body.CredentialKey,
		Strategy:           strategy,
		Material:           body.Material,
		SecretMaterialKeys: body.SecretMaterialKeys,
	}
	if body.ExpiresAtMs != nil {
		t := time.UnixMilli(*body.ExpiresAtMs)
		cfg.ExpiresAt = &t
	}
	status, err := app.client.Providers().Refresh().Configure(r.Context(), chi.URLParam(r, "workspace"), cfg)
	if err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.FromCredentialRefreshStatus(status))
}

type RotateProviderCredentialBody struct {
	CredentialKey string `json:"credentialKey"`
}

func (app *App) RotateProviderCredential(w http.ResponseWriter, r *http.Request) {
	var body RotateProviderCredentialBody
	if !decodeBody(w, r, &body) {
		return
	}
	if body.CredentialKey == "" {
		writeError(w, http.StatusBadRequest, "invalid_request", "credentialKey is required")
		return
	}
	status, err := app.client.Providers().Refresh().Rotate(
		r.Context(),
		chi.URLParam(r, "workspace"),
		chi.URLParam(r, "name"),
		body.CredentialKey,
	)
	if err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.FromCredentialRefreshStatus(status))
}

func (app *App) DeleteProviderRefresh(w http.ResponseWriter, r *http.Request) {
	credentialKey := r.URL.Query().Get("credentialKey")
	if credentialKey == "" {
		writeError(w, http.StatusBadRequest, "invalid_request", "credentialKey query parameter is required")
		return
	}
	deleted, err := app.client.Providers().Refresh().Delete(
		r.Context(),
		chi.URLParam(r, "workspace"),
		chi.URLParam(r, "name"),
		credentialKey,
	)
	if err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": deleted})
}

// ListProviderProfiles returns the provider type profiles whose credential
// schemas drive the Add Provider form.
func (app *App) ListProviderProfiles(w http.ResponseWriter, r *http.Request) {
	profiles, err := app.client.Providers().Profiles().List(r.Context(), chi.URLParam(r, "workspace"))
	if err != nil {
		writeSDKError(w, err)
		return
	}
	out := make([]models.ProviderProfile, 0, len(profiles))
	for _, profile := range profiles {
		out = append(out, models.FromProviderProfile(profile))
	}
	writeJSON(w, http.StatusOK, out)
}
