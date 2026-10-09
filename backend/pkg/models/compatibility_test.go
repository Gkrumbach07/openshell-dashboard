package models

import (
	"encoding/json"
	"strings"
	"testing"
)

func mustGatewayReleaseLine(t *testing.T, raw string) GatewayReleaseLine {
	t.Helper()
	line, err := ParseGatewayReleaseLine(raw)
	if err != nil {
		t.Fatalf("ParseGatewayReleaseLine(%q): %v", raw, err)
	}
	return line
}

// The line below is the one main ships with today, and the versions are ones
// gateways have really reported. This table is the documented answer to "which
// gateways does a build for 0.1 support".
func TestGatewayReleaseLineCheck(t *testing.T) {
	line := mustGatewayReleaseLine(t, "0.1")

	tests := []struct {
		name     string
		reported string
		want     GatewayCompatibilityStatus
	}{
		// Releases of the line: any patch, whichever one this build was
		// tested on.
		{name: "first release of the line", reported: "0.1.0", want: GatewaySupported},
		{name: "a release between the lanes", reported: "0.1.1", want: GatewaySupported},
		{name: "the release this build is tested on", reported: "0.1.3", want: GatewaySupported},
		{name: "a later patch of the line", reported: "0.1.9", want: GatewaySupported},
		{name: "numbers compare as numbers, not text", reported: "0.1.10", want: GatewaySupported},
		{name: "tag-style v prefix", reported: "v0.1.2", want: GatewaySupported},
		{name: "surrounding whitespace", reported: " 0.1.2\n", want: GatewaySupported},

		// Builds before a release of the line are still the line. Build
		// metadata is ignored.
		{name: "pre-release of a later patch", reported: "0.1.4-pre.2", want: GatewaySupported},
		{name: "dev build, as upstream HEAD reports it", reported: "0.1.3-dev.114+g3fc93e282", want: GatewaySupported},
		{name: "pre-release of the line's first release", reported: "0.1.0-pre.8", want: GatewaySupported},
		{name: "release candidate", reported: "0.1.3-rc1", want: GatewaySupported},
		{name: "build metadata on a release", reported: "0.1.2+build.5", want: GatewaySupported},
		{name: "build metadata containing a dash is not a suffix", reported: "0.1.2+g-abc", want: GatewaySupported},

		// A downstream rebuild (x.y.z-rhaiv.N is how the RHOAI midstream
		// tags its gateways) is the release it rebuilds.
		{name: "downstream rebuild", reported: "0.1.2-rhaiv.5", want: GatewaySupported},
		{name: "downstream rebuild carrying build metadata", reported: "0.1.2-rhaiv.5+g1a2b3c4", want: GatewaySupported},

		// Every other line, older or newer.
		{name: "older line (the 0.2.x dashboard's gateway)", reported: "0.0.116", want: GatewayUnsupported},
		{name: "dev build of an older line", reported: "0.0.117-dev.259+gbed9e5eaf", want: GatewayUnsupported},
		{name: "downstream rebuild of an older line", reported: "0.0.116-rhaiv.12", want: GatewayUnsupported},
		{name: "next minor release", reported: "0.2.0", want: GatewayUnsupported},
		{name: "pre-release of the next minor", reported: "0.2.0-pre.1", want: GatewayUnsupported},
		{name: "dev build of the next minor", reported: "0.2.0-dev.3+gabc1234", want: GatewayUnsupported},
		{name: "minors compare as numbers, not text", reported: "0.10.0", want: GatewayUnsupported},
		{name: "same minor of another major", reported: "1.1.0", want: GatewayUnsupported},

		// Never a guess: a gateway that does not know its own version. Both
		// forms would otherwise read as line 0.0 and be reported as
		// unsupported, whatever the gateway really is.
		{name: "unstamped build reports the Cargo placeholder", reported: "0.0.0", want: GatewayUnknown},
		{name: "placeholder with a suffix", reported: "0.0.0-rhaiv.3", want: GatewayUnknown},
		{name: "build with no release tag reachable", reported: "0.0.1-dev.7+gabcdef123", want: GatewayUnknown},
		{name: "0.0.1 is a real release number", reported: "0.0.1", want: GatewayUnsupported},
		{name: "a rebuild of 0.0.1 is a real release too", reported: "0.0.1-rhaiv.2", want: GatewayUnsupported},
		{name: "dev build after a real release is a real version", reported: "0.0.2-dev.3+gabc1234", want: GatewayUnsupported},

		// Never a guess: a version that cannot be read.
		{name: "empty version", reported: "", want: GatewayUnknown},
		{name: "not a version", reported: "dev", want: GatewayUnknown},
		{name: "two components", reported: "0.1", want: GatewayUnknown},
		{name: "four components", reported: "0.1.2.3", want: GatewayUnknown},
		{name: "non-numeric component", reported: "0.x.2", want: GatewayUnknown},
		{name: "empty suffix identifier", reported: "0.1.2-", want: GatewayUnknown},
		{name: "signed component", reported: "0.+1.2", want: GatewayUnknown},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := line.Check(tc.reported)
			if got.Status != tc.want {
				t.Errorf("Check(%q).Status = %q, want %q", tc.reported, got.Status, tc.want)
			}
			// The line is echoed whenever there is one, including for
			// "unknown", so the UI can still say what was expected.
			if got.SupportedLine != "0.1" {
				t.Errorf("Check(%q).SupportedLine = %q, want 0.1", tc.reported, got.SupportedLine)
			}
		})
	}
}

