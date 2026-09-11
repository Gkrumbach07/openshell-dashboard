// Package config loads BFF runtime configuration from the environment. It
// lives under internal/ because it's reused wiring, not something
// downstream needs to import directly -- downstream builds its own Config
// or reuses pkg/server.ServerConfig / pkg/clients/openshell.Factory
// directly.
package config

import (
	"os"
	"time"
)

// Config is the BFF's runtime configuration.
type Config struct {
	Addr          string
	GatewayTarget string
	ReadTimeout   time.Duration
	WriteTimeout  time.Duration
	IdleTimeout   time.Duration
}

// Load reads configuration from the environment, applying defaults for
// anything unset.
func Load() Config {
	return Config{
		Addr:          envOr("LISTEN_ADDR", ":8080"),
		GatewayTarget: envOr("OPENSHELL_GATEWAY_URL", "localhost:50051"),
		ReadTimeout:   10 * time.Second,
		WriteTimeout:  10 * time.Second,
		IdleTimeout:   60 * time.Second,
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
