package gateway

import (
	"context"
	"crypto/x509"
	"encoding/pem"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/auth"
)

func TestNewClientCertificateValidation(t *testing.T) {
	tests := []struct {
		name       string
		gatewayURL string
		certPath   string
		keyPath    string
		wantError  string
	}{
		{
			name:       "certificate without key",
			gatewayURL: "https://localhost:17670",
			certPath:   "client.crt",
			wantError:  "must be configured together",
		},
		{
			name:       "key without certificate",
			gatewayURL: "https://localhost:17670",
			keyPath:    "client.key",
			wantError:  "must be configured together",
		},
		{
			name:       "client certificate on plaintext connection",
			gatewayURL: "localhost:50051",
			certPath:   "client.crt",
			keyPath:    "client.key",
			wantError:  "requires a TLS gateway URL",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			client, err := New(tc.gatewayURL, "", tc.certPath, tc.keyPath)
			if client != nil {
				client.Close()
			}
			if err == nil || !strings.Contains(err.Error(), tc.wantError) {
				t.Fatalf("New() error = %v, want error containing %q", err, tc.wantError)
			}
		})
	}
}

func TestNewLoadsClientCertificate(t *testing.T) {
	server := httptest.NewTLSServer(nil)
	defer server.Close()

	tempDir := t.TempDir()
	certPath := filepath.Join(tempDir, "tls.crt")
	keyPath := filepath.Join(tempDir, "tls.key")
	caPath := filepath.Join(tempDir, "ca.crt")
	certificate := server.TLS.Certificates[0]
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certificate.Certificate[0]})
	keyDER, err := x509.MarshalPKCS8PrivateKey(certificate.PrivateKey)
	if err != nil {
		t.Fatalf("marshal private key: %v", err)
	}
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDER})
	for path, contents := range map[string][]byte{
		certPath: certPEM,
		keyPath:  keyPEM,
		caPath:   certPEM,
	} {
		if writeErr := os.WriteFile(path, contents, 0o600); writeErr != nil {
			t.Fatalf("write %s: %v", path, writeErr)
		}
	}

	client, err := New(server.URL, caPath, certPath, keyPath)
	if err != nil {
		t.Fatalf("New() with client certificate: %v", err)
	}
	client.Close()
}

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
