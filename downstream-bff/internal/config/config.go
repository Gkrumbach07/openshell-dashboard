// Package config loads this BFF's own runtime configuration. Each
// deployable owns its own config — there's no reuse story here even though
// backend-v2 has a nearly identical config package, because env var names
// and defaults are a per-deployment concern, not a shared contract.
package config

import "os"

// Config is this BFF's runtime configuration.
type Config struct {
	Port         string
	TokenHeader  string
	UserHeader   string
	AuthDisabled bool

	SandboxQuotaPerWorkspace int // this BFF's own feature: pkg/provisioning.QuotaEnforcer
}

// Load reads Config from the environment, applying defaults.
func Load() Config {
	return Config{
		Port:                     envOr("PORT", "8081"),
		TokenHeader:              envOr("AUTH_TOKEN_HEADER", "x-forwarded-access-token"),
		UserHeader:               envOr("AUTH_USER_HEADER", "x-auth-request-user"),
		AuthDisabled:             envOr("AUTH_DISABLED", "false") == "true",
		SandboxQuotaPerWorkspace: envInt("SANDBOX_QUOTA_PER_WORKSPACE", 2),
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envInt(key string, fallback int) int {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	n := 0
	for _, c := range v {
		if c < '0' || c > '9' {
			return fallback
		}
		n = n*10 + int(c-'0')
	}
	return n
}
