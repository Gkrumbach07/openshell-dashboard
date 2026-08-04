package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestBearerTokenFromHeader(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer my-jwt-token")

	got := bearerToken(req)
	if got != "my-jwt-token" {
		t.Errorf("bearerToken = %q, want my-jwt-token", got)
	}
}

func TestBearerTokenFromCookieFallback(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	got := bearerToken(req)
	if got != "" {
		t.Errorf("bearerToken = %q, want empty (no cookie fallback for non-websocket)", got)
	}
}

func TestBearerTokenMissing(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	got := bearerToken(req)
	if got != "" {
		t.Errorf("bearerToken = %q, want empty", got)
	}
}

func TestBearerTokenInvalidPrefix(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Basic dXNlcjpwYXNz")

	got := bearerToken(req)
	if got != "" {
		t.Errorf("bearerToken = %q, want empty (Basic auth ignored)", got)
	}
}

func TestBearerTokenWebSocketQuery(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/?token=ws-token", nil)
	req.Header.Set("Upgrade", "websocket")

	got := bearerToken(req)
	if got != "ws-token" {
		t.Errorf("bearerToken = %q, want ws-token", got)
	}
}

func TestBearerTokenQueryIgnoredWithoutUpgrade(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/?token=ws-token", nil)

	got := bearerToken(req)
	if got != "" {
		t.Errorf("bearerToken = %q, want empty (no Upgrade header)", got)
	}
}

func TestTokenFromContext(t *testing.T) {
	ctx := context.Background()
	if got := TokenFromContext(ctx); got != "" {
		t.Errorf("empty context: got %q, want empty", got)
	}

	ctx = WithToken(ctx, "test-token")
	if got := TokenFromContext(ctx); got != "test-token" {
		t.Errorf("with token: got %q, want test-token", got)
	}
}

func TestClaimsFromContext(t *testing.T) {
	ctx := context.Background()
	if got := ClaimsFromContext(ctx); got != nil {
		t.Errorf("empty context: got %v, want nil", got)
	}

	claims := &Claims{Subject: "user-1", Email: "user@example.com"}
	ctx = context.WithValue(ctx, claimsContextKey, claims)
	got := ClaimsFromContext(ctx)
	if got == nil {
		t.Fatal("expected claims, got nil")
	}
	if got.Subject != "user-1" {
		t.Errorf("subject = %q, want user-1", got.Subject)
	}
	if got.Email != "user@example.com" {
		t.Errorf("email = %q, want user@example.com", got.Email)
	}
}

func TestDisabledMiddleware(t *testing.T) {
	m := &Middleware{cfg: Config{Disabled: true}}

	if !m.Disabled() {
		t.Error("expected Disabled() = true")
	}

	handler := m.Handler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims := ClaimsFromContext(r.Context())
		if claims == nil {
			t.Error("expected dev claims in disabled mode")
			return
		}
		if claims.Subject != "dev-user" {
			t.Errorf("subject = %q, want dev-user", claims.Subject)
		}
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", w.Code)
	}
}

func TestDisabledMiddlewareForwardsSuppliedToken(t *testing.T) {
	m := &Middleware{cfg: Config{Disabled: true}}

	handler := m.Handler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := TokenFromContext(r.Context())
		if token != "forwarded-token" {
			t.Errorf("token = %q, want forwarded-token", token)
		}
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer forwarded-token")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", w.Code)
	}
}

func TestEnabledMiddlewareMissingToken(t *testing.T) {
	m := &Middleware{cfg: Config{Disabled: false}}

	handler := m.Handler(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Error("handler should not be called without token")
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", w.Code)
	}
}

func TestClaimsRoles(t *testing.T) {
	tests := []struct {
		name   string
		claims Claims
		want   []string
	}{
		{
			name:   "groups only",
			claims: Claims{Groups: []string{"admin", "user"}},
			want:   []string{"admin", "user"},
		},
		{
			name:   "realm_access only",
			claims: Claims{RealmAccess: RealmAccess{Roles: []string{"openshell-admin"}}},
			want:   []string{"openshell-admin"},
		},
		{
			name: "merged deduped",
			claims: Claims{
				Groups:      []string{"admin", "shared"},
				RealmAccess: RealmAccess{Roles: []string{"shared", "extra"}},
			},
			want: []string{"admin", "shared", "extra"},
		},
		{
			name:   "both empty",
			claims: Claims{},
			want:   nil,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := tc.claims.Roles()
			if len(got) != len(tc.want) {
				t.Fatalf("roles = %v, want %v", got, tc.want)
			}
			for i, role := range got {
				if role != tc.want[i] {
					t.Errorf("roles[%d] = %q, want %q", i, role, tc.want[i])
				}
			}
		})
	}
}
