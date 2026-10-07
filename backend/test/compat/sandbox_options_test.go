//go:build compat

package compat

import (
	"encoding/json"
	"fmt"
	"net/http"
	"reflect"
	"strings"
	"testing"
)

// activeComputeDriver returns the name of the gateway's compute driver, which
// is also the key the gateway reads a driver config under: a config keyed by
// any other name is ignored, not judged.
func activeComputeDriver(t *testing.T) string {
	t.Helper()
	var info struct {
		ComputeDrivers []struct {
			Name string `json:"name"`
		} `json:"computeDrivers"`
	}
	mustJSON(t, http.MethodGet, "/api/v1/gateway", nil, &info, http.StatusOK)
	if len(info.ComputeDrivers) == 0 || info.ComputeDrivers[0].Name == "" {
		t.Fatalf("[gateway %s] the gateway names no compute driver to key a driver config by", gatewayVersion)
	}
	return info.ComputeDrivers[0].Name
}

// wantNoSandbox reports a failure when a sandbox exists that a refused create
// must not have left behind, and removes it so the next test is not affected.
func wantNoSandbox(t *testing.T, workspace, name, why string) {
	t.Helper()
	status, _, err := do(http.MethodGet, sandboxPath(workspace, name), nil)
	if err != nil {
		t.Fatalf("GET %s [gateway %s]: %v", sandboxPath(workspace, name), gatewayVersion, err)
	}
	if status != http.StatusNotFound {
		t.Errorf("sandbox %s/%s answers %d after %s, want 404 — the refused create left a sandbox behind [gateway %s]",
			workspace, name, status, why, gatewayVersion)
		_, _, _ = do(http.MethodDelete, sandboxPath(workspace, name), nil)
	}
}

// TestSandboxCreateCommandAndServices covers the options of the create form
// that reach the gateway in fields no other test sends: the sandbox's main
// command and whether it gets a terminal (SandboxSpec.command and tty), and
// the services exposed with the sandbox (CreateSandboxRequest.service_exposures),
// together with the environment and the annotations the form now also sends.
//
// It runs in a workspace of its own, and it reads every option back: a field
// the gateway does not know is dropped without an error, and only a read can
// tell that from a field that was stored.
func TestSandboxCreateCommandAndServices(t *testing.T) {
	requireSandboxes(t)
	ws := newWorkspace(t)
	name := randName("op")
	named := randName("sv")
	// No shell parses the command, so the shell is named. `sleep infinity`
	// keeps the main process, and with it the sandbox, alive.
	command := []string{"sh", "-c", "exec sleep infinity"}

	created := createSandbox(t, ws, name, map[string]any{
		"command":     command,
		"tty":         false,
		"environment": map[string]string{"COMPAT_OPTION": "set"},
		"annotations": map[string]string{"compat/purpose": "create options"},
		"serviceExposures": []map[string]any{
			{"targetPort": 8000},
			{"service": named, "targetPort": 8001},
		},
	})

	check := func(t *testing.T, what string, sb sandbox) {
		t.Helper()
		if !reflect.DeepEqual(sb.Spec.Command, command) {
			t.Errorf("%s: spec.command = %q, want %q", what, sb.Spec.Command, command)
		}
		if sb.Spec.TTY {
			t.Errorf("%s: spec.tty = true for a sandbox created with a command and tty false", what)
		}
		if got := sb.Spec.Environment["COMPAT_OPTION"]; got != "set" {
			t.Errorf("%s: environment COMPAT_OPTION = %q, want %q; environment: %v", what, got, "set", sb.Spec.Environment)
		}
		// The gateway adds annotations of its own; only ours is asserted.
		if got := sb.Metadata.Annotations["compat/purpose"]; got != "create options" {
			t.Errorf("%s: annotation compat/purpose = %q, want %q", what, got, "create options")
		}
		if sb.Metadata.Workspace != ws {
			t.Errorf("%s: metadata.workspace = %q, want %q", what, sb.Metadata.Workspace, ws)
		}
	}

	t.Run("create answers with the options", func(t *testing.T) {
		check(t, "create", created)
		// Keyed by service name, with "" for the unnamed service, which is the
		// one `openshell sandbox create --expose <port>` registers.
		for _, service := range []string{"", named} {
			if created.ServiceURLs[service] == "" {
				t.Errorf("serviceUrls has no URL for service %q: %v — the create form shows these as the links to open",
					service, created.ServiceURLs)
			}
		}
		if len(created.ServiceURLs) != 2 {
			t.Errorf("serviceUrls = %v, want exactly the two services asked for", created.ServiceURLs)
		}
	})

	t.Run("options are read back", func(t *testing.T) {
		check(t, "get", getSandbox(t, ws, name))
	})

	t.Run("exposed services are listed", func(t *testing.T) {
		var endpoints []serviceEndpoint
		mustJSON(t, http.MethodGet, sandboxPath(ws, name)+"/services", nil, &endpoints, http.StatusOK)
		ports := map[string]uint32{}
		for _, e := range endpoints {
			if e.SandboxName != name {
				t.Errorf("endpoint %q belongs to sandbox %q, want %q", e.ServiceName, e.SandboxName, name)
			}
			ports[e.ServiceName] = e.TargetPort
		}
		if want := map[string]uint32{"": 8000, named: 8001}; !reflect.DeepEqual(ports, want) {
			t.Errorf("service endpoints = %v, want %v", ports, want)
		}
	})

	// A command the gateway stored has to be one it can also run.
	t.Run("reaches READY", func(t *testing.T) {
		waitForPhase(t, ws, name, "READY")
	})

	// The gateway judges the exposures before it creates anything, and its
	// refusal is passed on. A request that was not judged at all would create
	// the sandbox.
	t.Run("a service name used twice is the gateway's 400", func(t *testing.T) {
		refused := randName("op")
		wantError(t, http.MethodPost, sandboxesPath(ws), map[string]any{
			"name":   refused,
			"image":  sandboxImage(),
			"policy": basePolicy(),
			"serviceExposures": []map[string]any{
				{"service": named, "targetPort": 8000},
				{"service": named, "targetPort": 8001},
			},
		}, http.StatusBadRequest, "invalid_argument")
		wantNoSandbox(t, ws, refused, "a create with a duplicate service name")
	})
}

