//go:build compat

package compat

import (
	"net/http"
	"os"
	"testing"
)

// TestGatewayCompatibility checks the BFF's verdict on a REAL gateway's
// version string. The unit tests cover the comparison; what only a live
// gateway can show is that the version it reports is one the BFF can read at
// all — a format change there would silently turn every verdict into
// "unknown" and the notice in the UI would never appear.
//
// It needs the BFF under test to have been started with a range:
//
//	GATEWAY_SUPPORTED_MIN=0.1.0 GATEWAY_SUPPORTED_MAX=0.1.2 ./bin/server
//
// and skips when it was not, because a BFF without a range has no verdict to
// give. deploy/ci/e2e-stack.sh passes its environment through to the BFF it
// starts, so the same two variables in front of `e2e-stack.sh run` are enough.
//
// Set COMPAT_EXPECT_COMPATIBILITY to pin the expected verdict for the gateway
// under test: "supported" for a lane inside the range, "unsupported" for a
// gateway below it (0.0.116 against 0.1.0..0.1.2), "untested" for one above it
// (upstream HEAD). Run it alone with -run 'TestGatewayCompatibility$' against
// a gateway outside the range, where the rest of this suite is expected to
// fail: GetGatewayInfo sends an empty request, so the field renumbering that
// breaks workspace-scoped calls on an older gateway does not reach it.
func TestGatewayCompatibility(t *testing.T) {
	want := os.Getenv("COMPAT_EXPECT_COMPATIBILITY")
	var info struct {
		Compatibility *struct {
			Status       string `json:"status"`
			SupportedMin string `json:"supportedMin"`
			SupportedMax string `json:"supportedMax"`
		} `json:"compatibility"`
		GatewayVersion string `json:"gatewayVersion"`
	}
	mustJSON(t, http.MethodGet, "/api/v1/gateway", nil, &info, http.StatusOK)

	if info.Compatibility == nil {
		t.Fatalf("GET /api/v1/gateway [gateway %s] has no compatibility object — the BFF "+
			"always reports one, \"unknown\" included", gatewayVersion)
	}
	got := info.Compatibility
	t.Logf("gateway reports %q; BFF verdict %q against range %q..%q",
		info.GatewayVersion, got.Status, got.SupportedMin, got.SupportedMax)

	switch got.Status {
	case "unsupported", "supported", "untested", "unknown":
	default:
		t.Fatalf("compatibility.status = %q, not one of unsupported|supported|untested|unknown", got.Status)
	}

	if got.SupportedMin == "" && got.SupportedMax == "" {
		if got.Status != "unknown" {
			t.Errorf("compatibility.status = %q with no range configured, want unknown — the BFF "+
				"must not guess a range", got.Status)
		}
		// An expectation with nothing to check it against is a wiring mistake,
		// not a reason to skip quietly.
		if want != "" && want != "unknown" {
			t.Fatalf("COMPAT_EXPECT_COMPATIBILITY=%q, but the BFF under test has no range — start it "+
				"with GATEWAY_SUPPORTED_MIN and GATEWAY_SUPPORTED_MAX", want)
		}
		t.Skip("the BFF was started without GATEWAY_SUPPORTED_MIN / GATEWAY_SUPPORTED_MAX; no verdict to check")
	}

	if got.Status == "unknown" {
		t.Errorf("the BFF has a range (%s..%s) but could not place gateway version %q in it — "+
			"the gateway's version format is not one the BFF parses",
			got.SupportedMin, got.SupportedMax, info.GatewayVersion)
	}
	if want != "" && got.Status != want {
		t.Errorf("compatibility.status = %q for gateway %q against %s..%s, want %q (COMPAT_EXPECT_COMPATIBILITY)",
			got.Status, info.GatewayVersion, got.SupportedMin, got.SupportedMax, want)
	}
}
