package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/models"

	datamodelv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/datamodelv1"
	openshellv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/openshellv1"
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
	providers, err := app.gateway.ListProviders(r.Context(), chi.URLParam(r, "workspace"), 0, 0)
	if err != nil {
		writeGrpcError(w, err)
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
	provider := &datamodelv1.Provider{
		Metadata: &datamodelv1.ObjectMeta{
			Name:   body.Name,
			Labels: body.Labels,
		},
		Type:        body.Type,
		Credentials: body.Credentials,
		Config:      body.Config,
	}
	created, err := app.gateway.CreateProvider(r.Context(), chi.URLParam(r, "workspace"), provider)
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, models.FromProvider(created))
}

func (app *App) GetProvider(w http.ResponseWriter, r *http.Request) {
	provider, err := app.gateway.GetProvider(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"))
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.FromProvider(provider))
}

func (app *App) DeleteProvider(w http.ResponseWriter, r *http.Request) {
	deleted, err := app.gateway.DeleteProvider(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"))
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": deleted})
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

	existing, err := app.gateway.GetProvider(r.Context(), workspace, name)
	if err != nil {
		writeGrpcError(w, err)
		return
	}

	provider := existing
	if body.Credentials != nil {
		provider.Credentials = body.Credentials
	}
	if body.Config != nil {
		provider.Config = body.Config
	}

	updated, err := app.gateway.UpdateProvider(r.Context(), workspace, provider, body.CredentialExpiresAtMs)
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.FromProvider(updated))
}

func (app *App) GetProviderRefreshStatus(w http.ResponseWriter, r *http.Request) {
	resp, err := app.gateway.GetProviderRefreshStatus(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"), "")
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	out := make([]models.CredentialRefreshStatus, 0, len(resp.GetCredentials()))
	for _, cred := range resp.GetCredentials() {
		out = append(out, models.FromCredentialRefreshStatus(cred))
	}
	writeJSON(w, http.StatusOK, out)
}

var refreshStrategyMap = map[string]openshellv1.ProviderCredentialRefreshStrategy{
	"oauth2-refresh-token":       openshellv1.ProviderCredentialRefreshStrategy_PROVIDER_CREDENTIAL_REFRESH_STRATEGY_OAUTH2_REFRESH_TOKEN,
	"oauth2-client-credentials":  openshellv1.ProviderCredentialRefreshStrategy_PROVIDER_CREDENTIAL_REFRESH_STRATEGY_OAUTH2_CLIENT_CREDENTIALS,
	"google-service-account-jwt": openshellv1.ProviderCredentialRefreshStrategy_PROVIDER_CREDENTIAL_REFRESH_STRATEGY_GOOGLE_SERVICE_ACCOUNT_JWT,
	"aws-sts-assume-role":        openshellv1.ProviderCredentialRefreshStrategy_PROVIDER_CREDENTIAL_REFRESH_STRATEGY_AWS_STS_ASSUME_ROLE,
	"static":                     openshellv1.ProviderCredentialRefreshStrategy_PROVIDER_CREDENTIAL_REFRESH_STRATEGY_STATIC,
	"external":                   openshellv1.ProviderCredentialRefreshStrategy_PROVIDER_CREDENTIAL_REFRESH_STRATEGY_EXTERNAL,
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
	resp, err := app.gateway.ConfigureProviderRefresh(
		r.Context(),
		chi.URLParam(r, "workspace"),
		chi.URLParam(r, "name"),
		body.CredentialKey,
		strategy,
		body.Material,
		body.SecretMaterialKeys,
		body.ExpiresAtMs,
	)
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.FromCredentialRefreshStatus(resp.GetStatus()))
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
	resp, err := app.gateway.RotateProviderCredential(
		r.Context(),
		chi.URLParam(r, "workspace"),
		chi.URLParam(r, "name"),
		body.CredentialKey,
	)
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.FromCredentialRefreshStatus(resp.GetStatus()))
}

func (app *App) DeleteProviderRefresh(w http.ResponseWriter, r *http.Request) {
	credentialKey := r.URL.Query().Get("credentialKey")
	if credentialKey == "" {
		writeError(w, http.StatusBadRequest, "invalid_request", "credentialKey query parameter is required")
		return
	}
	deleted, err := app.gateway.DeleteProviderRefresh(
		r.Context(),
		chi.URLParam(r, "workspace"),
		chi.URLParam(r, "name"),
		credentialKey,
	)
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": deleted})
}

// ListProviderProfiles returns the provider type profiles whose credential
// schemas drive the Add Provider form.
func (app *App) ListProviderProfiles(w http.ResponseWriter, r *http.Request) {
	profiles, err := app.gateway.ListProviderProfiles(r.Context(), chi.URLParam(r, "workspace"), 0, 0)
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	out := make([]models.ProviderProfile, 0, len(profiles))
	for _, profile := range profiles {
		out = append(out, models.FromProviderProfile(profile))
	}
	writeJSON(w, http.StatusOK, out)
}
