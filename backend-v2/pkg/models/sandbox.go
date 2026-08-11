// Package models holds wire-level DTOs shared by handlers and services.
// These are plain structs (no upstream proto types) so this reference BFF
// builds standalone. A production port would keep proto->DTO converters here
// exactly like backend/internal/models — see backend/internal/models/models.go.
package models

// Sandbox mirrors the shape of the real dashboard's Sandbox DTO
// (backend/internal/models.Sandbox) at reference-implementation depth.
type Sandbox struct {
	Name      string            `json:"name"`
	Workspace string            `json:"workspace"`
	Image     string            `json:"image"`
	Phase     string            `json:"phase"`
	Labels    map[string]string `json:"labels,omitempty"`
}

// CreateSandboxRequest is the request body for POST .../sandboxes.
type CreateSandboxRequest struct {
	Name   string            `json:"name"`
	Image  string            `json:"image"`
	Labels map[string]string `json:"labels,omitempty"`
}
