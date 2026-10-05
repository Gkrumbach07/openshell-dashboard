package models

import (
	"fmt"
	"strconv"
	"strings"
)

// GatewayCompatibilityStatus is the dashboard's verdict on the gateway it is
// talking to, relative to the range of gateway releases this build supports.
type GatewayCompatibilityStatus string

const (
	// GatewayUnsupported means the gateway is older than the oldest release
	// this build works with. Calls are expected to fail, often with an error
	// that does not name the cause (see ADR 0005).
	GatewayUnsupported GatewayCompatibilityStatus = "unsupported"
	// GatewaySupported means the gateway is inside the supported range.
	GatewaySupported GatewayCompatibilityStatus = "supported"
	// GatewayUntested means the gateway is newer than the newest release this
	// build was tested against. It may well work; nobody has checked.
	GatewayUntested GatewayCompatibilityStatus = "untested"
	// GatewayUnknown means no verdict: either no range is configured or the
	// gateway reported a version that cannot be read. It is never a guess.
	GatewayUnknown GatewayCompatibilityStatus = "unknown"
)

// GatewayCompatibility is the dashboard's own judgement of the gateway — it is
// NOT gateway data. The gateway reports only its version (GetGatewayInfo); the
// BFF compares that to the range it was built for and says where it falls.
//
// It informs and nothing else. The BFF never refuses a request because of it
// (ADR 0002: relay only).
type GatewayCompatibility struct {
	Status GatewayCompatibilityStatus `json:"status"`
	// SupportedMin and SupportedMax echo the configured range so the UI can
	// name it. Both are omitted when no range is configured.
	SupportedMin string `json:"supportedMin,omitempty"`
	SupportedMax string `json:"supportedMax,omitempty"`
}

// GatewaySupport is the range of gateway releases a build supports: the oldest
// it still works with and the newest it has been tested against. Both ends are
// inclusive.
//
// The zero value means "no range configured", and Check then answers
// GatewayUnknown for every gateway. A range is only ever given to the BFF
// (GATEWAY_SUPPORTED_MIN / GATEWAY_SUPPORTED_MAX); it is never assumed, because
// the range is whatever the compat suite was actually run against.
type GatewaySupport struct {
	min        gatewayVersion
	max        gatewayVersion
	configured bool
}

// ParseGatewaySupport builds a range from its two ends. Each must be a plain
// release version, x.y.z — the range is defined by releases, so a pre-release,
// a build suffix or a "v" prefix is rejected rather than interpreted.
//
// Two empty strings are not an error: they return the zero value, which turns
// the check off. Anything else that cannot form a range returns the zero value
// AND an error, so the caller can say why the check is off.
func ParseGatewaySupport(minVersion, maxVersion string) (GatewaySupport, error) {
	minVersion, maxVersion = strings.TrimSpace(minVersion), strings.TrimSpace(maxVersion)
	if minVersion == "" && maxVersion == "" {
		return GatewaySupport{}, nil
	}
	if minVersion == "" || maxVersion == "" {
		return GatewaySupport{}, fmt.Errorf("both ends of the range are required (minimum %q, maximum %q)", minVersion, maxVersion)
	}
	lowest, err := parseGatewayRelease(minVersion)
	if err != nil {
		return GatewaySupport{}, fmt.Errorf("minimum: %w", err)
	}
	highest, err := parseGatewayRelease(maxVersion)
	if err != nil {
		return GatewaySupport{}, fmt.Errorf("maximum: %w", err)
	}
	if lowest.compare(highest) > 0 {
		return GatewaySupport{}, fmt.Errorf("minimum %s is newer than maximum %s", lowest, highest)
	}
	return GatewaySupport{min: lowest, max: highest, configured: true}, nil
}

// Configured reports whether a range was given.
func (s GatewaySupport) Configured() bool { return s.configured }

// String renders the range for logs, or "" when none is configured.
func (s GatewaySupport) String() string {
	if !s.configured {
		return ""
	}
	return s.min.String() + ".." + s.max.String()
}

