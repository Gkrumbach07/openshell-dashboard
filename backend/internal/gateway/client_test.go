package gateway

import (
	"context"
	"testing"

	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/auth"
)

func TestTokenCredentialsGetRequestMetadata(t *testing.T) {
	tests := []struct {
		name      string
		token     string
		wantValue string
		wantNil   bool
	}{
		{
			name:    "no token in context",
			token:   "",
			wantNil: true,
		},
		{
			name:      "token present",
			token:     "test-jwt-value", //nolint:gosec // test fixture, not a real credential
			wantValue: "Bearer test-jwt-value",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ctx := context.Background()
			if tc.token != "" {
				ctx = auth.WithToken(ctx, tc.token)
			}
			creds := tokenCredentials{requireTLS: false}
			md, err := creds.GetRequestMetadata(ctx)
			if err != nil {
				t.Fatalf("GetRequestMetadata: %v", err)
			}
			if tc.wantNil {
				if md != nil {
					t.Errorf("expected nil metadata, got %v", md)
				}
				return
			}
			if md["authorization"] != tc.wantValue {
				t.Errorf("authorization = %q, want %q", md["authorization"], tc.wantValue)
			}
		})
	}
}

func TestTokenCredentialsRequireTransportSecurity(t *testing.T) {
	tests := []struct {
		name       string
		requireTLS bool
		want       bool
	}{
		{"TLS required", true, true},
		{"TLS not required", false, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			creds := tokenCredentials{requireTLS: tc.requireTLS}
			if got := creds.RequireTransportSecurity(); got != tc.want {
				t.Errorf("RequireTransportSecurity() = %v, want %v", got, tc.want)
			}
		})
	}
}
