// Package auth provides the BFF's authentication middleware. The BFF never
// validates tokens itself — the gateway does that against its own OIDC JWKS.
// The middleware only decides where the bearer for a request comes from, in
// precedence order:
//
//  1. The auth-proxy header (oauth2-proxy / kube-auth-proxy injects
//     `x-forwarded-access-token`).
//  2. An explicit `Authorization: Bearer` header (API clients, tests).
//
// There is deliberately no third source: the BFF holds no sessions and runs
// no OIDC flows (ADR 0002). Deployments that need browser login put an auth
// proxy in front; the proxy authenticates WebSocket upgrades too, since it
// injects the token header on the upgrade request like any other.
package auth

import (
	"context"
	"fmt"
	"net/http"
	"strings"
)

type contextKey int

const (
	tokenContextKey contextKey = iota
	userContextKey
)

// Config holds auth middleware settings.
type Config struct {
	TokenHeader string
	UserHeader  string
	Disabled    bool
}

// Middleware extracts the request's bearer token and stores it on the
// request context for the gateway client to forward.
type Middleware struct {
	cfg Config
}

// New builds the middleware.
func New(cfg Config) *Middleware {
	if cfg.TokenHeader == "" {
		cfg.TokenHeader = "x-forwarded-access-token"
	}
	if cfg.UserHeader == "" {
		cfg.UserHeader = "x-auth-request-user"
	}
	return &Middleware{cfg: cfg}
}

// Disabled reports whether auth validation is turned off.
func (m *Middleware) Disabled() bool {
	return m.cfg.Disabled
}

// TokenHeader returns the configured header name for the bearer token.
func (m *Middleware) TokenHeader() string {
	return m.cfg.TokenHeader
}

// Handler resolves the request's bearer token and stores it on the request
// context. When auth is disabled, a synthetic dev-user identity is injected
// and any tokens on the request are ignored, so a misconfigured proxy cannot
// leak credentials to the gateway in dev mode.
func (m *Middleware) Handler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if m.cfg.Disabled {
			ctx := context.WithValue(r.Context(), userContextKey, "dev-user")
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}

		token := r.Header.Get(m.cfg.TokenHeader)
		if token == "" {
			if bearer := r.Header.Get("Authorization"); strings.HasPrefix(bearer, "Bearer ") {
				token = strings.TrimPrefix(bearer, "Bearer ")
			}
		}
		if token == "" {
			writeUnauthorized(w, "not authenticated")
			return
		}

		ctx := context.WithValue(r.Context(), tokenContextKey, token)
		if user := r.Header.Get(m.cfg.UserHeader); user != "" {
			ctx = context.WithValue(ctx, userContextKey, user)
		}
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func writeUnauthorized(w http.ResponseWriter, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	fmt.Fprintf(w, `{"code":"unauthorized","message":%q}`, message)
}

// TokenFromContext returns the bearer token stored by the middleware, or ""
// when absent.
func TokenFromContext(ctx context.Context) string {
	token, _ := ctx.Value(tokenContextKey).(string)
	return token
}

// WithToken returns a context carrying the given bearer token. Useful in tests.
func WithToken(ctx context.Context, token string) context.Context {
	return context.WithValue(ctx, tokenContextKey, token)
}

// UserFromContext returns the authenticated username, or "" when absent.
func UserFromContext(ctx context.Context) string {
	user, _ := ctx.Value(userContextKey).(string)
	return user
}
