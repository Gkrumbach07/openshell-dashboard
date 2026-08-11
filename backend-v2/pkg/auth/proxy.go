// Package auth provides the BFF's authentication middleware, ported as-is
// from backend/internal/auth/proxy.go (same relay-only model, ADR 0002 /
// ADR 0014). The BFF never validates tokens itself — the gateway does that
// against its own OIDC JWKS. The middleware only decides where the bearer
// for a request comes from, in precedence order:
//
//  1. The auth-proxy header (oauth2-proxy / kube-auth-proxy injects
//     `x-forwarded-access-token`).
//  2. An explicit `Authorization: Bearer` header (API clients, tests).
//
// The industry-standard mechanism for threading the token from HTTP
// middleware down to the transport layer (here, pkg/gateway) is a plain
// context.Value with an unexported key type — not a global, not a struct
// field on every service. That's what TokenFromContext/WithToken below do;
// pkg/gateway reads the token off ctx exactly like
// backend/internal/gateway/client.go's grpc.PerRPCCredentials does.
//
// pkg/ (not internal/): the relay-only auth model (ADR 0002) is a
// platform-wide decision, not specific to this BFF — every downstream BFF
// that fronts the same proxy needs the identical header-precedence and
// context-plumbing logic. It was originally placed under internal/ as
// "infrastructure, not a customizable domain component," but internal/ is
// enforced by the Go toolchain at the *module* boundary: a genuinely
// separate downstream module cannot import it at all, forcing a
// reimplementation of security-relevant code instead of reuse. Downstream
// still shouldn't fork the *logic* (Handler, TokenFromContext) — only
// Config is meant to vary per deployment.
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
// request context for downstream services (via pkg/gateway) to forward.
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
// when absent. pkg/gateway calls this to forward the token to the real
// OpenShell gateway (see the doc comment above for why context, not a
// struct field).
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