// Check places the version a gateway reported relative to the range.
//
// Versions are ordered by SemVer 2.0.0 precedence, which settles how the
// builds a gateway can actually report compare:
//
//   - Build metadata ("+ge7fdd6bee") is ignored.
//   - A pre-release or dev build sorts just BELOW the release it leads up to:
//     0.1.2 < 0.1.3-dev.84 < 0.1.3. A dev build of the next release is
//     therefore newer than the maximum and is GatewayUntested, and a
//     pre-release of the minimum itself (0.1.0-pre.8 against 0.1.0) is
//     GatewayUnsupported — the range starts at the release.
//   - Nothing else is special-cased. In particular a dev build is never
//     trusted because it happens to work: late 0.0.117-dev builds already
//     carry the wire format 0.1.0 shipped (one was this repo's CI pin), but
//     they sort below 0.1.0 and are reported as GatewayUnsupported like every
//     other build below the floor. The range is made of releases.
//
// A version that cannot be parsed is GatewayUnknown, not a guess.
func (s GatewaySupport) Check(reported string) GatewayCompatibility {
	if !s.configured {
		return GatewayCompatibility{Status: GatewayUnknown}
	}
	out := GatewayCompatibility{
		Status:       GatewayUnknown,
		SupportedMin: s.min.String(),
		SupportedMax: s.max.String(),
	}
	version, err := parseGatewayVersion(reported)
	if err != nil {
		return out
	}
	switch {
	case version.compare(s.min) < 0:
		out.Status = GatewayUnsupported
	case version.compare(s.max) > 0:
		out.Status = GatewayUntested
	default:
		out.Status = GatewaySupported
	}
	return out
}

// gatewayVersion is a parsed semantic version. Build metadata is dropped while
// parsing because it never takes part in ordering.
type gatewayVersion struct {
	// pre holds the dot-separated pre-release identifiers; empty for a release.
	pre   []string
	major uint64
	minor uint64
	patch uint64
}

// String renders the version without build metadata.
func (v gatewayVersion) String() string {
	core := fmt.Sprintf("%d.%d.%d", v.major, v.minor, v.patch)
	if len(v.pre) == 0 {
		return core
	}
	return core + "-" + strings.Join(v.pre, ".")
}

// parseGatewayRelease parses one end of the supported range: exactly x.y.z.
// A pre-release is rejected outright; comparing the canonical rendering with
// the input then rejects a "v" prefix, build metadata and leading zeros.
func parseGatewayRelease(raw string) (gatewayVersion, error) {
	version, err := parseGatewayVersion(raw)
	if err != nil || len(version.pre) > 0 || version.String() != raw {
		return gatewayVersion{}, fmt.Errorf("%q is not a plain x.y.z release version", raw)
	}
	return version, nil
}

// parseGatewayVersion parses a version as a gateway reports it: "0.1.2",
// "0.0.116", "0.1.3-dev.84+ge7fdd6bee". One leading "v" is accepted because
// upstream's tags carry it even though the gateway does not report it.
func parseGatewayVersion(raw string) (gatewayVersion, error) {
	text := strings.TrimPrefix(strings.TrimSpace(raw), "v")
	// Build metadata first: it may itself contain "-".
	text, _, _ = strings.Cut(text, "+")
	core, pre, hasPre := strings.Cut(text, "-")

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
	if hasPre {
		version.pre = strings.Split(pre, ".")
		for _, identifier := range version.pre {
			if !isPreReleaseIdentifier(identifier) {
				return gatewayVersion{}, fmt.Errorf("%q is not a semantic version", raw)
			}
		}
	}
	return version, nil
}

// compare returns -1, 0 or 1 as v is older than, equal to or newer than other,
// by SemVer 2.0.0 precedence (https://semver.org/#spec-item-11).
func (v gatewayVersion) compare(other gatewayVersion) int {
	for _, pair := range [3][2]uint64{{v.major, other.major}, {v.minor, other.minor}, {v.patch, other.patch}} {
		if pair[0] != pair[1] {
			return compareUint(pair[0], pair[1])
		}
	}
	// Same x.y.z: a release outranks any pre-release of itself.
	switch {
	case len(v.pre) == 0 && len(other.pre) == 0:
		return 0
	case len(v.pre) == 0:
		return 1
	case len(other.pre) == 0:
		return -1
	}
	for i := 0; i < len(v.pre) && i < len(other.pre); i++ {
		if result := comparePreReleaseIdentifier(v.pre[i], other.pre[i]); result != 0 {
			return result
		}
	}
	// All shared identifiers equal: the longer list is the newer build.
	return compareUint(uint64(len(v.pre)), uint64(len(other.pre)))
}

// comparePreReleaseIdentifier orders two pre-release identifiers: numeric ones
// numerically ("dev.84" < "dev.259"), a numeric one below an alphanumeric one,
// and two alphanumeric ones in ASCII order.
func comparePreReleaseIdentifier(a, b string) int {
	aNumber, aErr := strconv.ParseUint(a, 10, 64)
	bNumber, bErr := strconv.ParseUint(b, 10, 64)
	aNumeric, bNumeric := isDigits(a) && aErr == nil, isDigits(b) && bErr == nil
	switch {
	case aNumeric && bNumeric:
		return compareUint(aNumber, bNumber)
	case aNumeric:
		return -1
	case bNumeric:
		return 1
	}
	return strings.Compare(a, b)
}

func compareUint(a, b uint64) int {
	switch {
	case a < b:
		return -1
	case a > b:
		return 1
	}
	return 0
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

func isPreReleaseIdentifier(s string) bool {
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
