package api

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"

	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/models"
)

func (app *App) ListProviders(w http.ResponseWriter, r *http.Request) {
	providers, err := app.sdk.Providers().List(r.Context(), chi.URLParam(r, "workspace"))
	if err != nil {
		writeSDKError(w, err)
		return
	}
	out := make([]models.Provider, 0, len(providers))
	for _, provider := range providers {
		out = append(out, models.FromSDKProvider(provider))
	}
	writeJSON(w, http.StatusOK, out)
}

func (app *App) CreateProvider(w http.ResponseWriter, r *http.Request) {
	var body models.CreateProviderRequest
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
	created, err := app.sdk.Providers().Create(r.Context(), chi.URLParam(r, "workspace"), provider)
	if err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, models.FromSDKProvider(created))
}

func (app *App) GetProvider(w http.ResponseWriter, r *http.Request) {
	provider, err := app.sdk.Providers().Get(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"))
	if err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.FromSDKProvider(provider))
}

func (app *App) DeleteProvider(w http.ResponseWriter, r *http.Request) {
	if err := app.sdk.Providers().Delete(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name")); err != nil {
		writeSDKError(w, err)
		return
	}
	// SDK Delete returns nil error only on successful deletion. If the provider
	// doesn't exist, NotFound is returned (mapped to 404 by writeSDKError).
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}

// UpdateProviderBody is the update-provider body. Only non-nil maps are
// applied; credential values are write-only just like create.
type UpdateProviderBody struct {
	Credentials           map[string]string `json:"credentials,omitempty"`
	Config                map[string]string `json:"config,omitempty"`
	CredentialExpiresAtMs map[string]int64  `json:"credentialExpiresAtMs,omitempty"`
}

func (app *App) UpdateProvider(w http.ResponseWriter, r *http.Request) {
	var body UpdateProviderBody
	if !decodeBody(w, r, &body) {
		return
	}
	workspace := chi.URLParam(r, "workspace")
	name := chi.URLParam(r, "name")

	provider, err := app.sdk.Providers().Get(r.Context(), workspace, name)
	if err != nil {
		writeSDKError(w, err)
		return
	}

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

	updated, err := app.sdk.Providers().Update(r.Context(), workspace, provider)
	if err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.FromSDKProvider(updated))
}

func (app *App) GetProviderRefreshStatus(w http.ResponseWriter, r *http.Request) {
	statuses, err := app.sdk.Providers().Refresh().GetStatus(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"), "")
	if err != nil {
		writeSDKError(w, err)
		return
	}
	out := make([]models.CredentialRefreshStatus, 0, len(statuses))
	for _, s := range statuses {
		out = append(out, models.FromSDKRefreshStatus(s))
	}
	writeJSON(w, http.StatusOK, out)
}

// awsStsAssumeRole is defined in SDK types but not re-exported from openshell/v1.
const awsStsAssumeRole openshell.RefreshStrategy = "AWSStsAssumeRole"

var refreshStrategyMap = map[string]openshell.RefreshStrategy{
	"oauth2-refresh-token":       openshell.RefreshStrategyOAuth2RefreshToken,
	"oauth2-client-credentials":  openshell.RefreshStrategyOAuth2ClientCredentials,
	"google-service-account-jwt": openshell.RefreshStrategyGoogleServiceAccountJWT,
	"aws-sts-assume-role":        awsStsAssumeRole,
	"static":                     openshell.RefreshStrategyStatic,
	"external":                   openshell.RefreshStrategyExternal,
}

type ConfigureProviderRefreshBody struct {
	Material           map[string]string `json:"material,omitempty"`
	ExpiresAtMs        *int64            `json:"expiresAtMs,omitempty"`
	CredentialKey      string            `json:"credentialKey"`
	Strategy           string            `json:"strategy"`
	SecretMaterialKeys []string          `json:"secretMaterialKeys,omitempty"`
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
	status, err := app.sdk.Providers().Refresh().Configure(r.Context(), chi.URLParam(r, "workspace"), cfg)
	if err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.FromSDKRefreshStatus(status))
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
	status, err := app.sdk.Providers().Refresh().Rotate(
		r.Context(),
		chi.URLParam(r, "workspace"),
		chi.URLParam(r, "name"),
		body.CredentialKey,
	)
	if err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.FromSDKRefreshStatus(status))
}

func (app *App) DeleteProviderRefresh(w http.ResponseWriter, r *http.Request) {
	credentialKey := r.URL.Query().Get("credentialKey")
	if credentialKey == "" {
		writeError(w, http.StatusBadRequest, "invalid_request", "credentialKey query parameter is required")
		return
	}
	deleted, err := app.sdk.Providers().Refresh().Delete(
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
	profiles, err := app.sdk.Providers().Profiles().List(r.Context(), chi.URLParam(r, "workspace"))
	if err != nil {
		writeSDKError(w, err)
		return
	}
	out := make([]models.ProviderProfile, 0, len(profiles))
	for _, profile := range profiles {
		out = append(out, models.FromSDKProviderProfile(profile))
	}
	writeJSON(w, http.StatusOK, out)
}

func (app *App) GetProviderProfile(w http.ResponseWriter, r *http.Request) {
	profile, err := app.sdk.Providers().Profiles().Get(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "profileId"))
	if err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.FromSDKProviderProfile(profile))
}

type ImportProfileCredentialBody struct {
	Name        string   `json:"name"`
	Description string   `json:"description,omitempty"`
	AuthStyle   string   `json:"authStyle,omitempty"`
	EnvVars     []string `json:"envVars,omitempty"`
	Required    bool     `json:"required"`
}

