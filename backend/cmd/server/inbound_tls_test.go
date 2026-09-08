package main

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestValidateInboundTLS(t *testing.T) {
	validCert, validKey := writeSelfSignedCert(t)

	tests := []struct {
		name    string
		cert    string
		key     string
		wantErr bool
		errSub  string
	}{
		{name: "both empty", cert: "", key: "", wantErr: false},
		{name: "both set", cert: validCert, key: validKey, wantErr: false},
		{name: "cert only", cert: validCert, key: "", wantErr: true, errSub: "TLS_CERT_FILE"},
		{name: "key only", cert: "", key: validKey, wantErr: true, errSub: "TLS_CERT_FILE"},
		{name: "missing cert file", cert: filepath.Join(t.TempDir(), "missing.crt"), key: validKey, wantErr: true, errSub: "TLS_CERT_FILE"},
		{name: "missing key file", cert: validCert, key: filepath.Join(t.TempDir(), "missing.key"), wantErr: true, errSub: "TLS_KEY_FILE"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := validateInboundTLS(tc.cert, tc.key)
			if tc.wantErr {
				if err == nil {
					t.Fatal("expected error, got nil")
				}
				if tc.errSub != "" && !strings.Contains(err.Error(), tc.errSub) {
					t.Fatalf("error = %q, want substring %q", err.Error(), tc.errSub)
				}
				if tc.name == "cert only" || tc.name == "key only" {
					if !strings.Contains(err.Error(), "TLS_KEY_FILE") {
						t.Fatalf("error = %q, want both env var names mentioned", err.Error())
					}
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
		})
	}
}

func TestInboundScheme(t *testing.T) {
	if inboundScheme("", "") != "http" {
		t.Fatalf("expected http scheme when TLS files unset")
	}
	if inboundScheme("/tmp/tls.crt", "/tmp/tls.key") != "https" {
		t.Fatalf("expected https scheme when TLS files set")
	}
}

func TestServeInboundHTTPHealthz(t *testing.T) {
	addr := reserveTCPAddr(t)
	server := newInboundServer(addr, healthzHandler())

	errCh := startServeInbound(t, server, "", "")
	resp, err := getHTTPHealthz(addr)
	if err != nil {
		t.Fatalf("GET healthz: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}

	shutdownServer(t, server, errCh)
}

func TestServeInboundHTTPSHealthz(t *testing.T) {
	certPath, keyPath := writeSelfSignedCert(t)
	addr := reserveTCPAddr(t)
	server := newInboundServer(addr, healthzHandler())

	errCh := startServeInbound(t, server, certPath, keyPath)
	resp, err := getHTTPSHealthz(addr)
	if err != nil {
		t.Fatalf("GET healthz: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}

	shutdownServer(t, server, errCh)
}

func healthzHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/healthz" {
			http.NotFound(w, r)
			return
		}
		w.WriteHeader(http.StatusOK)
	})
}

func reserveTCPAddr(t *testing.T) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	addr := ln.Addr().String()
	ln.Close()
	return addr
}

func startServeInbound(t *testing.T, server *http.Server, certPath, keyPath string) <-chan error {
	t.Helper()
	errCh := make(chan error, 1)
	go func() {
		errCh <- serveInbound(server, certPath, keyPath)
	}()
	return errCh
}

func shutdownServer(t *testing.T, server *http.Server, errCh <-chan error) {
	t.Helper()
	if err := server.Close(); err != nil {
		t.Fatalf("close server: %v", err)
	}
	if serveErr := <-errCh; serveErr != nil && serveErr != http.ErrServerClosed {
		t.Fatalf("server exited with error: %v", serveErr)
	}
}

func getHTTPHealthz(addr string) (*http.Response, error) {
	client := &http.Client{Timeout: 2 * time.Second}
	return retryGet(client, "http://"+addr+"/api/v1/healthz")
}

func getHTTPSHealthz(addr string) (*http.Response, error) {
	client := &http.Client{
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
		},
		Timeout: 2 * time.Second,
	}
	return retryGet(client, "https://"+addr+"/api/v1/healthz")
}

func retryGet(client *http.Client, url string) (*http.Response, error) {
	deadline := time.Now().Add(2 * time.Second)
	var lastErr error
	for time.Now().Before(deadline) {
		resp, err := client.Get(url)
		if err == nil {
			return resp, nil
		}
		lastErr = err
		time.Sleep(10 * time.Millisecond)
	}
	return nil, lastErr
}

func writeSelfSignedCert(t *testing.T) (certPath, keyPath string) {
	t.Helper()

	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}

	template := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "localhost"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		IPAddresses:  []net.IP{net.IPv4(127, 0, 0, 1)},
	}

	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatalf("create certificate: %v", err)
	}

	dir := t.TempDir()
	certPath = filepath.Join(dir, "tls.crt")
	keyPath = filepath.Join(dir, "tls.key")

	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	if err := os.WriteFile(certPath, certPEM, 0o600); err != nil {
		t.Fatalf("write cert: %v", err)
	}

	keyDER, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatalf("marshal key: %v", err)
	}
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDER})
	if err := os.WriteFile(keyPath, keyPEM, 0o600); err != nil {
		t.Fatalf("write key: %v", err)
	}

	return certPath, keyPath
}
