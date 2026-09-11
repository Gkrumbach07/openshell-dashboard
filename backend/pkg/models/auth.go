package models

// AuthConfigResponse tells the frontend whether auth is enabled and which
// features are available.
type AuthConfigResponse struct {
	AdminRole    string       `json:"adminRole,omitempty"`
	LogoutURL    string       `json:"logoutUrl,omitempty"`
	Features     FeatureFlags `json:"features"`
	AuthDisabled bool         `json:"authDisabled"`
}
