package server

import (
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCheckHealth(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/healthz" {
			http.NotFound(w, r)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	port := healthcheckPort(t, server.URL)
	if err := CheckHealth(port); err != nil {
		t.Fatalf("healthy BFF: %v", err)
	}
	server.Close()
	if err := CheckHealth(port); err == nil {
		t.Fatal("stopped BFF reported healthy")
	}
}

func TestCheckHealthRejectsUnhealthyResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer server.Close()
	if err := CheckHealth(healthcheckPort(t, server.URL)); err == nil {
		t.Fatal("unhealthy BFF reported healthy")
	}
}

func healthcheckPort(t *testing.T, serverURL string) string {
	t.Helper()
	_, port, err := net.SplitHostPort(strings.TrimPrefix(serverURL, "http://"))
	if err != nil {
		t.Fatal(err)
	}
	return port
}
