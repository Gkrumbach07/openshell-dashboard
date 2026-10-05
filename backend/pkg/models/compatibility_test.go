package models

import (
	"encoding/json"
	"strings"
	"testing"
)

func mustGatewaySupport(t *testing.T, minVersion, maxVersion string) GatewaySupport {
	t.Helper()
	support, err := ParseGatewaySupport(minVersion, maxVersion)
	if err != nil {
		t.Fatalf("ParseGatewaySupport(%q, %q): %v", minVersion, maxVersion, err)
	}
	return support
}

// The range below is the one the 1.x line ships with today (the required
// lanes in deploy/ci/gateway-pins.json), and the versions are ones gateways
// have really reported. This table is the documented answer to "how do
// pre-release and dev builds compare".
func TestGatewaySupportCheck(t *testing.T) {
	support := mustGatewaySupport(t, "0.1.0", "0.1.2")

	tests := []struct {
		name     string
		reported string
		want     GatewayCompatibilityStatus
	}{
		// Releases.
		{name: "release below the floor (the 0.x line's gateway)", reported: "0.0.116", want: GatewayUnsupported},
		{name: "the floor itself", reported: "0.1.0", want: GatewaySupported},
		{name: "a release between the lanes", reported: "0.1.1", want: GatewaySupported},
		{name: "the ceiling itself", reported: "0.1.2", want: GatewaySupported},
		{name: "next patch release", reported: "0.1.3", want: GatewayUntested},
		{name: "next minor release", reported: "0.2.0", want: GatewayUntested},
		{name: "next major release", reported: "1.0.0", want: GatewayUntested},
		{name: "numbers compare as numbers, not text", reported: "0.1.10", want: GatewayUntested},
		{name: "tag-style v prefix", reported: "v0.1.2", want: GatewaySupported},
		{name: "surrounding whitespace", reported: " 0.1.2\n", want: GatewaySupported},

		// Dev builds, as upstream HEAD reports them. Build metadata is ignored.
		{name: "dev build of the next release is newer than the ceiling", reported: "0.1.3-dev.84+ge7fdd6bee", want: GatewayUntested},
		{name: "dev build below the floor", reported: "0.0.117-dev.259+gbed9e5eaf", want: GatewayUnsupported},
		{name: "dev build of the ceiling sorts just below it, so inside the range", reported: "0.1.2-dev.7+gabc1234", want: GatewaySupported},
		{name: "dev build of an in-range release", reported: "0.1.1-dev.3", want: GatewaySupported},

		// Pre-releases sort below the release they lead up to.
		{name: "pre-release of the floor is below the floor", reported: "0.1.0-pre.8", want: GatewayUnsupported},
		{name: "pre-release of the next release", reported: "0.1.3-pre.4", want: GatewayUntested},
		{name: "build metadata on a release changes nothing", reported: "0.1.2+build.5", want: GatewaySupported},
		{name: "build metadata containing a dash is not a pre-release", reported: "0.1.2+g-abc", want: GatewaySupported},

		// Never a guess.
		{name: "empty version", reported: "", want: GatewayUnknown},
		{name: "not a version", reported: "dev", want: GatewayUnknown},
		{name: "two components", reported: "0.1", want: GatewayUnknown},
		{name: "four components", reported: "0.1.2.3", want: GatewayUnknown},
		{name: "non-numeric component", reported: "0.x.2", want: GatewayUnknown},
		{name: "empty pre-release identifier", reported: "0.1.2-", want: GatewayUnknown},
		{name: "signed component", reported: "0.+1.2", want: GatewayUnknown},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := support.Check(tc.reported)
			if got.Status != tc.want {
				t.Errorf("Check(%q).Status = %q, want %q", tc.reported, got.Status, tc.want)
			}
			// The range is echoed whenever one is configured, including for
			// "unknown", so the UI can still say what was expected.
			if got.SupportedMin != "0.1.0" || got.SupportedMax != "0.1.2" {
				t.Errorf("Check(%q) range = %q..%q, want 0.1.0..0.1.2", tc.reported, got.SupportedMin, got.SupportedMax)
			}
		})
	}
}

func TestGatewaySupportCheckSingleVersionRange(t *testing.T) {
	support := mustGatewaySupport(t, "0.1.2", "0.1.2")
	for reported, want := range map[string]GatewayCompatibilityStatus{
		"0.1.1": GatewayUnsupported,
		"0.1.2": GatewaySupported,
		"0.1.3": GatewayUntested,
	} {
		if got := support.Check(reported).Status; got != want {
			t.Errorf("Check(%q).Status = %q, want %q", reported, got, want)
		}
	}
}

// Without a range the BFF has nothing to compare against, so it says so for
// every gateway — including ones that would be out of any sensible range.
func TestGatewaySupportUnconfigured(t *testing.T) {
	var support GatewaySupport
	if support.Configured() {
		t.Fatal("zero value reports Configured() = true")
	}
	if got := support.String(); got != "" {
		t.Errorf("String() = %q, want empty", got)
	}
	for _, reported := range []string{"0.0.116", "0.1.2", "0.1.3-dev.84+ge7fdd6bee", ""} {
		got := support.Check(reported)
		if got.Status != GatewayUnknown || got.SupportedMin != "" || got.SupportedMax != "" {
			t.Errorf("Check(%q) = %+v, want status unknown and no range", reported, got)
		}
	}
}

