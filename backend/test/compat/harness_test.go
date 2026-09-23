//go:build compat

// Package compat is the gateway compatibility suite. It drives the BFF's REST
// API against a real OpenShell gateway and asserts the contracts the frontend
// depends on.
//
// It is build-tagged so `go test ./...` never picks it up — it needs a live
// stack. CI runs it once per gateway version in a matrix; see
// .github/workflows/ci.yml and deploy/ci/.
//
//	BFF_URL=http://localhost:9080 go test -tags compat ./test/compat/... -v
package compat

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"
)

var (
	bffURL     string
	httpClient = &http.Client{Timeout: 30 * time.Second}

	// gatewayVersion is resolved once in TestMain and reported in failures, so
	// a matrix run says which version broke without cross-referencing logs.
	gatewayVersion = "unknown"
)

func TestMain(m *testing.M) {
	bffURL = strings.TrimSuffix(os.Getenv("BFF_URL"), "/")
	if bffURL == "" {
		bffURL = "http://localhost:9080"
	}

	if err := waitForBFF(90 * time.Second); err != nil {
		fmt.Fprintf(os.Stderr, "compat: BFF never became ready at %s: %v\n", bffURL, err)
		os.Exit(1)
	}
	if v, err := resolveGatewayVersion(); err == nil {
		gatewayVersion = v
	}
	fmt.Printf("compat: BFF=%s gateway=%s\n", bffURL, gatewayVersion)

	os.Exit(m.Run())
}

func waitForBFF(limit time.Duration) error {
	deadline := time.Now().Add(limit)
	var last error
	for time.Now().Before(deadline) {
		resp, err := httpClient.Get(bffURL + "/api/v1/healthz")
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				return nil
			}
			last = fmt.Errorf("status %d", resp.StatusCode)
		} else {
			last = err
		}
		time.Sleep(time.Second)
	}
	return last
}

func resolveGatewayVersion() (string, error) {
	var info struct {
		GatewayVersion string `json:"gatewayVersion"`
	}
	if _, err := doJSON(http.MethodGet, "/api/v1/gateway", nil, &info); err != nil {
		return "", err
	}
	return info.GatewayVersion, nil
}

// do issues a request and returns the status and raw body.
func do(method, path string, body any) (int, []byte, error) {
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return 0, nil, err
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, bffURL+path, rdr)
	if err != nil {
		return 0, nil, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	return resp.StatusCode, raw, err
}

// doJSON issues a request and decodes a successful body into out.
func doJSON(method, path string, body, out any) (int, error) {
	status, raw, err := do(method, path, body)
	if err != nil {
		return status, err
	}
	if out != nil && len(raw) > 0 {
		if err := json.Unmarshal(raw, out); err != nil {
			return status, fmt.Errorf("decode %s %s (status %d): %w; body: %s", method, path, status, err, truncate(raw))
		}
	}
	return status, nil
}

// mustJSON fails the test unless the call returns wantStatus.
func mustJSON(t *testing.T, method, path string, body, out any, wantStatus int) {
	t.Helper()
	status, raw, err := do(method, path, body)
	if err != nil {
		t.Fatalf("%s %s [gateway %s]: %v", method, path, gatewayVersion, err)
	}
	if status != wantStatus {
		t.Fatalf("%s %s [gateway %s]: status = %d, want %d; body: %s",
			method, path, gatewayVersion, status, wantStatus, truncate(raw))
	}
	if out != nil && len(raw) > 0 {
		if err := json.Unmarshal(raw, out); err != nil {
			t.Fatalf("%s %s [gateway %s]: decode: %v; body: %s", method, path, gatewayVersion, err, truncate(raw))
		}
	}
}

func truncate(b []byte) string {
	const max = 800
	if len(b) <= max {
		return string(b)
	}
	return string(b[:max]) + "...(truncated)"
}

// poll calls fn until it returns true or the deadline passes.
func poll(t *testing.T, limit, every time.Duration, what string, fn func() (bool, string)) {
	t.Helper()
	deadline := time.Now().Add(limit)
	last := ""
	for time.Now().Before(deadline) {
		ok, detail := fn()
		if ok {
			return
		}
		last = detail
		time.Sleep(every)
	}
	t.Fatalf("timed out after %s waiting for %s [gateway %s]; last state: %s", limit, what, gatewayVersion, last)
}
