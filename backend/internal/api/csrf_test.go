package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCSRFMiddleware(t *testing.T) {
	app := &App{allowedOrigins: []string{"https://allowed.example.com"}}
	handler := app.csrfMiddleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	tests := []struct {
		name   string
		method string
		origin string
		want   int
	}{
		{"same-origin post", http.MethodPost, "https://dashboard.example.com", http.StatusOK},
		{"cross-origin post rejected", http.MethodPost, "https://evil.example.com", http.StatusForbidden},
		{"allowlisted origin post", http.MethodPost, "https://allowed.example.com", http.StatusOK},
		{"no origin post (non-browser)", http.MethodPost, "", http.StatusOK},
		{"cross-origin get allowed", http.MethodGet, "https://evil.example.com", http.StatusOK},
		{"cross-origin delete rejected", http.MethodDelete, "https://evil.example.com", http.StatusForbidden},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, "https://dashboard.example.com/api/v1/workspaces", nil)
			req.Host = "dashboard.example.com"
			if tc.origin != "" {
				req.Header.Set("Origin", tc.origin)
			}
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, req)
			if w.Code != tc.want {
				t.Fatalf("status = %d, want %d", w.Code, tc.want)
			}
		})
	}
}