// The line moves with the gateway's minor. A build for the next line supports
// that line and nothing of the one before it.
func TestGatewayReleaseLineCheckOtherLines(t *testing.T) {
	tests := []struct {
		line     string
		reported string
		want     GatewayCompatibilityStatus
	}{
		{line: "0.2", reported: "0.2.0", want: GatewaySupported},
		{line: "0.2", reported: "0.2.0-pre.1", want: GatewaySupported},
		{line: "0.2", reported: "0.1.3", want: GatewayUnsupported},
		{line: "0.2", reported: "0.3.0", want: GatewayUnsupported},
		{line: "1.0", reported: "1.0.4-rhaiv.1", want: GatewaySupported},
		{line: "1.0", reported: "0.0.116", want: GatewayUnsupported},
		// 0.0.5 is a real release of line 0.0, but a gateway with no version
		// of its own is unknown on every line, 0.0 included.
		{line: "0.0", reported: "0.0.5", want: GatewaySupported},
		{line: "0.0", reported: "0.0.0", want: GatewayUnknown},
		{line: "0.2", reported: "0.0.0", want: GatewayUnknown},
	}
	for _, tc := range tests {
		line := mustGatewayReleaseLine(t, tc.line)
		if got := line.Check(tc.reported).Status; got != tc.want {
			t.Errorf("line %s: Check(%q).Status = %q, want %q", line, tc.reported, got, tc.want)
		}
	}
}

// Without a line the BFF has nothing to compare against, so it says so for
// every gateway and names no line.
func TestGatewayReleaseLineZeroValue(t *testing.T) {
	var line GatewayReleaseLine
	if got := line.String(); got != "" {
		t.Errorf("String() = %q, want empty", got)
	}
	for _, reported := range []string{"0.0.116", "0.1.2", "0.1.3-dev.84+ge7fdd6bee", ""} {
		got := line.Check(reported)
		if got.Status != GatewayUnknown || got.SupportedLine != "" {
			t.Errorf("Check(%q) = %+v, want status unknown and no line", reported, got)
		}
	}
}

func TestParseGatewayReleaseLine(t *testing.T) {
	tests := []struct {
		name    string
		raw     string
		want    string
		wantErr bool
	}{
		{name: "a line", raw: "0.1", want: "0.1"},
		{name: "two digits", raw: "0.10", want: "0.10"},
		{name: "a later major", raw: "1.0", want: "1.0"},
		{name: "whitespace from an env file", raw: " 0.1\n", want: "0.1"},
		{name: "empty", raw: "", wantErr: true},
		{name: "a full version", raw: "0.1.3", wantErr: true},
		{name: "the way the line is shown to people", raw: "0.1.x", wantErr: true},
		{name: "v prefix", raw: "v0.1", wantErr: true},
		{name: "one component", raw: "0", wantErr: true},
		{name: "leading zero", raw: "0.01", wantErr: true},
		{name: "non-numeric", raw: "0.x", wantErr: true},
		{name: "signed", raw: "0.+1", wantErr: true},
		{name: "moving tag", raw: "latest", wantErr: true},
		{name: "too large to be a number", raw: "0.99999999999999999999", wantErr: true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			line, err := ParseGatewayReleaseLine(tc.raw)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected an error, got line %q", line)
				}
				// A rejected line must leave no line behind, not half of one.
				if line != (GatewayReleaseLine{}) {
					t.Errorf("a rejected line is still set: %q", line)
				}
				// The message is logged for an operator: it has to say what
				// a line looks like.
				if !strings.Contains(err.Error(), "major.minor") {
					t.Errorf("error = %q, want it to say major.minor", err.Error())
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got := line.String(); got != tc.want {
				t.Errorf("line = %q, want %q", got, tc.want)
			}
		})
	}
}

// The line compiled into the build has to be one the build can read: a
// constant that does not parse would turn every verdict into "unknown" with
// nothing to say why. That it is the RIGHT line is checked against
// deploy/ci/gateway-pins.json by `node scripts/gateway-range.mjs --check`.
func TestBuiltInGatewayReleaseLine(t *testing.T) {
	line, err := ParseGatewayReleaseLine(BuiltInGatewayReleaseLine)
	if err != nil {
		t.Fatalf("BuiltInGatewayReleaseLine: %v", err)
	}
	if line.String() != BuiltInGatewayReleaseLine {
		t.Errorf("BuiltInGatewayReleaseLine = %q, which reads back as %q", BuiltInGatewayReleaseLine, line)
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

	verdict := mustGatewayReleaseLine(t, "0.1").Check("0.2.0")
	info.Compatibility = &verdict
	raw, err = json.Marshal(info)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	const want = `"compatibility":{"status":"unsupported","supportedLine":"0.1"}`
	if !strings.Contains(string(raw), want) {
		t.Errorf("GatewayInfo JSON = %s, want it to contain %s", raw, want)
	}

	unknown := GatewayReleaseLine{}.Check("0.1.2")
	raw, err = json.Marshal(unknown)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if string(raw) != `{"status":"unknown"}` {
		t.Errorf("verdict without a line JSON = %s, want {\"status\":\"unknown\"}", raw)
	}
}