// TestSandboxDefaultCommand pins what the create form says about a sandbox
// created without a command: it runs its image's login shell, and the gateway
// gives that shell a terminal whatever the request said. The form offers the
// terminal option only beside a command for that reason.
func TestSandboxDefaultCommand(t *testing.T) {
	ws, name := sharedSandbox(t)
	sb := getSandbox(t, ws, name)
	if len(sb.Spec.Command) != 0 {
		t.Errorf("spec.command = %q for a sandbox created without one, want none", sb.Spec.Command)
	}
	if !sb.Spec.TTY {
		t.Errorf("spec.tty = false for a sandbox created without a command — gateway %s no longer gives the "+
			"default login shell a terminal, and the create form says it does", gatewayVersion)
	}
}

// TestRuntimeClassReachesTheDriver covers the runtime class of the create form
// (SandboxTemplate.runtime_class_name). The gateway hands it to the compute
// driver as platform config, which the Kubernetes driver reads and the Docker
// driver, the one the compat stack runs, refuses outright. So on this stack
// the refusal is the proof that the field crossed the wire: a field the
// gateway never saw would create the sandbox instead.
func TestRuntimeClassReachesTheDriver(t *testing.T) {
	if driver := activeComputeDriver(t); driver != "docker" {
		t.Skipf("gateway %s runs the %s compute driver: only the Docker driver is known to refuse a runtime class, "+
			"and a driver that accepts one would boot a sandbox with a runtime this stack may not have",
			gatewayVersion, driver)
	}
	ws := newWorkspace(t)
	name := randName("rc")
	t.Cleanup(func() { _, _, _ = do(http.MethodDelete, sandboxPath(ws, name), nil) })

	status, raw, err := do(http.MethodPost, sandboxesPath(ws), map[string]any{
		"name":             name,
		"image":            sandboxImage(),
		"policy":           basePolicy(),
		"runtimeClassName": "compat-runtime",
	})
	if err != nil {
		t.Fatalf("POST %s [gateway %s]: %v", sandboxesPath(ws), gatewayVersion, err)
	}
	var env apiError
	_ = json.Unmarshal(raw, &env)
	if status != http.StatusConflict || env.Code != "conflict" || !strings.Contains(env.Message, "platform_config") {
		t.Errorf("create with a runtime class on the Docker driver [gateway %s]: status = %d code = %q message = %q; "+
			"want 409 conflict naming platform_config, which is where the gateway puts the runtime class for the driver",
			gatewayVersion, status, env.Code, env.Message)
	}
	wantNoSandbox(t, ws, name, "a create with a runtime class")
}

