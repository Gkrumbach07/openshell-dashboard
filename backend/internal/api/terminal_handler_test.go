package api

import (
	"net/http"
	"testing"
)

func TestCheckWebSocketOrigin(t *testing.T) {
	tests := []struct { //nolint:govet // fieldalignment: test readability
		name           string
		allowedOrigins []string
		origin         string
		host           string
		want           bool
	}{
		{
			name:           "allowed origin matches",
			allowedOrigins: []string{"https://dashboard.example.com"},
			origin:         "https://dashboard.example.com",
			want:           true,
		},
		{
			name:           "disallowed origin rejected",
			allowedOrigins: []string{"https://dashboard.example.com"},
			origin:         "https://evil.com",
			want:           false,
		},
		{
			name:           "empty origin allowed",
			allowedOrigins: []string{"https://dashboard.example.com"},
			origin:         "",
			want:           true,
		},
		{
			name:           "no allowed origins same-origin http match",
			allowedOrigins: nil,
			origin:         "http://localhost:8080",
			host:           "localhost:8080",
			want:           true,
		},
		{
			name:           "no allowed origins same-origin https match",
			allowedOrigins: nil,
			origin:         "https://dashboard.example.com",
			host:           "dashboard.example.com",
			want:           true,
		},
		{
			name:           "no allowed origins cross-origin rejected",
			allowedOrigins: nil,
			origin:         "https://evil.com",
			host:           "dashboard.example.com",
			want:           false,
		},
		{
			name:           "multiple allowed origins second matches",
			allowedOrigins: []string{"https://a.com", "https://b.com"},
			origin:         "https://b.com",
			want:           true,
		},
		{
			// Regression: same-origin must be allowed even when an allowlist
			// is configured (the allowlist adds cross-origin callers, it does
			// not replace the same-origin default).
			name:           "same-origin allowed despite non-empty allowlist",
			allowedOrigins: []string{"https://other.example.com"},
			origin:         "https://dashboard.example.com",
			host:           "dashboard.example.com",
			want:           true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			app := &App{allowedOrigins: tc.allowedOrigins}
			req, _ := http.NewRequest(http.MethodGet, "/terminal", nil)
			if tc.origin != "" {
				req.Header.Set("Origin", tc.origin)
			}
			if tc.host != "" {
				req.Host = tc.host
			}
			got := app.checkWebSocketOrigin(req)
			if got != tc.want {
				t.Errorf("checkWebSocketOrigin() = %v, want %v", got, tc.want)
			}
		})
	}
}
