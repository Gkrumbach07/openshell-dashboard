package models

import "time"

// Sandbox is a single OpenShell sandbox. Sandbox is the fundamental unit in
// the upstream API -- there is no separate "Agent" concept.
type Sandbox struct {
	ID              string            `json:"id,omitempty"`
	Workspace       string            `json:"workspace"`
	Name            string            `json:"name"`
	Labels          map[string]string `json:"labels,omitempty"`
	CreatedAt       time.Time         `json:"createdAt,omitempty"`
	ResourceVersion uint64            `json:"resourceVersion,omitempty"`
	Phase           string            `json:"phase,omitempty"`
	Providers       []string          `json:"providers,omitempty"`
}

// SandboxSpec is the desired-state payload for creating a sandbox.
type SandboxSpec struct {
	Image       string            `json:"image,omitempty"`
	Environment map[string]string `json:"environment,omitempty"`
	Providers   []string          `json:"providers,omitempty"`
	GPUCount    *uint32           `json:"gpuCount,omitempty"`
}