// refusedDriverConfig reports a failure unless the call was refused because
// driver configs are disabled on the gateway, in the gateway's own words.
//
// The compat stack's gateway does not enable allow_driver_config, so a driver
// config that reaches it is refused, and that refusal is the proof that the
// field crossed the wire: a field the gateway never saw would create the
// resource instead. A gateway that has it enabled fails this test, and should.
func refusedDriverConfig(t *testing.T, method, path string, body map[string]any) {
	t.Helper()
	status, raw, err := do(method, path, body)
	if err != nil {
		t.Fatalf("%s %s [gateway %s]: %v", method, path, gatewayVersion, err)
	}
	var env apiError
	_ = json.Unmarshal(raw, &env)
	if status != http.StatusConflict || env.Code != "conflict" || !strings.Contains(env.Message, "allow_driver_config") {
		t.Errorf("%s %s with a driver config [gateway %s]: status = %d code = %q message = %q; want 409 conflict "+
			"naming allow_driver_config, which is how a gateway that has not enabled driver configs refuses one",
			method, path, gatewayVersion, status, env.Code, env.Message)
	}
}

// TestDriverConfigIsRefusedUnlessEnabled covers the driver config of the
// create-sandbox and create-template forms. Both travel as a free-form struct
// keyed by compute driver name, and the gateway's administrator has to allow
// them, which the compat stack's has not.
func TestDriverConfigIsRefusedUnlessEnabled(t *testing.T) {
	ws := newWorkspace(t)
	driverConfig := map[string]any{activeComputeDriver(t): map[string]any{"compat_probe": "set"}}

	t.Run("on a sandbox", func(t *testing.T) {
		name := randName("dc")
		t.Cleanup(func() { _, _, _ = do(http.MethodDelete, sandboxPath(ws, name), nil) })
		refusedDriverConfig(t, http.MethodPost, sandboxesPath(ws), map[string]any{
			"name":         name,
			"image":        sandboxImage(),
			"policy":       basePolicy(),
			"driverConfig": driverConfig,
		})
		wantNoSandbox(t, ws, name, "a create with a driver config")
	})

	t.Run("on a template", func(t *testing.T) {
		name := randName("dc")
		path := "/api/v1/workspaces/" + ws + "/templates"
		t.Cleanup(func() { _, _, _ = do(http.MethodDelete, path+"/"+name, nil) })
		refusedDriverConfig(t, http.MethodPost, path, map[string]any{
			"name": name,
			"spec": map[string]any{
				"workload":     map[string]any{"image": sandboxImage()},
				"driverConfig": driverConfig,
			},
		})
		wantError(t, http.MethodGet, path+"/"+name, nil, http.StatusNotFound, "not_found")
	})
}

// sandboxSettingEntry mirrors models.SandboxSettingEntry. Value is nil for a
// setting that is listed without one.
type sandboxSettingEntry struct {
	Value any    `json:"value"`
	Key   string `json:"key"`
	Scope string `json:"scope"`
}

// sandboxSettings mirrors models.SandboxSettings.
type sandboxSettings struct {
	PolicySource   string                `json:"policySource"`
	PolicyHash     string                `json:"policyHash"`
	ConfigRevision string                `json:"configRevision"`
	Settings       []sandboxSettingEntry `json:"settings"`
	PolicyVersion  uint32                `json:"policyVersion"`
}

