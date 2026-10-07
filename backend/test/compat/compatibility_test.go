//go:build compat

package compat

import (
	"net/http"
	"os"
	"testing"
)

// compatibilityVerdict is the dashboard's verdict as both gateway routes
// serialize it.
type compatibilityVerdict struct {
	Status       string `json:"status"`
	SupportedMin string `json:"supportedMin"`
	SupportedMax string `json:"supportedMax"`
}

// gatewayCompatibility reads GET /api/v1/gateway/compatibility, the route the
// notice in the UI is built on. Its version comes from the gateway's health
// check, so it answers every signed-in user.
func gatewayCompatibility(t *testing.T) (version string, verdict compatibilityVerdict) {
	t.Helper()
	var body struct {
		Compatibility  *compatibilityVerdict `json:"compatibility"`
		GatewayVersion string                `json:"gatewayVersion"`
	}
	mustJSON(t, http.MethodGet, "/api/v1/gateway/compatibility", nil, &body, http.StatusOK)
	if body.Compatibility == nil {
		t.Fatalf("GET /api/v1/gateway/compatibility [gateway %s] has no compatibility object — the BFF "+
			"always reports one, \"unknown\" included", gatewayVersion)
	}
	return body.GatewayVersion, *body.Compatibility
}

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
// fail: the health check sends an empty request, so the field renumbering that
// breaks workspace-scoped calls on an older gateway does not reach it.
func TestGatewayCompatibility(t *testing.T) {
	want := os.Getenv("COMPAT_EXPECT_COMPATIBILITY")
	reported, got := gatewayCompatibility(t)
	t.Logf("gateway reports %q; BFF verdict %q against range %q..%q",
		reported, got.Status, got.SupportedMin, got.SupportedMax)

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

	// "unknown" with a range is a legitimate answer only when it was asked
	// for: a gateway built without a version stamp reports 0.0.0, which the
	// BFF refuses to place. Any other gateway must get a real verdict.
	if got.Status == "unknown" && want != "unknown" {
		t.Errorf("the BFF has a range (%s..%s) but could not place gateway version %q in it — "+
			"the gateway's version format is not one the BFF parses, or the gateway does not "+
			"know its own version", got.SupportedMin, got.SupportedMax, reported)
	}
	if want != "" && got.Status != want {
		t.Errorf("compatibility.status = %q for gateway %q against %s..%s, want %q (COMPAT_EXPECT_COMPATIBILITY)",
			got.Status, reported, got.SupportedMin, got.SupportedMax, want)
	}
}

// TestGatewayCompatibilityHealth checks that the route every signed-in user
// can read also says whether the gateway calls itself healthy, which is what
// the status indicator in the masthead shows. GET /api/v1/gateway says the
// same, but the gateway answers that one for platform admins only.
//
// The health comes from the gateway's health check, like the version. What
// only a live gateway can show is that the check's status survives the trip:
// a status the SDK stopped reading would come through as "not healthy" for a
// gateway that is fine. Gateways 0.1.0 to 0.1.2 answer the check with healthy
// and nothing else, so a gateway that is reachable — and this suite does not
// start without one — is a healthy one.
func TestGatewayCompatibilityHealth(t *testing.T) {
	const path = "/api/v1/gateway/compatibility"
	raw := mustRaw(t, http.MethodGet, path, nil, http.StatusOK)
	var body struct {
		Healthy *bool `json:"healthy"`
	}
	mustDecode(t, raw, &body)
	t.Logf("GET %s [gateway %s] -> %s", path, gatewayVersion, truncate(raw))

	if body.Healthy == nil {
		t.Fatalf("GET %s [gateway %s] has no healthy field — the default gateway service always reports "+
			"what the health check said; body: %s", path, gatewayVersion, truncate(raw))
	}
	if !*body.Healthy {
		t.Errorf("GET %s [gateway %s]: healthy = false for a gateway that answers every other call — "+
			"the health check's status is no longer read as healthy; body: %s", path, gatewayVersion, truncate(raw))
	}

	// The admin-only route reports a status, and the two must not disagree:
	// an admin would see one answer in the masthead and another on the
	// Gateway page.
	var info struct {
		Status string `json:"status"`
	}
	mustJSON(t, http.MethodGet, "/api/v1/gateway", nil, &info, http.StatusOK)
	if (info.Status == "HEALTHY") != *body.Healthy {
		t.Errorf("GET /api/v1/gateway reports status %q but GET %s reports healthy = %v — both come from "+
			"the same gateway and must agree", info.Status, path, *body.Healthy)
	}
}

// TestGatewayCompatibilityVersionSource checks the one thing the verdict route
// takes on trust from reading upstream's source: that the gateway's health
// check reports the SAME version string as GetGatewayInfo.
//
// The verdict is computed from the health check because the gateway answers it
// for every caller, where GetGatewayInfo is for platform admins only. If the
// two ever disagreed, a user would be shown a verdict about a version the
// Gateway page and the About dialog do not display. It needs no range, so it
// runs in every lane.
func TestGatewayCompatibilityVersionSource(t *testing.T) {
	var info struct {
		Compatibility  *compatibilityVerdict `json:"compatibility"`
		GatewayVersion string                `json:"gatewayVersion"`
	}
	mustJSON(t, http.MethodGet, "/api/v1/gateway", nil, &info, http.StatusOK)
	fromHealth, verdict := gatewayCompatibility(t)

	if fromHealth == "" {
		t.Errorf("GET /api/v1/gateway/compatibility [gateway %s] reports no gatewayVersion — the "+
			"gateway's health check no longer carries a version", gatewayVersion)
	}
	if fromHealth != info.GatewayVersion {
		t.Errorf("the health check reports version %q but GetGatewayInfo reports %q — the verdict "+
			"would be about a different version than the one the UI shows", fromHealth, info.GatewayVersion)
	}
	if info.Compatibility == nil {
		t.Fatalf("GET /api/v1/gateway [gateway %s] has no compatibility object", gatewayVersion)
	}
	if *info.Compatibility != verdict {
		t.Errorf("GET /api/v1/gateway says %+v but GET /api/v1/gateway/compatibility says %+v — "+
			"both routes must give the same verdict", *info.Compatibility, verdict)
	}
}
