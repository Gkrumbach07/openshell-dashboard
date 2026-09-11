package models

import "time"

type Provider struct {
	ID              string            `json:"id,omitempty"`
	Workspace       string            `json:"workspace"`
	Name            string            `json:"name"`
	Type            string            `json:"type"`
	Labels          map[string]string `json:"labels,omitempty"`
	CreatedAt       time.Time         `json:"createdAt,omitempty"`
	ResourceVersion uint64            `json:"resourceVersion,omitempty"`
	Spec            ProviderSpec      `json:"spec"`
}

// ProviderSpec holds provider-specific configuration and credentials.
type ProviderSpec struct {
	Credentials map[string]string `json:"credentials,omitempty"`
	Config      map[string]string `json:"config,omitempty"`
}

// --- Profile (SDK: ProfileInterface, client.Providers().Profiles()) ---

// ProviderProfile is a template of connection details/defaults for a
// provider type (e.g. "openai", "anthropic").
type ProviderProfile struct {
	ID               string              `json:"id,omitempty"`
	DisplayName      string              `json:"displayName"`
	Description      string              `json:"description,omitempty"`
	Category         string              `json:"category,omitempty"`
	Credentials      []ProfileCredential `json:"credentials,omitempty"`
	Endpoints        []NetworkEndpoint   `json:"endpoints,omitempty"`
	InferenceCapable bool                `json:"inferenceCapable,omitempty"`
	ResourceVersion  uint64              `json:"resourceVersion,omitempty"`
}