// lookup returns the entry for key, and false when key is not listed.
func (s sandboxSettings) lookup(key string) (sandboxSettingEntry, bool) {
	for _, e := range s.Settings {
		if e.Key == key {
			return e, true
		}
	}
	return sandboxSettingEntry{}, false
}

func sandboxSettingsPath(workspace, name string) string {
	return sandboxPath(workspace, name) + "/settings"
}

func readSandboxSettings(t *testing.T, workspace, name string) sandboxSettings {
	t.Helper()
	var s sandboxSettings
	mustJSON(t, http.MethodGet, sandboxSettingsPath(workspace, name), nil, &s, http.StatusOK)
	return s
}

// settingResult mirrors models.SettingSetResult and models.SettingDeleteResult.
type settingResult struct {
	SettingsRevision uint64 `json:"settingsRevision"`
	Updated          bool   `json:"updated"`
	Deleted          bool   `json:"deleted"`
}

// TestSandboxSettings covers the Settings tab of a sandbox: the settings in
// effect for it with the scope each one comes from, and setting and deleting
// one on the sandbox itself. The read is GetSandboxConfig and both writes are
// UpdateConfig naming the sandbox, in a workspace other than "default".
//
// It writes to the shared sandbox and takes back what it wrote. The key it
// uses takes "manual" or "auto"; "manual" is what the gateway does while the
// key is unset, so "auto" is the value that shows the write was stored.
func TestSandboxSettings(t *testing.T) {
	ws, name := sharedSandbox(t)
	path := sandboxSettingsPath(ws, name)
	const key, value = "proposal_approval_mode", "auto"

	before := readSandboxSettings(t, ws, name)
	current, listed := before.lookup(key)

	t.Run("read", func(t *testing.T) {
		// Gateways 0.1.0 to 0.1.2 list every setting they know, set or not, so
		// an empty list means the settings map no longer decodes.
		if len(before.Settings) == 0 {
			t.Fatalf("GET %s [gateway %s]: no settings listed — the gateway lists every setting it knows, so the "+
				"Settings tab would be blank", path, gatewayVersion)
		}
		for _, e := range before.Settings {
			switch e.Scope {
			case "SANDBOX", "GLOBAL":
				if e.Value == nil {
					t.Errorf("setting %q has scope %s and no value", e.Key, e.Scope)
				}
			case "UNSPECIFIED":
				if e.Value != nil {
					t.Errorf("setting %q has value %#v and no scope it comes from", e.Key, e.Value)
				}
			default:
				t.Errorf("setting %q has scope %q, want SANDBOX, GLOBAL or UNSPECIFIED", e.Key, e.Scope)
			}
		}
		if !listed {
			t.Errorf("GET %s [gateway %s]: %q is not listed", path, gatewayVersion, key)
		}
		// The CLI prints this as "Policy Source". A sandbox created with a
		// policy of its own runs it unless a global policy is in force.
		if before.PolicySource != "SANDBOX" && before.PolicySource != "GLOBAL" {
			t.Errorf("policySource = %q, want SANDBOX or GLOBAL", before.PolicySource)
		}
		if before.PolicyHash == "" || before.ConfigRevision == "" {
			t.Errorf("policyHash = %q, configRevision = %q; want both reported", before.PolicyHash, before.ConfigRevision)
		}
	})

	// Scope GLOBAL means somebody set the key on the gateway, where it
	// overrides the sandbox and blocks the writes below. Scope SANDBOX on a
	// sandbox this process created minutes ago means an earlier run of this
	// very test did not clean up, which is this test's to report.
	mayWrite := listed && current.Scope == "UNSPECIFIED"
	whyNot := fmt.Sprintf("%q reads as %#v with scope %s on gateway %s before this test wrote anything",
		key, current.Value, current.Scope, gatewayVersion)

	wrote := false
	t.Cleanup(func() {
		if wrote {
			_, _, _ = do(http.MethodDelete, path+"?key="+key, nil)
		}
	})

	t.Run("set", func(t *testing.T) {
		if !mayWrite {
			t.Skipf("not writing: %s", whyNot)
		}
		// Before the request, not after: a PUT that fails on the way back may
		// still have been applied.
		wrote = true
		var res settingResult
		mustJSON(t, http.MethodPut, path, map[string]any{"key": key, "value": value}, &res, http.StatusOK)
		if !res.Updated {
			t.Error("updated = false, want true")
		}
		after := readSandboxSettings(t, ws, name)
		got, _ := after.lookup(key)
		if got.Value != value || got.Scope != "SANDBOX" {
			t.Errorf("%s reads back as %#v with scope %s, want %q with scope SANDBOX", key, got.Value, got.Scope, value)
		}
		if after.ConfigRevision == before.ConfigRevision {
			t.Errorf("configRevision is still %s after a setting changed — it is the fingerprint of the sandbox's "+
				"effective configuration, which just changed", after.ConfigRevision)
		}
	})

	// A sandbox setting belongs to one sandbox: it must not show up in the
	// gateway's own settings, which every sandbox inherits.
	t.Run("the gateway's settings are untouched", func(t *testing.T) {
		if !wrote {
			t.Skipf("nothing was written: %s", whyNot)
		}
		var global gatewaySettings
		mustJSON(t, http.MethodGet, "/api/v1/settings/global", nil, &global, http.StatusOK)
		if got, _ := global.lookup(key); got == value {
			t.Errorf("the gateway's %s is %q after a write to one sandbox — the sandbox scope was not honored", key, value)
		}
	})

	t.Run("delete", func(t *testing.T) {
		if !wrote {
			t.Skipf("nothing was written: %s", whyNot)
		}
		var res settingResult
		mustJSON(t, http.MethodDelete, path+"?key="+key, nil, &res, http.StatusOK)
		if !res.Deleted {
			t.Error("deleted = false after deleting a setting that was set, want true")
		}
		got, _ := readSandboxSettings(t, ws, name).lookup(key)
		if got.Value != nil || got.Scope != "UNSPECIFIED" {
			t.Errorf("%s reads back as %#v with scope %s after being deleted, want no value and scope UNSPECIFIED",
				key, got.Value, got.Scope)
		}
	})

	// Deleting what is not set is not an error. The gateway says that nothing
	// was deleted, and the answer is passed on.
	t.Run("deleting an unset setting reports deleted false", func(t *testing.T) {
		if !mayWrite {
			t.Skipf("not writing: %s", whyNot)
		}
		var res settingResult
		mustJSON(t, http.MethodDelete, path+"?key="+key, nil, &res, http.StatusOK)
		if res.Deleted {
			t.Error("deleted = true for a setting that was not set on the sandbox, want false")
		}
	})

	// The gateway refuses these, so they change nothing and need no guard.
	t.Run("unknown key is a 400", func(t *testing.T) {
		wantError(t, http.MethodPut, path, map[string]any{"key": "compat_no_such_setting", "value": "x"},
			http.StatusBadRequest, "invalid_argument")
	})
	t.Run("a value of the wrong type is a 400", func(t *testing.T) {
		if !mayWrite {
			t.Skipf("not writing: %s", whyNot)
		}
		wantError(t, http.MethodPut, path, map[string]any{"key": key, "value": true},
			http.StatusBadRequest, "invalid_argument")
	})
	t.Run("unknown sandbox is a 404", func(t *testing.T) {
		wantError(t, http.MethodGet, sandboxSettingsPath(ws, "no-such-sandbox"), nil, http.StatusNotFound, "not_found")
	})
}

