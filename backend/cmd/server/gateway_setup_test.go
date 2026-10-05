package main

import (
	"bytes"
	"log/slog"
	"strings"
	"testing"
)

// captureLogs swaps the default logger for the duration of a test and returns
// the buffer it writes to.
func captureLogs(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, nil)))
	t.Cleanup(func() { slog.SetDefault(previous) })
	return &buf
}

// A range the BFF cannot use must never stop it starting and must never be
// replaced by a guess: the check goes off, and the operator is told why.
func TestGatewaySupport(t *testing.T) {
	tests := []struct {
		name       string
		minVersion string
		maxVersion string
		wantRange  string
		wantWarn   bool
	}{
		{name: "unset is silent", wantRange: ""},
		{name: "a valid range is silent", minVersion: "0.1.0", maxVersion: "0.1.2", wantRange: "0.1.0..0.1.2"},
		{name: "one end only", minVersion: "0.1.0", wantRange: "", wantWarn: true},
		{name: "not a version", minVersion: "0.1.0", maxVersion: "latest", wantRange: "", wantWarn: true},
		{name: "inverted", minVersion: "0.1.2", maxVersion: "0.1.0", wantRange: "", wantWarn: true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			logs := captureLogs(t)

			support := gatewaySupport(tc.minVersion, tc.maxVersion)

			if got := support.String(); got != tc.wantRange {
				t.Errorf("range = %q, want %q", got, tc.wantRange)
			}
			warned := strings.Contains(logs.String(), "level=WARN")
			if warned != tc.wantWarn {
				t.Errorf("warned = %v, want %v; logs: %s", warned, tc.wantWarn, logs.String())
			}
			if tc.wantWarn {
				// The warning has to name both variables, because the usual
				// mistake is setting only one of them.
				for _, name := range []string{"GATEWAY_SUPPORTED_MIN", "GATEWAY_SUPPORTED_MAX"} {
					if !strings.Contains(logs.String(), name) {
						t.Errorf("warning does not mention %s: %s", name, logs.String())
					}
				}
			}
		})
	}
}
