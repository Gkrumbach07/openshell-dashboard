// Package auth provides proxy-delegated authentication middleware for the BFF.
// An external auth proxy (oauth2-proxy, kube-rbac-proxy, etc.) handles OIDC
// validation and injects the bearer token and username as HTTP headers. The
// middleware reads those headers and stores the token on the request context so
// the gateway client can forward it on every gRPC call.
package auth

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"
)

const TerminalTokenCookieName = "__Host-openshell-terminal-token" //nolint:gosec // Cookie name, not a credential.

type contextKey int

const (
	tokenContextKey contextKey = iota
	userContextKey
)

// Config holds proxy-auth settings.
type Config struct {
	TokenHeader string
	UserHeader  string
	Disabled    bool
}

// Middleware reads auth headers injected by a reverse proxy.
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

// Handler reads the auth proxy headers and stores the token and username on
// the request context. When auth is disabled, a synthetic dev-user identity
// is injected.
func (m *Middleware) Handler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if m.cfg.Disabled {
			ctx := context.WithValue(r.Context(), userContextKey, "dev-user")
			token := r.Header.Get(m.cfg.TokenHeader)
			if token == "" {
				if bearer := r.Header.Get("Authorization"); strings.HasPrefix(bearer, "Bearer ") {
					token = strings.TrimPrefix(bearer, "Bearer ")
				}
			}
			if token != "" {
				ctx = context.WithValue(ctx, tokenContextKey, token)
			}
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}

		token := r.Header.Get(m.cfg.TokenHeader)
		if token == "" {
			if bearer := r.Header.Get("Authorization"); strings.HasPrefix(bearer, "Bearer ") {
				token = strings.TrimPrefix(bearer, "Bearer ")
			}
		}
		if token == "" && isWebSocketUpgrade(r) {
			if cookie, err := r.Cookie(TerminalTokenCookieName); err == nil {
				token = cookie.Value
			}
		}
		if token == "" {
			writeUnauthorized(w, "missing auth proxy token header")
			return
		}

		ctx := context.WithValue(r.Context(), tokenContextKey, token)
		if user := r.Header.Get(m.cfg.UserHeader); user != "" {
			ctx = context.WithValue(ctx, userContextKey, user)
		}
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func isWebSocketUpgrade(r *http.Request) bool {
	if !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		return false
	}
	for value := range strings.SplitSeq(r.Header.Get("Connection"), ",") {
		if strings.EqualFold(strings.TrimSpace(value), "upgrade") {
			return true
		}
	}
	return false
}

// SetTerminalTokenCookie stores the OIDC token for authenticated WebSocket
// handshakes. The middleware only reads this cookie on WebSocket upgrades;
// ordinary API requests must continue to send an Authorization header.
func SetTerminalTokenCookie(w http.ResponseWriter, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     TerminalTokenCookieName,
		Value:    token,
		Path:     "/",
		Secure:   true,
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
	})
}

// ClearTerminalTokenCookie removes the WebSocket authentication cookie.
func ClearTerminalTokenCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     TerminalTokenCookieName,
		Path:     "/",
		MaxAge:   -1,
		Expires:  time.Unix(1, 0),
		Secure:   true,
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
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
