package auth

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func newTestCodec(t *testing.T) *SessionCodec {
	t.Helper()
	codec, err := NewSessionCodec([]byte("test-secret"))
	if err != nil {
		t.Fatalf("NewSessionCodec: %v", err)
	}
	return codec
}

// roundTrip writes the session via SetSession and reads it back through a
// request carrying the resulting cookies, as a browser would.
func roundTrip(t *testing.T, write *SessionCodec, read *SessionCodec, s *Session) (*Session, error) {
	t.Helper()
	w := httptest.NewRecorder()
	if err := write.SetSession(w, s); err != nil {
		t.Fatalf("SetSession: %v", err)
	}
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	for _, cookie := range w.Result().Cookies() {
		if cookie.MaxAge >= 0 {
			req.AddCookie(cookie)
		}
	}
	return read.LoadSession(req)
}

func TestSessionRoundTrip(t *testing.T) {
	codec := newTestCodec(t)
	in := &Session{Token: "id-token", RefreshToken: "refresh", ExpiresAt: time.Now().Unix() + 300}

	out, err := roundTrip(t, codec, codec, in)
	if err != nil {
		t.Fatalf("LoadSession: %v", err)
	}
	if out.Token != in.Token || out.RefreshToken != in.RefreshToken || out.ExpiresAt != in.ExpiresAt {
		t.Fatalf("session = %+v, want %+v", out, in)
	}
}

func TestSessionChunking(t *testing.T) {
	codec := newTestCodec(t)
	// A Keycloak-sized token with many group claims easily exceeds one cookie.
	in := &Session{Token: strings.Repeat("x", 9000), RefreshToken: "refresh"}

	w := httptest.NewRecorder()
	if err := codec.SetSession(w, in); err != nil {
		t.Fatalf("SetSession: %v", err)
	}
	var live int
	for _, cookie := range w.Result().Cookies() {
		if cookie.MaxAge >= 0 && strings.HasPrefix(cookie.Name, SessionCookieName) {
			live++
			if len(cookie.Value) > maxCookieValueLen {
				t.Fatalf("chunk %s is %d bytes, want <= %d", cookie.Name, len(cookie.Value), maxCookieValueLen)
			}
		}
	}
	if live < 2 {
		t.Fatalf("live chunks = %d, want >= 2 for a %d-byte token", live, len(in.Token))
	}

	out, err := roundTrip(t, codec, codec, in)
	if err != nil {
		t.Fatalf("LoadSession: %v", err)
	}
	if out.Token != in.Token {
		t.Fatalf("token corrupted across chunks: got %d bytes, want %d", len(out.Token), len(in.Token))
	}
}

func TestSessionTooLargeRejected(t *testing.T) {
	codec := newTestCodec(t)
	in := &Session{Token: strings.Repeat("x", maxSessionChunks*maxCookieValueLen)}

	w := httptest.NewRecorder()
	if err := codec.SetSession(w, in); err == nil {
		t.Fatal("SetSession accepted an oversized session, want error")
	}
}

func TestSessionWrongKeyRejected(t *testing.T) {
	writeCodec := newTestCodec(t)
	readCodec, err := NewSessionCodec([]byte("different-secret"))
	if err != nil {
		t.Fatalf("NewSessionCodec: %v", err)
	}

	if _, err := roundTrip(t, writeCodec, readCodec, &Session{Token: "id-token"}); err == nil {
		t.Fatal("LoadSession decrypted with the wrong key, want error")
	}
}

func TestSessionTamperRejected(t *testing.T) {
	codec := newTestCodec(t)
	w := httptest.NewRecorder()
	if err := codec.SetSession(w, &Session{Token: "id-token"}); err != nil {
		t.Fatalf("SetSession: %v", err)
	}
	cookie := w.Result().Cookies()[0]
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.AddCookie(&http.Cookie{Name: cookie.Name, Value: cookie.Value[:len(cookie.Value)-4] + "AAAA"})

	if _, err := codec.LoadSession(req); err == nil {
		t.Fatal("LoadSession accepted a tampered cookie, want error")
	}
}

func TestLoadSessionAbsent(t *testing.T) {
	codec := newTestCodec(t)
	session, err := codec.LoadSession(httptest.NewRequest(http.MethodGet, "/", nil))
	if err != nil {
		t.Fatalf("LoadSession on cookieless request: %v", err)
	}
	if session != nil {
		t.Fatalf("session = %+v, want nil", session)
	}
}

func TestClearSessionExpiresAllChunks(t *testing.T) {
	w := httptest.NewRecorder()
	ClearSession(w)
	cookies := w.Result().Cookies()
	if len(cookies) != maxSessionChunks {
		t.Fatalf("cleared %d cookies, want %d", len(cookies), maxSessionChunks)
	}
	for _, cookie := range cookies {
		if cookie.MaxAge != -1 {
			t.Fatalf("cookie %s MaxAge = %d, want -1", cookie.Name, cookie.MaxAge)
		}
	}
}

func TestSessionCookieAttributes(t *testing.T) {
	codec := newTestCodec(t)
	w := httptest.NewRecorder()
	if err := codec.SetSession(w, &Session{Token: "id-token"}); err != nil {
		t.Fatalf("SetSession: %v", err)
	}
	cookie := w.Result().Cookies()[0]
	if !cookie.HttpOnly || !cookie.Secure || cookie.SameSite != http.SameSiteStrictMode || cookie.Path != "/" {
		t.Fatalf("cookie attributes = %+v, want HttpOnly Secure SameSite=Strict Path=/", cookie)
	}
	if !strings.HasPrefix(cookie.Name, "__Host-") {
		t.Fatalf("cookie name %q must carry the __Host- prefix", cookie.Name)
	}
}

func TestSessionExpired(t *testing.T) {
	now := time.Now().Unix()
	tests := []struct {
		name    string
		session Session
		want    bool
	}{
		{"no expiry never expires", Session{Token: "t"}, false},
		{"future expiry", Session{Token: "t", ExpiresAt: now + 3600}, false},
		{"past expiry", Session{Token: "t", ExpiresAt: now - 10}, true},
		{"within skew", Session{Token: "t", ExpiresAt: now + 5}, true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.session.Expired(30 * time.Second); got != tc.want {
				t.Fatalf("Expired = %v, want %v", got, tc.want)
			}
		})
	}
}
