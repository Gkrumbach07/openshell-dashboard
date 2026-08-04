package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/models"

	datamodelv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/datamodelv1"
	openshellv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/openshellv1"
	sandboxv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/sandboxv1"
)

// CreateProviderRequest is the create-provider body. Credentials are
// write-only: accepted here, forwarded to the gateway, never returned.
type CreateProviderRequest struct {
	Credentials map[string]string `json:"credentials,omitempty"`
	Config      map[string]string `json:"config,omitempty"`
	Labels      map[string]string `json:"labels,omitempty"`
	Name        string            `json:"name"`
	Type        string            `json:"type"`
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

func (app *App) GetProviderProfile(w http.ResponseWriter, r *http.Request) {
	profile, err := app.gateway.GetProviderProfile(r.Context(), chi.URLParam(r, "profileId"), chi.URLParam(r, "workspace"))
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.FromProviderProfile(profile))
}

type ImportProfileCredentialBody struct {
	Name        string   `json:"name"`
	Description string   `json:"description,omitempty"`
	EnvVars     []string `json:"envVars,omitempty"`
	Required    bool     `json:"required"`
	AuthStyle   string   `json:"authStyle,omitempty"`
}

type ImportProfileBody struct {
	ID               string                        `json:"id"`
	DisplayName      string                        `json:"displayName"`
	Description      string                        `json:"description,omitempty"`
	Category         string                        `json:"category"`
	Credentials      []ImportProfileCredentialBody  `json:"credentials,omitempty"`
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

var profileCategoryMap = map[string]openshellv1.ProviderProfileCategory{
	"OTHER":          openshellv1.ProviderProfileCategory_PROVIDER_PROFILE_CATEGORY_OTHER,
	"INFERENCE":      openshellv1.ProviderProfileCategory_PROVIDER_PROFILE_CATEGORY_INFERENCE,
	"AGENT":          openshellv1.ProviderProfileCategory_PROVIDER_PROFILE_CATEGORY_AGENT,
	"SOURCE_CONTROL": openshellv1.ProviderProfileCategory_PROVIDER_PROFILE_CATEGORY_SOURCE_CONTROL,
	"MESSAGING":      openshellv1.ProviderProfileCategory_PROVIDER_PROFILE_CATEGORY_MESSAGING,
	"DATA":           openshellv1.ProviderProfileCategory_PROVIDER_PROFILE_CATEGORY_DATA,
	"KNOWLEDGE":      openshellv1.ProviderProfileCategory_PROVIDER_PROFILE_CATEGORY_KNOWLEDGE,
}

func toProfileImportItem(body ImportProfileBody) *openshellv1.ProviderProfileImportItem {
	creds := make([]*openshellv1.ProviderProfileCredential, 0, len(body.Credentials))
	for _, c := range body.Credentials {
		creds = append(creds, &openshellv1.ProviderProfileCredential{
			Name:        c.Name,
			Description: c.Description,
			EnvVars:     c.EnvVars,
			Required:    c.Required,
			AuthStyle:   c.AuthStyle,
		})
	}
	endpoints := make([]*sandboxv1.NetworkEndpoint, 0, len(body.Endpoints))
	for _, e := range body.Endpoints {
		endpoints = append(endpoints, &sandboxv1.NetworkEndpoint{
			Host: e.Host,
			Port: e.Port,
		})
	}
	cat := openshellv1.ProviderProfileCategory_PROVIDER_PROFILE_CATEGORY_OTHER
	if c, ok := profileCategoryMap[body.Category]; ok {
		cat = c
	}
	return &openshellv1.ProviderProfileImportItem{
		Profile: &openshellv1.ProviderProfile{
			Id:               body.ID,
			DisplayName:      body.DisplayName,
			Description:      body.Description,
			Category:         cat,
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
	items := make([]*openshellv1.ProviderProfileImportItem, 0, len(body.Profiles))
	for _, p := range body.Profiles {
		if p.ID == "" || p.DisplayName == "" {
			writeError(w, http.StatusBadRequest, "invalid_profile", "id and displayName are required")
			return
		}
		items = append(items, toProfileImportItem(p))
	}
	resp, err := app.gateway.ImportProviderProfiles(r.Context(), chi.URLParam(r, "workspace"), items)
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	profiles := make([]models.ProviderProfile, 0, len(resp.GetProfiles()))
	for _, p := range resp.GetProfiles() {
		profiles = append(profiles, models.FromProviderProfile(p))
	}
	writeJSON(w, http.StatusCreated, models.ImportProviderProfilesResult{
		Diagnostics: models.FromDiagnostics(resp.GetDiagnostics()),
		Profiles:    profiles,
		Imported:    resp.GetImported(),
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
	item := toProfileImportItem(body.Profile)
	resp, err := app.gateway.UpdateProviderProfile(r.Context(), chi.URLParam(r, "workspace"), profileID, item, body.ExpectedResourceVersion)
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	var profile *models.ProviderProfile
	if resp.GetProfile() != nil {
		p := models.FromProviderProfile(resp.GetProfile())
		profile = &p
	}
	writeJSON(w, http.StatusOK, models.UpdateProviderProfileResult{
		Diagnostics: models.FromDiagnostics(resp.GetDiagnostics()),
		Profile:     profile,
		Updated:     resp.GetUpdated(),
	})
}

func (app *App) DeleteProviderProfile(w http.ResponseWriter, r *http.Request) {
	deleted, err := app.gateway.DeleteProviderProfile(r.Context(), chi.URLParam(r, "profileId"), chi.URLParam(r, "workspace"))
	if err != nil {
		writeGrpcError(w, err)
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
	items := make([]*openshellv1.ProviderProfileImportItem, 0, len(body.Profiles))
	for _, p := range body.Profiles {
		items = append(items, toProfileImportItem(p))
	}
	resp, err := app.gateway.LintProviderProfiles(r.Context(), chi.URLParam(r, "workspace"), items)
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.LintProviderProfilesResult{
		Diagnostics: models.FromDiagnostics(resp.GetDiagnostics()),
		Valid:       resp.GetValid(),
	})
}
