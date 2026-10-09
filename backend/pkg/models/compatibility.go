package models

import (
	"fmt"
	"strconv"
	"strings"
)

// GatewayCompatibilityStatus is the dashboard's verdict on the gateway it is
// talking to, relative to the gateway release line this build is for.
type GatewayCompatibilityStatus string

const (
	// GatewayUnsupported means the gateway is on another minor release line,
	// older or newer. This build is not tested with it, and calls can fail
	// with an error that does not name the cause (ADR 0005 has the example).
	GatewayUnsupported GatewayCompatibilityStatus = "unsupported"
	// GatewaySupported means the gateway is on this build's release line.
	GatewaySupported GatewayCompatibilityStatus = "supported"
	// GatewayUnknown means no verdict: the gateway reported a version that
	// cannot be read, the gateway does not know its own version, or the line
	// this build was told to use cannot be read. It is never a guess.
	GatewayUnknown GatewayCompatibilityStatus = "unknown"
)

// GatewayCompatibility is the dashboard's own judgement of the gateway — it is
// NOT gateway data. The gateway reports only its version; the BFF compares
// that to the release line it was built for and says whether they match.
//
// It informs and nothing else. The BFF never refuses a request because of it
// (ADR 0002: relay only).
type GatewayCompatibility struct {
	Status GatewayCompatibilityStatus `json:"status"`
	// SupportedLine echoes the release line, major.minor, so the UI can name
	// it. It is omitted when the BFF has no line it can read.
	SupportedLine string `json:"supportedLine,omitempty"`
}

// GatewayReleaseLine is a gateway minor release line, major.minor: every
// release that shares those two numbers. A build supports exactly one
// (ADR 0009), and the patch number plays no part.
//
// The zero value is "no line", and Check then answers GatewayUnknown for
// every gateway. A build's own line is BuiltInGatewayReleaseLine.
type GatewayReleaseLine struct {
	major uint64
	minor uint64
	set   bool
}

// ParseGatewayReleaseLine reads a release line written major.minor, like
// "0.1". A full version, a "v" prefix, a ".x" suffix and leading zeros are
// rejected rather than interpreted: comparing the canonical rendering with
// the input catches them all.
//
// Anything that is not a line returns the zero value AND an error, so the
// caller can say why there is no verdict.
func ParseGatewayReleaseLine(raw string) (GatewayReleaseLine, error) {
	text := strings.TrimSpace(raw)
	notALine := fmt.Errorf("%q is not a gateway release line; write major.minor, like %s", text, BuiltInGatewayReleaseLine)
	major, minor, found := strings.Cut(text, ".")
	if !found || !isDigits(major) || !isDigits(minor) {
		return GatewayReleaseLine{}, notALine
	}
	line := GatewayReleaseLine{set: true}
	var err error
	if line.major, err = strconv.ParseUint(major, 10, 64); err != nil {
		return GatewayReleaseLine{}, notALine
	}
	if line.minor, err = strconv.ParseUint(minor, 10, 64); err != nil {
		return GatewayReleaseLine{}, notALine
	}
	if line.String() != text {
		return GatewayReleaseLine{}, notALine
	}
	return line, nil
}

// String renders the line as major.minor, or "" for the zero value.
func (l GatewayReleaseLine) String() string {
	if !l.set {
		return ""
	}
	return fmt.Sprintf("%d.%d", l.major, l.minor)
}

