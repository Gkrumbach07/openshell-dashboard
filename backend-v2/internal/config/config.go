// Package config loads process configuration from the environment. It is
// under internal/ because it is reused across cmd/ entrypoints but is not
// part of this project's public API — downstream should not import it.
package config

import "os"

// Config is the BFF's runtime configuration.
type Config struct {
	Port            string
	AuditDecorators bool // demo flag: wrap services with the example decorator

	// Auth, mirroring backend/cmd/server/main.go's flags exactly.
	AuthDisabled bool   // dev only — see internal/auth doc comment
	TokenHeader  string // header injected by the auth proxy with the bearer token
	UserHeader   string // header injected by the auth proxy with the username
}

// Load reads Config from the environment, applying defaults.
func Load() Config {
	return Config{
		Port:            envOr("PORT", "8080"),
		AuditDecorators: envOr("AUDIT_DECORATORS", "true") == "true",
		AuthDisabled:    envOr("AUTH_DISABLED", "false") == "true",
		TokenHeader:     envOr("AUTH_TOKEN_HEADER", "x-forwarded-access-token"),
		UserHeader:      envOr("AUTH_USER_HEADER", "x-auth-request-user"),
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
