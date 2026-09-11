package handlers

import (
	"net/http"
	"time"

	openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"

	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/apiutils"
	"github.com/Gkrumbach07/openshell-dashboard/backend/pkg/models"
	"github.com/Gkrumbach07/openshell-dashboard/backend/pkg/services"
)

var refreshStrategyMap = map[string]openshell.RefreshStrategy{
	"oauth2-refresh-token":       openshell.RefreshStrategyOAuth2RefreshToken,
	"oauth2-client-credentials":  openshell.RefreshStrategyOAuth2ClientCredentials,
	"google-service-account-jwt": openshell.RefreshStrategyGoogleServiceAccountJWT,
	"aws-sts-assume-role":        models.RefreshStrategyAWSStsAssumeRole,
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

// UpdateProviderBody is the update-provider body. Only non-nil maps are
// applied; credential values are write-only just like create.
type UpdateProviderBody struct {
	Credentials           map[string]string `json:"credentials,omitempty"`
	Config                map[string]string `json:"config,omitempty"`
	CredentialExpiresAtMs map[string]int64  `json:"credentialExpiresAtMs,omitempty"`
}

type ProvidersHandler struct {
	svc services.ProviderServiceInterface
}

func NewProvidersHandler(svc services.ProviderServiceInterface) *ProvidersHandler {
	return &ProvidersHandler{svc: svc}
}

func (h *ProvidersHandler) ListProviders(w http.ResponseWriter, r *http.Request) {
	providers, err := h.svc.List(r.Context(), r.PathValue("workspace"))
	if err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	out := make([]models.Provider, 0, len(providers))
	for _, provider := range providers {
		out = append(out, models.FromSDKProvider(provider))
	}
	apiutils.WriteJSON(w, http.StatusOK, out)
}

func (h *ProvidersHandler) CreateProvider(w http.ResponseWriter, r *http.Request) {
	var body models.CreateProviderRequest
	if !apiutils.DecodeBody(w, r, &body) {
		return
	}
	if body.Name == "" || body.Type == "" {
		apiutils.WriteError(w, http.StatusBadRequest, apiutils.InvalidProvider, "name and type are required")
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
	created, err := h.svc.Create(r.Context(), r.PathValue("workspace"), provider)
	if err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	apiutils.WriteJSON(w, http.StatusCreated, models.FromSDKProvider(created))
}

func (h *ProvidersHandler) GetProvider(w http.ResponseWriter, r *http.Request) {
	provider, err := h.svc.Get(r.Context(), r.PathValue("workspace"), r.PathValue("name"))
	if err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	apiutils.WriteJSON(w, http.StatusOK, models.FromSDKProvider(provider))
}

func (h *ProvidersHandler) DeleteProvider(w http.ResponseWriter, r *http.Request) {
	if err := h.svc.Delete(r.Context(), r.PathValue("workspace"), r.PathValue("name")); err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	// SDK Delete returns nil error only on successful deletion. If the provider
	// doesn't exist, NotFound is returned (mapped to 404 by apiutils.WriteSDKError).
	apiutils.WriteJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}

func (h *ProvidersHandler) UpdateProvider(w http.ResponseWriter, r *http.Request) {
	var body UpdateProviderBody
	if !apiutils.DecodeBody(w, r, &body) {
		return
	}
	workspace := r.PathValue("workspace")
	name := r.PathValue("name")

	provider, err := h.svc.Get(r.Context(), workspace, name)
	if err != nil {
		apiutils.WriteSDKError(w, err)
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

	updated, err := h.svc.Update(r.Context(), workspace, provider)
	if err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	apiutils.WriteJSON(w, http.StatusOK, models.FromSDKProvider(updated))
}

func (h *ProvidersHandler) GetProviderRefreshStatus(w http.ResponseWriter, r *http.Request) {
	statuses, err := h.svc.Refresh().GetStatus(r.Context(), r.PathValue("workspace"), r.PathValue("name"), "")
	if err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	out := make([]models.CredentialRefreshStatus, 0, len(statuses))
	for _, s := range statuses {
		out = append(out, models.FromSDKRefreshStatus(s))
	}
	apiutils.WriteJSON(w, http.StatusOK, out)
}

func (h *ProvidersHandler) ConfigureProviderRefresh(w http.ResponseWriter, r *http.Request) {
	var body ConfigureProviderRefreshBody
	if !apiutils.DecodeBody(w, r, &body) {
		return
	}
	if body.CredentialKey == "" || body.Strategy == "" {
		apiutils.WriteError(w, http.StatusBadRequest, apiutils.InvalidRequest, "credentialKey and strategy are required")
		return
	}
	strategy, ok := refreshStrategyMap[body.Strategy]
	if !ok {
		apiutils.WriteError(w, http.StatusBadRequest, apiutils.InvalidStrategy, "unknown refresh strategy: "+body.Strategy)
		return
	}
	cfg := &openshell.RefreshConfig{
		Provider:           r.PathValue("name"),
		CredentialKey:      body.CredentialKey,
		Strategy:           strategy,
		Material:           body.Material,
		SecretMaterialKeys: body.SecretMaterialKeys,
	}
	if body.ExpiresAtMs != nil {
		t := time.UnixMilli(*body.ExpiresAtMs)
		cfg.ExpiresAt = &t
	}
	status, err := h.svc.Refresh().Configure(r.Context(), r.PathValue("workspace"), cfg)
	if err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	apiutils.WriteJSON(w, http.StatusOK, models.FromSDKRefreshStatus(status))
}

type RotateProviderCredentialBody struct {
	CredentialKey string `json:"credentialKey"`
}

func (h *ProvidersHandler) RotateProviderCredential(w http.ResponseWriter, r *http.Request) {
	var body RotateProviderCredentialBody
	if !apiutils.DecodeBody(w, r, &body) {
		return
	}
	if body.CredentialKey == "" {
		apiutils.WriteError(w, http.StatusBadRequest, apiutils.InvalidRequest, "credentialKey is required")
		return
	}
	status, err := h.svc.Refresh().Rotate(
		r.Context(),
		r.PathValue("workspace"),
		r.PathValue("name"),
		body.CredentialKey,
	)
	if err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	apiutils.WriteJSON(w, http.StatusOK, models.FromSDKRefreshStatus(status))
}

func (h *ProvidersHandler) DeleteProviderRefresh(w http.ResponseWriter, r *http.Request) {
	credentialKey := r.URL.Query().Get("credentialKey")
	if credentialKey == "" {
		apiutils.WriteError(w, http.StatusBadRequest, apiutils.InvalidRequest, "credentialKey query parameter is required")
		return
	}
	deleted, err := h.svc.Refresh().Delete(
		r.Context(),
		r.PathValue("workspace"),
		r.PathValue("name"),
		credentialKey,
	)
	if err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	apiutils.WriteJSON(w, http.StatusOK, map[string]bool{"deleted": deleted})
}

// ListProviderProfiles returns the provider type profiles whose credential
// schemas drive the Add Provider form.
func (h *ProvidersHandler) ListProviderProfiles(w http.ResponseWriter, r *http.Request) {
	profiles, err := h.svc.Profiles().List(r.Context(), r.PathValue("workspace"))
	if err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	out := make([]models.ProviderProfile, 0, len(profiles))
	for _, profile := range profiles {
		out = append(out, models.FromSDKProviderProfile(profile))
	}
	apiutils.WriteJSON(w, http.StatusOK, out)
}

func (h *ProvidersHandler) GetProviderProfile(w http.ResponseWriter, r *http.Request) {
	profile, err := h.svc.Profiles().Get(r.Context(), r.PathValue("workspace"), r.PathValue("profileId"))
	if err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	apiutils.WriteJSON(w, http.StatusOK, models.FromSDKProviderProfile(profile))
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

func (h *ProvidersHandler) ImportProviderProfiles(w http.ResponseWriter, r *http.Request) {
	var body ImportProviderProfilesBody
	if !apiutils.DecodeBody(w, r, &body) {
		return
	}
	if len(body.Profiles) == 0 {
		apiutils.WriteError(w, http.StatusBadRequest, apiutils.InvalidRequest, "at least one profile is required")
		return
	}
	items := make([]openshell.ProfileImportItem, 0, len(body.Profiles))
	for _, p := range body.Profiles {
		if p.ID == "" || p.DisplayName == "" {
			apiutils.WriteError(w, http.StatusBadRequest, apiutils.InvalidProfile, "id and displayName are required")
			return
		}
		items = append(items, toSDKProfileImportItem(p))
	}
	resp, err := h.svc.Profiles().Import(r.Context(), r.PathValue("workspace"), items)
	if err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	profiles := make([]models.ProviderProfile, 0, len(resp.Profiles))
	for i := range resp.Profiles {
		profiles = append(profiles, models.FromSDKProviderProfile(&resp.Profiles[i]))
	}
	apiutils.WriteJSON(w, http.StatusCreated, models.ImportProviderProfilesResult{
		Diagnostics: models.FromSDKDiagnostics(resp.Diagnostics),
		Profiles:    profiles,
		Imported:    resp.Imported,
	})
}

type UpdateProviderProfileBody struct {
	Profile                 ImportProfileBody `json:"profile"`
	ExpectedResourceVersion uint64            `json:"expectedResourceVersion,omitempty"`
}

func (h *ProvidersHandler) UpdateProviderProfile(w http.ResponseWriter, r *http.Request) {
	var body UpdateProviderProfileBody
	if !apiutils.DecodeBody(w, r, &body) {
		return
	}
	profileID := r.PathValue("profileId")
	if body.Profile.ID != "" && body.Profile.ID != profileID {
		apiutils.WriteError(w, http.StatusBadRequest, apiutils.IdMismatch, "profile id in body must match URL")
		return
	}
	body.Profile.ID = profileID
	resp, err := h.svc.Profiles().Update(
		r.Context(),
		r.PathValue("workspace"),
		profileID,
		body.ExpectedResourceVersion,
		toSDKProfileImportItem(body.Profile),
	)
	if err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	var profile *models.ProviderProfile
	if resp.Profile != nil {
		p := models.FromSDKProviderProfile(resp.Profile)
		profile = &p
	}
	apiutils.WriteJSON(w, http.StatusOK, models.UpdateProviderProfileResult{
		Diagnostics: models.FromSDKDiagnostics(resp.Diagnostics),
		Profile:     profile,
		Updated:     resp.Updated,
	})
}

func (h *ProvidersHandler) DeleteProviderProfile(w http.ResponseWriter, r *http.Request) {
	deleted, err := h.svc.Profiles().Delete(r.Context(), r.PathValue("workspace"), r.PathValue("profileId"))
	if err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	apiutils.WriteJSON(w, http.StatusOK, map[string]bool{"deleted": deleted})
}

type LintProviderProfilesBody struct {
	Profiles []ImportProfileBody `json:"profiles"`
}

func (h *ProvidersHandler) LintProviderProfiles(w http.ResponseWriter, r *http.Request) {
	var body LintProviderProfilesBody
	if !apiutils.DecodeBody(w, r, &body) {
		return
	}
	items := make([]openshell.ProfileImportItem, 0, len(body.Profiles))
	for _, p := range body.Profiles {
		items = append(items, toSDKProfileImportItem(p))
	}
	resp, err := h.svc.Profiles().Lint(r.Context(), r.PathValue("workspace"), items)
	if err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	apiutils.WriteJSON(w, http.StatusOK, models.LintProviderProfilesResult{
		Diagnostics: models.FromSDKDiagnostics(resp.Diagnostics),
		Valid:       resp.Valid,
	})
}