// Check says whether the version a gateway reported is on the line.
//
// Only the first two numbers are compared. Everything else a gateway can
// report about a release of the line is still that line, and is
// GatewaySupported:
//
//   - any patch, older or newer than the one this build was tested on
//     (0.1.0, 0.1.9);
//   - upstream's builds before a release of the line: a tagged pre-release
//     (0.1.4-pre.2) and a dev build (0.1.3-dev.114+g3fc93e282);
//   - a downstream rebuild of a release (0.1.2-rhaiv.5, which is how the
//     RHOAI midstream tags its gateways).
//
// Every other line is GatewayUnsupported, older (0.0.116) or newer (0.2.0),
// and so is a pre-release of one (0.2.0-pre.1).
//
// Two answers are GatewayUnknown rather than a guess: a version that cannot be
// parsed, and a gateway that does not know its own version (see unstamped).
func (l GatewayReleaseLine) Check(reported string) GatewayCompatibility {
	out := GatewayCompatibility{Status: GatewayUnknown, SupportedLine: l.String()}
	if !l.set {
		return out
	}
	version, err := parseGatewayVersion(reported)
	if err != nil || version.unstamped() {
		return out
	}
	if version.major == l.major && version.minor == l.minor {
		out.Status = GatewaySupported
	} else {
		out.Status = GatewayUnsupported
	}
	return out
}

// gatewayVersion is a parsed semantic version, reduced to what places it on a
// release line. Build metadata is dropped while parsing.
type gatewayVersion struct {
	// suffix holds the dot-separated identifiers after the "-": an upstream
	// pre-release ("dev.84", "pre.8") or a downstream rebuild counter
	// ("rhaiv.5"). Empty for a plain release.
	suffix []string
	major  uint64
	minor  uint64
	patch  uint64
}

// unstamped reports whether this is the version of a gateway that does not
// know its own version. Such a build can be any age, so placing it on a line
// would be a guess — and for a current gateway a wrong one, since both forms
// read as line 0.0:
//
//   - 0.0.0 is the placeholder in upstream's Cargo.toml. A release build
//     overwrites it; a build that was given no version reports it as is.
//   - 0.0.1-dev.N is what upstream's build derives from git when no release
//     tag is reachable, for example in a shallow clone ("the commit after no
//     release at all").
//
// A plain 0.0.1 is a real release number and is judged like any other.
func (v gatewayVersion) unstamped() bool {
	if v.major != 0 || v.minor != 0 {
		return false
	}
	switch v.patch {
	case 0:
		return true
	case 1:
		return len(v.suffix) > 0 && v.suffix[0] == "dev"
	}
	return false
}

// parseGatewayVersion parses a version as a gateway reports it: "0.1.2",
// "0.0.116", "0.1.3-dev.84+ge7fdd6bee", "0.1.2-rhaiv.5". One leading "v" is
// accepted because upstream's tags carry it even though the gateway does not
// report it.
func parseGatewayVersion(raw string) (gatewayVersion, error) {
	text := strings.TrimPrefix(strings.TrimSpace(raw), "v")
	// Build metadata first: it may itself contain "-".
	text, _, _ = strings.Cut(text, "+")
	core, suffix, hasSuffix := strings.Cut(text, "-")

	parts := strings.Split(core, ".")
	if len(parts) != 3 {
		return gatewayVersion{}, fmt.Errorf("%q is not a semantic version", raw)
	}
	var numbers [3]uint64
	for i, part := range parts {
		if !isDigits(part) {
			return gatewayVersion{}, fmt.Errorf("%q is not a semantic version", raw)
		}
		number, err := strconv.ParseUint(part, 10, 64)
		if err != nil {
			return gatewayVersion{}, fmt.Errorf("%q is not a semantic version", raw)
		}
		numbers[i] = number
	}

	version := gatewayVersion{major: numbers[0], minor: numbers[1], patch: numbers[2]}
	if hasSuffix {
		version.suffix = strings.Split(suffix, ".")
		for _, identifier := range version.suffix {
			if !isSuffixIdentifier(identifier) {
				return gatewayVersion{}, fmt.Errorf("%q is not a semantic version", raw)
			}
		}
	}
	return version, nil
}

func isDigits(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

func isSuffixIdentifier(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		isAlphanumeric := (r >= '0' && r <= '9') || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z')
		if !isAlphanumeric && r != '-' {
			return false
		}
	}
	return true
}
