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
	Status        string `json:"status"`
	SupportedLine string `json:"supportedLine"`
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
// The BFF under test needs nothing set for this: the release line it judges
// against is compiled in. The test skips only when the BFF was started with a
// GATEWAY_RELEASE_LINE it could not read, because that BFF has no verdict to
// give.
//
// Set COMPAT_EXPECT_COMPATIBILITY to pin the expected verdict for the gateway
// under test: "supported" for a gateway on the BFF's line, "unsupported" for a
// gateway on another (0.0.116 against line 0.1). To see "unsupported" from a
// gateway of the BFF's own line, start the BFF with another line
// (GATEWAY_RELEASE_LINE=9.9); deploy/ci/e2e-stack.sh passes its environment
// through to the BFF it starts. Run it alone with
// -run 'TestGatewayCompatibility$' against a gateway on another line, where
// the rest of this suite is expected to fail: the health check sends an empty
// request, so the field renumbering that breaks workspace-scoped calls on an
// older gateway does not reach it.
func TestGatewayCompatibility(t *testing.T) {
	want := os.Getenv("COMPAT_EXPECT_COMPATIBILITY")
	reported, got := gatewayCompatibility(t)
	t.Logf("gateway reports %q; BFF verdict %q on release line %q", reported, got.Status, got.SupportedLine)

	switch got.Status {
	case "unsupported", "supported", "unknown":
	default:
		t.Fatalf("compatibility.status = %q, not one of unsupported|supported|unknown", got.Status)
	}

	if got.SupportedLine == "" {
		if got.Status != "unknown" {
			t.Errorf("compatibility.status = %q with no release line, want unknown — the BFF "+
				"must not judge a gateway against a line it does not name", got.Status)
		}
		// An expectation with nothing to check it against is a wiring mistake,
		// not a reason to skip quietly.
		if want != "" && want != "unknown" {
			t.Fatalf("COMPAT_EXPECT_COMPATIBILITY=%q, but the BFF under test names no release line — "+
				"it was started with a GATEWAY_RELEASE_LINE it could not read; unset it or write major.minor", want)
		}
		t.Skip("the BFF was started with a GATEWAY_RELEASE_LINE it could not read; no verdict to check")
	}

	// "unknown" with a line is a legitimate answer only when it was asked
	// for: a gateway built without a version stamp reports 0.0.0, which the
	// BFF refuses to place. Any other gateway must get a real verdict.
	if got.Status == "unknown" && want != "unknown" {
		t.Errorf("the BFF is for release line %s but could not place gateway version %q — "+
			"the gateway's version format is not one the BFF parses, or the gateway does not "+
			"know its own version", got.SupportedLine, reported)
	}
	if want != "" && got.Status != want {
		t.Errorf("compatibility.status = %q for gateway %q on release line %s, want %q (COMPAT_EXPECT_COMPATIBILITY)",
			got.Status, reported, got.SupportedLine, want)
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
// Gateway page and the About dialog do not display. It does not depend on the
// verdict, so it runs against every gateway.
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
