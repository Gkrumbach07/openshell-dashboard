//go:build compat

package compat

import (
	"fmt"
	"net/http"
	"strings"
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

// TestGatewayInfoExtensions covers the Extensions card of the Gateway page:
// what `openshell gateway info` lists under "Extensions".
//
// A gateway negotiates with every compute driver it initializes and reports
// the outcome as an extension, so a gateway that lists a compute driver lists
// at least that many extensions, one of them of the compute-driver kind.
func TestGatewayInfoExtensions(t *testing.T) {
	raw := mustRaw(t, http.MethodGet, "/api/v1/gateway", nil, http.StatusOK)
	var info struct {
		ComputeDrivers []struct {
			Name string `json:"name"`
		} `json:"computeDrivers"`
		Extensions []struct {
			ProtocolMajor         *uint32  `json:"protocolMajor"`
			ProtocolMinor         *uint32  `json:"protocolMinor"`
			Kind                  string   `json:"kind"`
			ConfiguredName        string   `json:"configuredName"`
			ImplementationName    string   `json:"implementationName"`
			ImplementationVersion string   `json:"implementationVersion"`
			SupportedCapabilities []string `json:"supportedCapabilities"`
			RequiredCapabilities  []string `json:"requiredCapabilities"`
		} `json:"extensions"`
	}
	mustDecode(t, raw, &info)

	if info.Extensions == nil {
		t.Fatalf("extensions is missing or null — the Gateway page maps over it; body: %s", truncate(raw))
	}
	if len(info.Extensions) < len(info.ComputeDrivers) || len(info.Extensions) == 0 {
		t.Fatalf("gateway lists %d compute driver(s) and %d extension(s), want an extension for every driver; body: %s",
			len(info.ComputeDrivers), len(info.Extensions), truncate(raw))
	}

	// The kinds this SDK can name. UNSPECIFIED means the gateway sent one it
	// cannot: a new extension family, and a row the page cannot label.
	known := map[string]bool{
		"COMPUTE_DRIVER": true, "CREDENTIAL_DRIVER": true, "GATEWAY_INTERCEPTOR": true, "SUPERVISOR_MIDDLEWARE": true,
	}
	negotiatedDrivers := map[string]bool{}
	for _, extension := range info.Extensions {
		t.Logf("extension: kind=%s configuredName=%s implementation=%s %s capabilities=%v requires=%v",
			extension.Kind, extension.ConfiguredName, extension.ImplementationName, extension.ImplementationVersion,
			extension.SupportedCapabilities, extension.RequiredCapabilities)
		if !known[extension.Kind] {
			t.Errorf("extension %q has kind %q, want one of the four the SDK names", extension.ConfiguredName, extension.Kind)
		}
		if extension.ConfiguredName == "" {
			t.Errorf("an extension of kind %s has no configuredName, which is what the page lists it under", extension.Kind)
		}
		if extension.ProtocolMajor == nil || extension.ProtocolMinor == nil {
			t.Errorf("extension %q has no protocolMajor/protocolMinor — the page shows them as the protocol version",
				extension.ConfiguredName)
		}
		if extension.Kind == "COMPUTE_DRIVER" {
			negotiatedDrivers[extension.ConfiguredName] = true
		}
	}
	// A compute driver is registered under one name, and that name is both
	// its entry in computeDrivers and the configured name it negotiated under.
	for _, driver := range info.ComputeDrivers {
		if !negotiatedDrivers[driver.Name] {
			t.Errorf("compute driver %q has no extension of kind COMPUTE_DRIVER configured under that name; extensions: %s",
				driver.Name, truncate(raw))
		}
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

	// Two of the four settings take a fixed set of strings, and the API does
	// not say which: the CLI and TUI compile the list in, the dashboard does
	// not. The gateway's refusal is therefore how a user of the Settings page
	// learns the allowed values, so its message has to arrive as the gateway
	// wrote it. Refused, so it changes nothing and needs no guard.
	t.Run("a value outside the allowed set is refused with the set", func(t *testing.T) {
		const badValue = "compat-not-a-mode"
		status, raw, err := do(http.MethodPut, path, map[string]any{"key": key, "value": badValue})
		if err != nil {
			t.Fatalf("PUT %s: %v", path, err)
		}
		checkError(t, "PUT "+path, status, raw, http.StatusBadRequest, "invalid_argument")
		var refusal apiError
		mustDecode(t, raw, &refusal)
		t.Logf("PUT %s {key: %q, value: %q} [gateway %s] -> %s", path, key, badValue, gatewayVersion, truncate(raw))
		for _, part := range []string{key, badValue, "manual", "auto"} {
			if !strings.Contains(refusal.Message, part) {
				t.Errorf("the refusal %q does not mention %q — it is the only place the Settings page can "+
					"show which values %s takes", refusal.Message, part, key)
			}
		}
		if got, _ := read(t).lookup(key); got == badValue {
			t.Errorf("%s reads back as the refused value %q", key, badValue)
		}
	})
}

// TestDeleteUnsetGlobalSetting covers what the Settings page says after a
// delete: "deleted", or "was not set". The answer is the gateway's own
// (UpdateConfigResponse.deleted), and the half a mock cannot vouch for is the
// "was not set" one: a BFF that answered deleted=true regardless would pass
// every test that sets a key first.
//
// It asks the gateway to delete a setting that reads as unset, which removes
// nothing: the gateway finds no value, saves nothing and leaves the settings
// revision alone. It stands down when every candidate key is set, and then
// touches none of them. It also stands down on a gateway it shares: there
// somebody else can set the key between the read and the delete, and the
// delete would remove a value this test has no way to put back.
func TestDeleteUnsetGlobalSetting(t *testing.T) {
	const path = "/api/v1/settings/global"

	if why := sharedWithOthers(t); why != "" {
		t.Skip(why)
	}

	var before gatewaySettings
	mustJSON(t, http.MethodGet, path, nil, &before, http.StatusOK)

	// Any registered setting will do. The two no other test in this suite
	// writes come first.
	key, reasons := "", []string{}
	for _, candidate := range []string{
		"ocsf_schema_version", "agent_policy_proposals_enabled", "ocsf_json_enabled", "proposal_approval_mode",
	} {
		v, why := settingWriteVerdict(before, candidate)
		if v == broken {
			t.Fatalf("GET %s [gateway %s]: %s", path, gatewayVersion, why)
		}
		if v == proceed {
			key = candidate
			break
		}
		reasons = append(reasons, why)
	}
	if key == "" {
		t.Skipf("no setting on gateway %s reads as unset, so there is none to delete without removing a "+
			"value: %s", gatewayVersion, strings.Join(reasons, "; "))
	}

	raw := mustRaw(t, http.MethodDelete, path+"?key="+key, nil, http.StatusOK)
	t.Logf("DELETE %s?key=%s (unset) [gateway %s] -> %s", path, key, gatewayVersion, truncate(raw))
	var res struct {
		Deleted          *bool   `json:"deleted"`
		SettingsRevision *uint64 `json:"settingsRevision"`
	}
	mustDecode(t, raw, &res)
	if res.Deleted == nil {
		t.Fatalf("DELETE %s?key=%s [gateway %s] has no deleted field; body: %s", path, key, gatewayVersion, truncate(raw))
	}
	if *res.Deleted {
		t.Errorf("DELETE %s?key=%s [gateway %s]: deleted = true for a setting that had no value — the "+
			"gateway's answer was not passed on, and the page would report a delete that did not happen",
			path, key, gatewayVersion)
	}

	var after gatewaySettings
	mustJSON(t, http.MethodGet, path, nil, &after, http.StatusOK)
	if got, listed := after.lookup(key); !listed || got != nil {
		t.Errorf("%s reads back as %#v (listed: %v) after the delete, want it still listed without a value",
			key, got, listed)
	}
	// The answer carries the global settings revision. Nothing was removed,
	// so it has not moved because of this request; on a gateway this run
	// shares, somebody else may have moved it in the meantime.
	if res.SettingsRevision == nil {
		t.Fatalf("DELETE %s?key=%s [gateway %s] has no settingsRevision; body: %s", path, key, gatewayVersion, truncate(raw))
	}
	if *res.SettingsRevision < before.SettingsRevision || *res.SettingsRevision > after.SettingsRevision {
		t.Errorf("settingsRevision = %d in the answer, want it between the %d read before and the %d read after",
			*res.SettingsRevision, before.SettingsRevision, after.SettingsRevision)
	}
	if *res.SettingsRevision != before.SettingsRevision {
		t.Errorf("settingsRevision went from %d to %d for a delete that removed nothing",
			before.SettingsRevision, *res.SettingsRevision)
	}
}
