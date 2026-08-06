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

func TestHandler_AuthEnabled_BearerFallback(t *testing.T) {
	m := New(Config{})

	var gotToken string
	handler := m.Handler(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		gotToken = TokenFromContext(r.Context())
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer bearer-jwt")
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if gotToken != "bearer-jwt" {
		t.Errorf("token = %q, want bearer-jwt", gotToken)
	}
}

type staticSessionAuth struct{ token string }

func (s *staticSessionAuth) TokenFromSession(http.ResponseWriter, *http.Request) string {
	return s.token
}

func TestHandler_AuthEnabled_SessionFallback(t *testing.T) {
	m := New(Config{})
	m.SetSessionAuthenticator(&staticSessionAuth{token: "session-jwt"})

	var gotToken string
	handler := m.Handler(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		gotToken = TokenFromContext(r.Context())
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	if gotToken != "session-jwt" {
		t.Errorf("token = %q, want session-jwt", gotToken)
	}
}

func TestHandler_AuthEnabled_HeaderBeatsSession(t *testing.T) {
	m := New(Config{})
	m.SetSessionAuthenticator(&staticSessionAuth{token: "session-jwt"})

	var gotToken string
	handler := m.Handler(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		gotToken = TokenFromContext(r.Context())
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("x-forwarded-access-token", "proxy-jwt")
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if gotToken != "proxy-jwt" {
		t.Errorf("token = %q, want proxy-jwt (header must take precedence over session)", gotToken)
	}
}

func TestHandler_AuthEnabled_EmptySessionRejected(t *testing.T) {
	m := New(Config{})
	m.SetSessionAuthenticator(&staticSessionAuth{token: ""})

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

func TestHandler_AuthDisabled_DropsTokens(t *testing.T) {
	m := New(Config{Disabled: true})

	var gotToken, gotUser string
	handler := m.Handler(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		gotToken = TokenFromContext(r.Context())
		gotUser = UserFromContext(r.Context())
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("x-forwarded-access-token", "stray-token")
	req.Header.Set("Authorization", "Bearer stray-bearer")
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	if gotToken != "" {
		t.Errorf("token = %q, want empty — dev mode must not forward tokens", gotToken)
	}
	if gotUser != "dev-user" {
		t.Errorf("user = %q, want dev-user", gotUser)
	}
}
