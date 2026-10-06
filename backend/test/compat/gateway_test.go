//go:build compat

package compat

import (
	"fmt"
	"net/http"
	"testing"
)

// Ports cypress/e2e-integration/gateway.cy.ts.
func TestGatewayInfo(t *testing.T) {
	var info struct {
		Status         string `json:"status"`
		GatewayVersion string `json:"gatewayVersion"`
		ComputeDrivers []struct {
			Name string `json:"name"`
		} `json:"computeDrivers"`
	}
	mustJSON(t, http.MethodGet, "/api/v1/gateway", nil, &info, http.StatusOK)

	if info.Status != "HEALTHY" {
		t.Errorf("status = %q, want HEALTHY", info.Status)
	}
	if info.GatewayVersion == "" {
		t.Error("gatewayVersion is empty — GetGatewayInfo no longer reports a version")
	}
	if len(info.ComputeDrivers) == 0 {
		t.Fatal("computeDrivers is empty — the gateway reported no compute drivers")
	}
	if info.ComputeDrivers[0].Name == "" {
		t.Error("computeDrivers[0].name is empty")
	}
}

func TestHealthz(t *testing.T) {
	var body struct {
		Status string `json:"status"`
	}
	mustJSON(t, http.MethodGet, "/api/v1/healthz", nil, &body, http.StatusOK)
	if body.Status != "ok" {
		t.Errorf("status = %q, want ok", body.Status)
	}
}

// Readyz proves the BFF can actually reach the gateway, which healthz does not.
func TestReadyz(t *testing.T) {
	var body struct {
		Status string `json:"status"`
	}
	mustJSON(t, http.MethodGet, "/api/v1/readyz", nil, &body, http.StatusOK)
	if body.Status != "ready" {
		t.Errorf("status = %q, want ready", body.Status)
	}
}

func TestAuthConfig(t *testing.T) {
	var cfg struct {
		AuthDisabled bool `json:"authDisabled"`
	}
	mustJSON(t, http.MethodGet, "/api/v1/auth/config", nil, &cfg, http.StatusOK)
	if !cfg.AuthDisabled {
		t.Error("authDisabled = false, want true (the compat stack runs with AUTH_DISABLED=true)")
	}
}

// settingEntry mirrors models.SettingEntry. Value is the setting's value in the
// JSON type the gateway has it in — a string, a bool, or a float64, which is
// how encoding/json reads a number — and nil for a setting that is listed
// without one, which is how the gateway lists a setting that was never set.
type settingEntry struct {
	Value any    `json:"value"`
	Key   string `json:"key"`
}

// gatewaySettings mirrors models.GatewaySettings.
type gatewaySettings struct {
	Settings         []settingEntry `json:"settings"`
	SettingsRevision uint64         `json:"settingsRevision"`
}

// lookup returns the value of key, nil when key is listed without a value, and
// false when it is not listed at all.
func (s gatewaySettings) lookup(key string) (any, bool) {
	for _, e := range s.Settings {
		if e.Key == key {
			return e.Value, true
		}
	}
	return nil, false
}

// verdict is what a test that wants to change gateway-global state concludes
// from reading that state first.
type verdict int

const (
	// proceed: nothing is set, so what the test writes is its own to remove.
	proceed verdict = iota
	// standDown: something is set that the test did not put there, or the
	// gateway does not offer the thing at all. The writing subtests skip.
	standDown
	// broken: the read itself is wrong. The test fails.
	broken
)

// settingWriteVerdict decides whether TestGlobalSettings may set and unset
// key, given what the gateway listed before the test touched anything.
//
// An empty list is a failure and never a reason to skip. Gateways 0.1.0 to
// 0.1.2 list every setting they know, set or not, so no settings at all means
// the settings map stopped decoding somewhere between the gateway and the
// BFF: the kind of wire change this suite exists to catch, and one that
// leaves the Settings page blank.
func settingWriteVerdict(listed gatewaySettings, key string) (verdict, string) {
	if len(listed.Settings) == 0 {
		return broken, "the gateway listed no settings at all. It lists every setting it knows even when none " +
			"is set, so an empty list means the settings map no longer decodes and the Settings page is blank"
	}
	current, ok := listed.lookup(key)
	if !ok {
		keys := make([]string, 0, len(listed.Settings))
		for _, e := range listed.Settings {
			keys = append(keys, e.Key)
		}
		return standDown, fmt.Sprintf("this gateway does not offer the %q setting; it lists %v", key, keys)
	}
	if current != nil {
		return standDown, fmt.Sprintf("%q is already set to %#v on this gateway and this test did not set it, "+
			"so it is neither overwritten nor unset", key, current)
	}
	return proceed, ""
}

