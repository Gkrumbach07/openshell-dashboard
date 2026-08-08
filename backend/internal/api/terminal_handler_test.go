package api

import (
	"net/http"
	"testing"
)

func TestCheckWebSocketOrigin(t *testing.T) {
	tests := []struct { //nolint:govet // fieldalignment: test readability
		name   string
		origin string
		host   string
		want   bool
	}{
		{
			name:   "empty origin allowed (non-browser client)",
			origin: "",
			host:   "dashboard.example.com",
			want:   true,
		},
		{
			name:   "same-origin http match",
			origin: "http://localhost:8080",
			host:   "localhost:8080",
			want:   true,
		},
		{
			name:   "same-origin https match",
			origin: "https://dashboard.example.com",
			host:   "dashboard.example.com",
			want:   true,
		},
		{
			name:   "cross-origin rejected",
			origin: "https://evil.com",
			host:   "dashboard.example.com",
			want:   false,
		},
		{
			name:   "subdomain rejected",
			origin: "https://evil.dashboard.example.com",
			host:   "dashboard.example.com",
			want:   false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req, _ := http.NewRequest(http.MethodGet, "/terminal", nil)
			if tc.origin != "" {
				req.Header.Set("Origin", tc.origin)
			}
			if tc.host != "" {
				req.Host = tc.host
			}
			got := checkWebSocketOrigin(req)
			if got != tc.want {
				t.Errorf("checkWebSocketOrigin() = %v, want %v", got, tc.want)
			}
		})
	}
}