type ImportProfileBody struct {
	ID               string                        `json:"id"`
	DisplayName      string                        `json:"displayName"`
	Description      string                        `json:"description,omitempty"`
	Category         string                        `json:"category"`
	Credentials      []ImportProfileCredentialBody `json:"credentials,omitempty"`
	Endpoints        []EndpointBody                `json:"endpoints,omitempty"`
	InferenceCapable bool                          `json:"inferenceCapable"`
	ResourceVersion  uint64                        `json:"resourceVersion,omitempty"`
}

type EndpointBody struct {
	Host string `json:"host"`
	Port uint32 `json:"port,omitempty"`
}

type ImportProviderProfilesBody struct {
	Profiles []ImportProfileBody `json:"profiles"`
}

func toSDKProfileImportItem(body ImportProfileBody) openshell.ProfileImportItem {
	creds := make([]openshell.ProfileCredential, 0, len(body.Credentials))
	for _, c := range body.Credentials {
		creds = append(creds, openshell.ProfileCredential{
			Name:        c.Name,
			Description: c.Description,
			EnvVars:     c.EnvVars,
			Required:    c.Required,
			AuthStyle:   c.AuthStyle,
		})
	}
	endpoints := make([]openshell.NetworkEndpoint, 0, len(body.Endpoints))
	for _, e := range body.Endpoints {
		endpoints = append(endpoints, openshell.NetworkEndpoint{
			Host: e.Host,
			Port: e.Port,
		})
	}
	return openshell.ProfileImportItem{
		Profile: openshell.ProviderProfile{
			ID:               body.ID,
			DisplayName:      body.DisplayName,
			Description:      body.Description,
			Category:         models.ParseSDKProfileCategory(body.Category),
			Credentials:      creds,
			Endpoints:        endpoints,
			InferenceCapable: body.InferenceCapable,
			ResourceVersion:  body.ResourceVersion,
		},
	}
}

func (app *App) ImportProviderProfiles(w http.ResponseWriter, r *http.Request) {
	var body ImportProviderProfilesBody
	if !decodeBody(w, r, &body) {
		return
	}
	if len(body.Profiles) == 0 {
		writeError(w, http.StatusBadRequest, "invalid_request", "at least one profile is required")
		return
	}
	items := make([]openshell.ProfileImportItem, 0, len(body.Profiles))
	for _, p := range body.Profiles {
		if p.ID == "" || p.DisplayName == "" {
			writeError(w, http.StatusBadRequest, "invalid_profile", "id and displayName are required")
			return
		}
		items = append(items, toSDKProfileImportItem(p))
	}
	resp, err := app.sdk.Providers().Profiles().Import(r.Context(), chi.URLParam(r, "workspace"), items)
	if err != nil {
		writeSDKError(w, err)
		return
	}
	profiles := make([]models.ProviderProfile, 0, len(resp.Profiles))
	for i := range resp.Profiles {
		profiles = append(profiles, models.FromSDKProviderProfile(&resp.Profiles[i]))
	}
	writeJSON(w, http.StatusCreated, models.ImportProviderProfilesResult{
		Diagnostics: models.FromSDKDiagnostics(resp.Diagnostics),
		Profiles:    profiles,
		Imported:    resp.Imported,
	})
}

type UpdateProviderProfileBody struct {
	Profile                 ImportProfileBody `json:"profile"`
	ExpectedResourceVersion uint64            `json:"expectedResourceVersion,omitempty"`
}

func (app *App) UpdateProviderProfile(w http.ResponseWriter, r *http.Request) {
	var body UpdateProviderProfileBody
	if !decodeBody(w, r, &body) {
		return
	}
	profileID := chi.URLParam(r, "profileId")
	if body.Profile.ID != "" && body.Profile.ID != profileID {
		writeError(w, http.StatusBadRequest, "id_mismatch", "profile id in body must match URL")
		return
	}
	body.Profile.ID = profileID
	resp, err := app.sdk.Providers().Profiles().Update(
		r.Context(),
		chi.URLParam(r, "workspace"),
		profileID,
		body.ExpectedResourceVersion,
		toSDKProfileImportItem(body.Profile),
	)
	if err != nil {
		writeSDKError(w, err)
		return
	}
	var profile *models.ProviderProfile
	if resp.Profile != nil {
		p := models.FromSDKProviderProfile(resp.Profile)
		profile = &p
	}
	writeJSON(w, http.StatusOK, models.UpdateProviderProfileResult{
		Diagnostics: models.FromSDKDiagnostics(resp.Diagnostics),
		Profile:     profile,
		Updated:     resp.Updated,
	})
}

func (app *App) DeleteProviderProfile(w http.ResponseWriter, r *http.Request) {
	deleted, err := app.sdk.Providers().Profiles().Delete(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "profileId"))
	if err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": deleted})
}

type LintProviderProfilesBody struct {
	Profiles []ImportProfileBody `json:"profiles"`
}

func (app *App) LintProviderProfiles(w http.ResponseWriter, r *http.Request) {
	var body LintProviderProfilesBody
	if !decodeBody(w, r, &body) {
		return
	}
	items := make([]openshell.ProfileImportItem, 0, len(body.Profiles))
	for _, p := range body.Profiles {
		items = append(items, toSDKProfileImportItem(p))
	}
	resp, err := app.sdk.Providers().Profiles().Lint(r.Context(), chi.URLParam(r, "workspace"), items)
	if err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.LintProviderProfilesResult{
		Diagnostics: models.FromSDKDiagnostics(resp.Diagnostics),
		Valid:       resp.Valid,
	})
}
