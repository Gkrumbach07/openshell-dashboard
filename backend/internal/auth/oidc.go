// Package auth provides OIDC bearer-token validation middleware for the BFF.
// The validated raw token is stored on the request context so the gateway
// client can forward it on every gRPC call.
package auth

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/coreos/go-oidc/v3/oidc"
)

type contextKey int

const (
	tokenContextKey contextKey = iota
	claimsContextKey
)

// RealmAccess holds the Keycloak realm_access claim structure.
type RealmAccess struct {
	Roles []string `json:"roles"`
}

// Claims is the subset of OIDC ID token claims the dashboard cares about.
type Claims struct {
	Subject     string      `json:"sub"`
	Email       string      `json:"email,omitempty"`
	Name        string      `json:"name,omitempty"`
	Groups      []string    `json:"groups,omitempty"`
	RealmAccess RealmAccess `json:"realm_access,omitempty"`
}

// Roles returns the user's roles by merging Dex-style groups and Keycloak
// realm_access.roles. Both can be present simultaneously and carry different
// semantics (org membership vs role assignment).
func (c *Claims) Roles() []string {
	if len(c.Groups) == 0 {
		return c.RealmAccess.Roles
	}
	if len(c.RealmAccess.Roles) == 0 {
		return c.Groups
	}
	seen := make(map[string]struct{}, len(c.Groups)+len(c.RealmAccess.Roles))
	merged := make([]string, 0, len(c.Groups)+len(c.RealmAccess.Roles))
	for _, r := range c.Groups {
		if _, ok := seen[r]; !ok {
			seen[r] = struct{}{}
			merged = append(merged, r)
		}
	}
	for _, r := range c.RealmAccess.Roles {
		if _, ok := seen[r]; !ok {
			seen[r] = struct{}{}
			merged = append(merged, r)
		}
	}
	return merged
}

// Config holds OIDC settings.
type Config struct {
	// Disabled skips all token validation (dev only, AUTH_DISABLED=true).
	Disabled bool
	// Issuer is the OIDC issuer URL used for discovery and JWKS.
	Issuer string
	// ClientID is the expected audience. Empty skips the audience check.
	ClientID string
}

// Middleware validates OIDC bearer tokens.
type Middleware struct {
	cfg      Config
	verifier *oidc.IDTokenVerifier
}

// New builds the middleware, performing OIDC discovery unless auth is disabled.
func New(ctx context.Context, cfg Config) (*Middleware, error) {
	m := &Middleware{cfg: cfg}
	if cfg.Disabled {
		return m, nil
	}
	if cfg.Issuer == "" {
		return nil, fmt.Errorf("OIDC_ISSUER is required unless AUTH_DISABLED=true")
	}
	provider, err := oidc.NewProvider(ctx, cfg.Issuer)
	if err != nil {
		return nil, fmt.Errorf("oidc discovery for %q: %w", cfg.Issuer, err)
	}
	oidcCfg := &oidc.Config{ClientID: cfg.ClientID}
	if cfg.ClientID == "" {
		oidcCfg.SkipClientIDCheck = true
	}
	m.verifier = provider.Verifier(oidcCfg)
	return m, nil
}

// Disabled reports whether auth validation is turned off.
func (m *Middleware) Disabled() bool {
	return m.cfg.Disabled
}

// Handler validates the Authorization: Bearer token and stores the raw token
// plus parsed claims on the request context.
func (m *Middleware) Handler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if m.cfg.Disabled {
			ctx := context.WithValue(r.Context(), claimsContextKey, &Claims{
				Subject: "dev-user",
				Email:   "dev@localhost",
				Name:    "Development User",
			})
			// Forward a raw token to the gateway if the caller supplied one.
			if token := bearerToken(r); token != "" {
				ctx = context.WithValue(ctx, tokenContextKey, token)
			}
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}

		token := bearerToken(r)
		if token == "" {
			writeUnauthorized(w, "missing bearer token")
			return
		}
		idToken, err := m.verifier.Verify(r.Context(), token)
		if err != nil {
			writeUnauthorized(w, "invalid token")
			return
		}
		claims := &Claims{}
		if err := idToken.Claims(claims); err != nil {
			writeUnauthorized(w, "invalid token claims")
			return
		}
		ctx := context.WithValue(r.Context(), tokenContextKey, token)
		ctx = context.WithValue(ctx, claimsContextKey, claims)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func bearerToken(r *http.Request) string {
	header := r.Header.Get("Authorization")
	if strings.HasPrefix(header, "Bearer ") {
		return strings.TrimPrefix(header, "Bearer ")
	}
	// WebSocket upgrades can't set Authorization headers; accept the token
	// from a query parameter instead.
	if t := r.URL.Query().Get("token"); t != "" && strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		return t
	}
	return ""
}

func writeUnauthorized(w http.ResponseWriter, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	fmt.Fprintf(w, `{"code":"unauthorized","message":%q}`, message)
}

// TokenFromContext returns the raw bearer token stored by the middleware,
// or "" when absent.
func TokenFromContext(ctx context.Context) string {
	token, _ := ctx.Value(tokenContextKey).(string)
	return token
}

// WithToken returns a context carrying the given bearer token. This is
// primarily useful in tests; production code relies on the middleware to
// populate the token via Handler.
func WithToken(ctx context.Context, token string) context.Context {
	return context.WithValue(ctx, tokenContextKey, token)
}

// ClaimsFromContext returns the validated claims, or nil when absent.
func ClaimsFromContext(ctx context.Context) *Claims {
	claims, _ := ctx.Value(claimsContextKey).(*Claims)
	return claims
}