// TestSandboxSettingManagedGlobally covers the rule the Settings tab is built
// on: a setting that is set on the gateway is in effect for every sandbox, is
// reported to each of them with scope GLOBAL, and cannot be set or deleted on
// a sandbox until the global setting is removed. The tab offers no edit for
// such a row, and this is the test that the gateway would have refused one.
//
// It sets a gateway-global setting, so it follows TestGlobalSettings' rules:
// it writes only a key that reads as unset, the value the gateway uses anyway,
// on a gateway whose sandboxes are all this run's own, and removes it again.
func TestSandboxSettingManagedGlobally(t *testing.T) {
	ws, name := sharedSandbox(t)
	path := sandboxSettingsPath(ws, name)
	const globalPath = "/api/v1/settings/global"
	const key, value = "proposal_approval_mode", "manual"

	var before gatewaySettings
	mustJSON(t, http.MethodGet, globalPath, nil, &before, http.StatusOK)
	switch mayWrite, why := settingWriteVerdict(before, key); mayWrite {
	case broken:
		t.Fatalf("GET %s [gateway %s]: %s", globalPath, gatewayVersion, why)
	case standDown:
		t.Skipf("not writing %s [gateway %s]: %s", key, gatewayVersion, why)
	}
	if others := sharedWithOthers(t); others != "" {
		t.Skipf("not writing %s: %s", key, others)
	}
	if got, _ := readSandboxSettings(t, ws, name).lookup(key); got.Scope != "UNSPECIFIED" {
		t.Skipf("not writing %s: it reads as %#v with scope %s on the sandbox already", key, got.Value, got.Scope)
	}

	// Removes the global setting only while it still holds what this test
	// wrote, so that a value somebody set since is left alone.
	t.Cleanup(func() {
		var now gatewaySettings
		if status, err := doJSON(http.MethodGet, globalPath, nil, &now); err != nil || status != http.StatusOK {
			return
		}
		if got, _ := now.lookup(key); got == value {
			_, _, _ = do(http.MethodDelete, globalPath+"?key="+key, nil)
		}
	})
	mustJSON(t, http.MethodPut, globalPath, map[string]any{"key": key, "value": value}, nil, http.StatusOK)

	t.Run("the sandbox reports the global value", func(t *testing.T) {
		got, _ := readSandboxSettings(t, ws, name).lookup(key)
		if got.Value != value || got.Scope != "GLOBAL" {
			t.Errorf("%s reads as %#v with scope %s on the sandbox, want %q with scope GLOBAL", key, got.Value, got.Scope, value)
		}
	})

	refused := func(t *testing.T, method, target string, body any) {
		t.Helper()
		status, raw, err := do(method, target, body)
		if err != nil {
			t.Fatalf("%s %s [gateway %s]: %v", method, target, gatewayVersion, err)
		}
		var env apiError
		_ = json.Unmarshal(raw, &env)
		if status != http.StatusConflict || env.Code != "conflict" || !strings.Contains(env.Message, "managed globally") {
			t.Errorf("%s %s [gateway %s]: status = %d code = %q message = %q; want 409 conflict saying the setting "+
				"is managed globally, which is the sentence the Settings tab shows", method, target, gatewayVersion,
				status, env.Code, env.Message)
		}
	}
	t.Run("setting it on the sandbox is refused", func(t *testing.T) {
		refused(t, http.MethodPut, path, map[string]any{"key": key, "value": "auto"})
	})
	t.Run("deleting it on the sandbox is refused", func(t *testing.T) {
		refused(t, http.MethodDelete, path+"?key="+key, nil)
	})
	t.Run("the refused writes changed nothing", func(t *testing.T) {
		got, _ := readSandboxSettings(t, ws, name).lookup(key)
		if got.Value != value || got.Scope != "GLOBAL" {
			t.Errorf("%s reads as %#v with scope %s after two refused writes, want %q with scope GLOBAL",
				key, got.Value, got.Scope, value)
		}
	})

	t.Run("removing the global setting hands the key back", func(t *testing.T) {
		mustJSON(t, http.MethodDelete, globalPath+"?key="+key, nil, nil, http.StatusOK)
		got, _ := readSandboxSettings(t, ws, name).lookup(key)
		if got.Value != nil || got.Scope != "UNSPECIFIED" {
			t.Errorf("%s reads as %#v with scope %s after the global setting was removed, want no value and "+
				"scope UNSPECIFIED", key, got.Value, got.Scope)
		}
	})
}
