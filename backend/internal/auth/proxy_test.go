package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHandler_AuthEnabled_WithToken(t *testing.T) {
	m := New(Config{TokenHeader: "x-forwarded-access-token", UserHeader: "x-auth-request-user"})

	var gotToken, gotUser string
	handler := m.Handler(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		gotToken = TokenFromContext(r.Context())
		gotUser = UserFromContext(r.Context())
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("x-forwarded-access-token", "my-jwt-token")
	req.Header.Set("x-auth-request-user", "alice")
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	if gotToken != "my-jwt-token" {
		t.Errorf("token = %q, want my-jwt-token", gotToken)
	}
	if gotUser != "alice" {
		t.Errorf("user = %q, want alice", gotUser)
	}
}

func TestHandler_AuthEnabled_MissingToken(t *testing.T) {
	m := New(Config{})

	handler := m.Handler(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("handler should not be called")
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
}

func TestHandler_AuthEnabled_TokenOnly(t *testing.T) {
	m := New(Config{})

	var gotUser string
	handler := m.Handler(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		gotUser = UserFromContext(r.Context())
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("x-forwarded-access-token", "tok")
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	if gotUser != "" {
		t.Errorf("user = %q, want empty (no user header)", gotUser)
	}
}

func TestHandler_Disabled_DevUser(t *testing.T) {
	m := New(Config{Disabled: true})

	var gotToken, gotUser string
	handler := m.Handler(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		gotToken = TokenFromContext(r.Context())
		gotUser = UserFromContext(r.Context())
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	if gotUser != "dev-user" {
		t.Errorf("user = %q, want dev-user", gotUser)
	}
	if gotToken != "" {
		t.Errorf("token = %q, want empty (no token forwarded)", gotToken)
	}
}

func TestHandler_Disabled_ForwardsToken(t *testing.T) {
	m := New(Config{Disabled: true})

	var gotToken string
	handler := m.Handler(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		gotToken = TokenFromContext(r.Context())
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("x-forwarded-access-token", "override-tok")
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if gotToken != "override-tok" {
		t.Errorf("token = %q, want override-tok", gotToken)
	}
}

func TestHandler_CustomHeaders(t *testing.T) {
	m := New(Config{TokenHeader: "x-custom-token", UserHeader: "x-custom-user"})

	var gotToken, gotUser string
	handler := m.Handler(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		gotToken = TokenFromContext(r.Context())
		gotUser = UserFromContext(r.Context())
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("x-custom-token", "custom-jwt")
	req.Header.Set("x-custom-user", "bob")
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if gotToken != "custom-jwt" {
		t.Errorf("token = %q, want custom-jwt", gotToken)
	}
	if gotUser != "bob" {
		t.Errorf("user = %q, want bob", gotUser)
	}
}

func TestDefaults(t *testing.T) {
	m := New(Config{})
	if m.TokenHeader() != "x-forwarded-access-token" {
		t.Errorf("default token header = %q", m.TokenHeader())
	}
	if m.Disabled() {
		t.Error("should not be disabled by default")
	}
}

func TestWithToken(t *testing.T) {
	ctx := WithToken(t.Context(), "test-token")
	if got := TokenFromContext(ctx); got != "test-token" {
		t.Errorf("token = %q, want test-token", got)
	}
}