// TestGlobalSettings covers the Settings page: reading the gateway's settings
// and setting and deleting one. All three go through GetGatewayConfig and
// UpdateConfig with global=true.
//
// The settings belong to the whole gateway, so the test writes only what it
// can take back: a key that reads as unset, on a gateway whose sandboxes are
// all this run's own. See "What the suite does to the gateway" in the package
// comment.
func TestGlobalSettings(t *testing.T) {
	const path = "/api/v1/settings/global"

	read := func(t *testing.T) gatewaySettings {
		t.Helper()
		var s gatewaySettings
		mustJSON(t, http.MethodGet, path, nil, &s, http.StatusOK)
		return s
	}
	// unsetIfStill removes key only while it still holds what this test wrote.
	// It is the cleanup for a test that stopped halfway, and it must not take
	// away a value somebody else has put there since.
	unsetIfStill := func(key string, wrote any) {
		var now gatewaySettings
		if status, err := doJSON(http.MethodGet, path, nil, &now); err != nil || status != http.StatusOK {
			return
		}
		if got, _ := now.lookup(key); got == wrote {
			_, _, _ = do(http.MethodDelete, path+"?key="+key, nil)
		}
	}

	// The gateway only accepts the keys it knows and validates each value, so
	// the test has to write a real one. This key takes "manual" or "auto" (the
	// gateway says so when given anything else), and "manual" is also what the
	// gateway does while the key is unset.
	const key, value = "proposal_approval_mode", "manual"

	before := read(t)
	mayWrite, why := settingWriteVerdict(before, key)
	if mayWrite == broken {
		t.Fatalf("GET %s [gateway %s]: %s", path, gatewayVersion, why)
	}
	for _, e := range before.Settings {
		if e.Key == "" {
			t.Errorf("GET %s [gateway %s]: a setting has no key: %+v", path, gatewayVersion, before.Settings)
		}
	}
	others := sharedWithOthers(t)

	wrote := false
	t.Cleanup(func() {
		if wrote {
			unsetIfStill(key, value)
		}
	})

	t.Run("set", func(t *testing.T) {
		if mayWrite == standDown {
			t.Skipf("not writing %s [gateway %s]: %s", key, gatewayVersion, why)
		}
		if others != "" {
			t.Skipf("not writing %s: %s", key, others)
		}
		// Before the request, not after: a PUT that fails on the way back may
		// still have been applied.
		wrote = true
		var res struct {
			Updated bool `json:"updated"`
		}
		mustJSON(t, http.MethodPut, path, map[string]any{"key": key, "value": value}, &res, http.StatusOK)
		if !res.Updated {
			t.Error("updated = false, want true")
		}
		after := read(t)
		if got, _ := after.lookup(key); got != value {
			t.Errorf("%s reads back as %#v, want %q", key, got, value)
		}
		if after.SettingsRevision <= before.SettingsRevision {
			t.Errorf("settingsRevision = %d after a write, want more than %d", after.SettingsRevision, before.SettingsRevision)
		}
	})

	t.Run("delete", func(t *testing.T) {
		if !wrote {
			t.Skipf("not deleting %s: this test did not set it", key)
		}
		var res struct {
			Deleted bool `json:"deleted"`
		}
		mustJSON(t, http.MethodDelete, path+"?key="+key, nil, &res, http.StatusOK)
		if !res.Deleted {
			t.Error("deleted = false, want true")
		}
		if got, _ := read(t).lookup(key); got != nil {
			t.Errorf("%s reads back as %#v after being deleted, want it listed without a value", key, got)
		}
	})

	// The gateway refuses this one, so it changes nothing and needs no guard.
	t.Run("unknown key is a 400", func(t *testing.T) {
		wantError(t, http.MethodPut, path, map[string]any{"key": "compat_no_such_setting", "value": "x"},
			http.StatusBadRequest, "invalid_argument")
	})

	// The gateway's settings are typed and it refuses a value of another type
	// ("setting 'ocsf_json_enabled' expects bool value"), so a bool is sent as
	// a JSON boolean and comes back as one. Two of the four settings gateways
	// 0.1.0 to 0.1.2 register are bools.
	t.Run("bool setting", func(t *testing.T) {
		// false is what the gateway does while this key is unset, too.
		const boolKey, boolValue = "ocsf_json_enabled", false
		if v, why := settingWriteVerdict(before, boolKey); v != proceed {
			t.Skipf("not writing %s [gateway %s]: %s", boolKey, gatewayVersion, why)
		}
		if others != "" {
			t.Skipf("not writing %s: %s", boolKey, others)
		}
		t.Cleanup(func() { unsetIfStill(boolKey, boolValue) })
		status, raw, err := do(http.MethodPut, path, map[string]any{"key": boolKey, "value": boolValue})
		if err != nil {
			t.Fatalf("PUT %s: %v", path, err)
		}
		if status != http.StatusOK {
			t.Fatalf("PUT %s {key: %q, value: %v} [gateway %s]: status = %d, want 200; body: %s",
				path, boolKey, boolValue, gatewayVersion, status, truncate(raw))
		}
		if got, _ := read(t).lookup(boolKey); got != boolValue {
			t.Errorf("%s reads back as %#v, want the bool %v", boolKey, got, boolValue)
		}
	})
}
