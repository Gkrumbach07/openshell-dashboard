package models

// Provider mirrors the shape of the real dashboard's Provider DTO
// (backend/internal/models.Provider) at reference-implementation depth.
type Provider struct {
	Name            string            `json:"name"`
	Workspace       string            `json:"workspace"`
	Type            string            `json:"type"`
	Config          map[string]string `json:"config,omitempty"`
	CredentialNames []string          `json:"credentialNames,omitempty"`
}

// CreateProviderRequest is the request body for POST .../providers.
type CreateProviderRequest struct {
	Name   string            `json:"name"`
	Type   string            `json:"type"`
	Config map[string]string `json:"config,omitempty"`
}