func TestParseGatewaySupport(t *testing.T) {
	tests := []struct {
		name       string
		minVersion string
		maxVersion string
		wantRange  string
		wantErr    string
	}{
		{name: "both unset turns the check off quietly", minVersion: "", maxVersion: "", wantRange: ""},
		{name: "a range", minVersion: "0.1.0", maxVersion: "0.1.2", wantRange: "0.1.0..0.1.2"},
		{name: "a single version", minVersion: "0.1.2", maxVersion: "0.1.2", wantRange: "0.1.2..0.1.2"},
		{name: "whitespace from an env file", minVersion: " 0.1.0 ", maxVersion: "0.1.2\n", wantRange: "0.1.0..0.1.2"},
		{name: "minimum only", minVersion: "0.1.0", maxVersion: "", wantErr: "both ends"},
		{name: "maximum only", minVersion: "", maxVersion: "0.1.2", wantErr: "both ends"},
		{name: "inverted", minVersion: "0.1.2", maxVersion: "0.1.0", wantErr: "newer than maximum"},
		{name: "v prefix", minVersion: "v0.1.0", maxVersion: "0.1.2", wantErr: "minimum"},
		{name: "pre-release end", minVersion: "0.1.0", maxVersion: "0.1.3-dev.84", wantErr: "maximum"},
		{name: "build metadata", minVersion: "0.1.0", maxVersion: "0.1.2+g1", wantErr: "maximum"},
		{name: "moving tag", minVersion: "0.1.0", maxVersion: "latest", wantErr: "maximum"},
		{name: "leading zero", minVersion: "0.01.0", maxVersion: "0.1.2", wantErr: "minimum"},
		{name: "two components", minVersion: "0.1", maxVersion: "0.1.2", wantErr: "minimum"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			support, err := ParseGatewaySupport(tc.minVersion, tc.maxVersion)
			if tc.wantErr != "" {
				if err == nil {
					t.Fatalf("expected an error containing %q, got range %q", tc.wantErr, support.String())
				}
				if !strings.Contains(err.Error(), tc.wantErr) {
					t.Errorf("error = %q, want substring %q", err.Error(), tc.wantErr)
				}
				// A bad range must leave the check off, not half-configured.
				if support.Configured() {
					t.Errorf("a rejected range is still configured: %q", support.String())
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got := support.String(); got != tc.wantRange {
				t.Errorf("range = %q, want %q", got, tc.wantRange)
			}
			if support.Configured() != (tc.wantRange != "") {
				t.Errorf("Configured() = %v for range %q", support.Configured(), tc.wantRange)
			}
		})
	}
}

// SemVer 2.0.0 §11, plus the dev-build shapes upstream publishes. Each entry
// is older than the one after it.
func TestGatewayVersionOrdering(t *testing.T) {
	ascending := []string{
		"0.0.116",
		"0.0.117-dev.253+g1111111",
		"0.0.117-dev.259+gbed9e5eaf",
		"0.1.0-pre.8",
		"0.1.0",
		"0.1.1",
		"0.1.2-dev.7",
		"0.1.2",
		"0.1.3-alpha",
		"0.1.3-alpha.1",
		"0.1.3-alpha.beta",
		"0.1.3-dev.9",
		"0.1.3-dev.84+ge7fdd6bee",
		"0.1.3-pre.4",
		"0.1.3",
		"0.1.10",
		"0.2.0",
		"1.0.0",
	}
	parsed := make([]gatewayVersion, len(ascending))
	for i, raw := range ascending {
		version, err := parseGatewayVersion(raw)
		if err != nil {
			t.Fatalf("parseGatewayVersion(%q): %v", raw, err)
		}
		parsed[i] = version
	}
	for i := range parsed {
		for j := range parsed {
			want := 0
			switch {
			case i < j:
				want = -1
			case i > j:
				want = 1
			}
			if got := parsed[i].compare(parsed[j]); got != want {
				t.Errorf("compare(%q, %q) = %d, want %d", ascending[i], ascending[j], got, want)
			}
		}
	}

	// Build metadata never orders two builds.
	a, _ := parseGatewayVersion("0.1.3-dev.84+ge7fdd6bee")
	b, _ := parseGatewayVersion("0.1.3-dev.84+g0000000")
	if a.compare(b) != 0 {
		t.Errorf("versions differing only in build metadata compare as %d, want 0", a.compare(b))
	}
}

// The wire shape the frontend reads: a verdict nested under its own key so it
// cannot be mistaken for something the gateway said.
func TestGatewayInfoCompatibilityJSON(t *testing.T) {
	info := FromSDKGatewayInfo(nil)
	raw, err := json.Marshal(info)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if strings.Contains(string(raw), "compatibility") {
		t.Errorf("an unjudged GatewayInfo serializes a compatibility key: %s", raw)
	}

	verdict := mustGatewaySupport(t, "0.1.0", "0.1.2").Check("0.0.116")
	info.Compatibility = &verdict
	raw, err = json.Marshal(info)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	const want = `"compatibility":{"status":"unsupported","supportedMin":"0.1.0","supportedMax":"0.1.2"}`
	if !strings.Contains(string(raw), want) {
		t.Errorf("GatewayInfo JSON = %s, want it to contain %s", raw, want)
	}

	unknown := GatewaySupport{}.Check("0.1.2")
	raw, err = json.Marshal(unknown)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if string(raw) != `{"status":"unknown"}` {
		t.Errorf("unconfigured verdict JSON = %s, want {\"status\":\"unknown\"}", raw)
	}
}
