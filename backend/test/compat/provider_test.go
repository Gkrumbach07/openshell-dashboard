//go:build compat

package compat

import (
	"bytes"
	"net/http"
	"testing"

	openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"
)

// providerProfile mirrors models.ProviderProfile.
type providerProfile struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName"`
	Category    string `json:"category"`
	Scope       string `json:"scope"`
	Credentials []struct {
		Name     string   `json:"name"`
		EnvVars  []string `json:"envVars"`
		Required bool     `json:"required"`
	} `json:"credentials"`
	ResourceVersion  uint64 `json:"resourceVersion"`
	InferenceCapable bool   `json:"inferenceCapable"`
}

// profileDiagnostic mirrors models.ProviderProfileDiagnostic.
type profileDiagnostic struct {
	ProfileID string `json:"profileId"`
	Field     string `json:"field"`
	Message   string `json:"message"`
	Severity  string `json:"severity"`
}

// provider mirrors models.Provider.
type provider struct {
	Config                map[string]string `json:"config"`
	CredentialExpiresAtMs map[string]int64  `json:"credentialExpiresAtMs"`
	Type                  string            `json:"type"`
	ProfileWorkspace      string            `json:"profileWorkspace"`
	CredentialNames       []string          `json:"credentialNames"`
	Metadata              objectMeta        `json:"metadata"`
}

func profilesPath(workspace string) string {
	return "/api/v1/workspaces/" + workspace + "/provider-profiles"
}

func providersPath(workspace string) string {
	return "/api/v1/workspaces/" + workspace + "/providers"
}

// providerBody is the create request the Add Provider form sends. It names the
// scope the chosen profile lives in — profileWorkspace is the workspace for a
// profile imported into it and empty for a platform profile — and carries each
// credential under the key the gateway stores it at.
func providerBody(profileWorkspace, name, profile string, credentials map[string]string) map[string]any {
	body := map[string]any{
		"name":        name,
		"type":        profile,
		"credentials": credentials,
	}
	if profileWorkspace != "" {
		body["profileWorkspace"] = profileWorkspace
	}
	return body
}

// profileBody is a profile the BFF's import endpoint can express and the
// gateway accepts: one required credential, named after the environment
// variable it is injected as, and no endpoints. Gateway 0.1.2 was seen to
// reject a profile that has both a credential and an endpoint, asking for
// fields the import body cannot carry (a header name, L7 inspection).
func profileBody(id, displayName string) map[string]any {
	return map[string]any{
		"id":               id,
		"displayName":      displayName,
		"description":      "created by backend/test/compat",
		"category":         "INFERENCE",
		"inferenceCapable": true,
		"credentials": []map[string]any{{
			"name":     profileCredentialKey,
			"envVars":  []string{profileCredentialKey},
			"required": true,
		}},
	}
}

// TestProviderProfiles covers the Profiles tab: linting, importing, reading,
// updating and deleting a custom provider profile in a workspace.
func TestProviderProfiles(t *testing.T) {
	ws := newWorkspace(t)
	id := randName("cpf")
	base := profilesPath(ws)
	t.Cleanup(func() {
		_, _, _ = do(http.MethodDelete, base+"/"+id, nil)
	})

	t.Run("lint", func(t *testing.T) {
		var ok struct {
			Diagnostics []profileDiagnostic `json:"diagnostics"`
			Valid       bool                `json:"valid"`
		}
		mustJSON(t, http.MethodPost, base+"/lint",
			map[string]any{"profiles": []any{profileBody(id, "Compat profile")}}, &ok, http.StatusOK)
		if !ok.Valid {
			t.Errorf("a well-formed profile lints as invalid: %+v", ok.Diagnostics)
		}

		// An id that is not lowercase kebab-case is something only the
		// gateway's linter knows to reject, so the diagnostic proves the
		// profile reached it and the finding came back field by field.
		var bad struct {
			Diagnostics []profileDiagnostic `json:"diagnostics"`
			Valid       bool                `json:"valid"`
		}
		mustJSON(t, http.MethodPost, base+"/lint",
			map[string]any{"profiles": []any{profileBody("Not_Kebab", "Compat profile")}}, &bad, http.StatusOK)
		if bad.Valid || len(bad.Diagnostics) == 0 {
			t.Fatalf("a profile with id Not_Kebab lints as valid=%v with %d diagnostics, want invalid with at least one",
				bad.Valid, len(bad.Diagnostics))
		}
		if d := bad.Diagnostics[0]; d.Field != "id" || d.Message == "" || d.Severity == "" || d.ProfileID != "Not_Kebab" {
			t.Errorf("diagnostic = %+v, want field \"id\" for profile Not_Kebab with a message and a severity", d)
		}
	})

	t.Run("import", func(t *testing.T) {
		var res struct {
			Diagnostics []profileDiagnostic `json:"diagnostics"`
			Profiles    []providerProfile   `json:"profiles"`
			Imported    bool                `json:"imported"`
		}
		mustJSON(t, http.MethodPost, base,
			map[string]any{"profiles": []any{profileBody(id, "Compat profile")}}, &res, http.StatusCreated)
		if !res.Imported || len(res.Profiles) != 1 || res.Profiles[0].ID != id {
			t.Fatalf("import result = imported %v, %d profiles, diagnostics %+v; want %q imported",
				res.Imported, len(res.Profiles), res.Diagnostics, id)
		}
	})

	t.Run("importing twice is refused", func(t *testing.T) {
		// The refusal is not an HTTP error: the modal reads `imported` and
		// renders the diagnostics.
		var res struct {
			Diagnostics []profileDiagnostic `json:"diagnostics"`
			Imported    bool                `json:"imported"`
		}
		mustJSON(t, http.MethodPost, base,
			map[string]any{"profiles": []any{profileBody(id, "Compat profile")}}, &res, http.StatusCreated)
		if res.Imported || len(res.Diagnostics) == 0 {
			t.Errorf("second import = imported %v with %d diagnostics, want it refused with a diagnostic",
				res.Imported, len(res.Diagnostics))
		}
	})

	var current providerProfile
	t.Run("get", func(t *testing.T) {
		mustJSON(t, http.MethodGet, base+"/"+id, nil, &current, http.StatusOK)
		if current.ID != id || current.DisplayName != "Compat profile" ||
			current.Category != "INFERENCE" || !current.InferenceCapable {
			t.Errorf("profile = %+v, want %q / Compat profile / INFERENCE / inference-capable", current, id)
		}
		if current.Scope != "workspace" {
			t.Errorf("scope = %q, want \"workspace\" for a profile imported into a workspace", current.Scope)
		}
		if len(current.Credentials) != 1 || current.Credentials[0].Name != profileCredentialKey ||
			!current.Credentials[0].Required || len(current.Credentials[0].EnvVars) != 1 {
			t.Errorf("credential schema = %+v, want one required credential %s — the Add Provider form is built from it",
				current.Credentials, profileCredentialKey)
		}
	})

	t.Run("appears in list", func(t *testing.T) {
		var list []providerProfile
		mustJSON(t, http.MethodGet, base, nil, &list, http.StatusOK)
		for _, p := range list {
			if p.ID == id {
				return
			}
		}
		t.Errorf("profile %q is not in the workspace's profile list of %d", id, len(list))
	})

	t.Run("update with a stale resource version is a conflict", func(t *testing.T) {
		wantError(t, http.MethodPut, base+"/"+id, map[string]any{
			"profile":                 profileBody(id, "Renamed"),
			"expectedResourceVersion": current.ResourceVersion + 7,
		}, http.StatusConflict, "conflict")
	})

	t.Run("update", func(t *testing.T) {
		var res struct {
			Profile *providerProfile `json:"profile"`
			Updated bool             `json:"updated"`
		}
		mustJSON(t, http.MethodPut, base+"/"+id, map[string]any{
			"profile":                 profileBody(id, "Renamed"),
			"expectedResourceVersion": current.ResourceVersion,
		}, &res, http.StatusOK)
		if !res.Updated || res.Profile == nil {
			t.Fatalf("update result = updated %v, profile %v", res.Updated, res.Profile)
		}
		if res.Profile.DisplayName != "Renamed" || res.Profile.ResourceVersion <= current.ResourceVersion {
			t.Errorf("updated profile = %q at resourceVersion %d, want \"Renamed\" at more than %d",
				res.Profile.DisplayName, res.Profile.ResourceVersion, current.ResourceVersion)
		}
	})

	var outcome string
	t.Run("delete", func(t *testing.T) {
		outcome = assertDeleted(t, http.MethodDelete, base+"/"+id)
	})

	t.Run("get after delete", func(t *testing.T) {
		if !establishesCompletion[outcome] {
			t.Skipf("delete outcome was %q, not a completion — skipping the 404 check", outcome)
		}
		wantError(t, http.MethodGet, base+"/"+id, nil, http.StatusNotFound, "not_found")
	})
}

// TestProviderFromWorkspaceProfile is the Add Provider flow for a custom
// profile: import the profile into the workspace, then create a provider of
// that type. It needs no direct gateway access.
//
// The gateway looks a provider's type up in the scope the provider names, and
// a provider that names none is looked up in the platform scope, where a
// profile imported into a workspace does not exist ("provider profile ... was
// not found in the requested scope"). So the request names the workspace, and
// the scope reading back is what shows the gateway took it rather than dropped
// it. TestProviderProfileScope covers an id that both scopes hold.
func TestProviderFromWorkspaceProfile(t *testing.T) {
	ws := newWorkspace(t)
	id := randName("cpf")
	name := randName("pv")
	t.Cleanup(func() {
		// Cleanups run last-in first-out: the provider goes before its profile.
		_, _, _ = do(http.MethodDelete, profilesPath(ws)+"/"+id, nil)
	})
	var imported struct {
		Imported bool `json:"imported"`
	}
	mustJSON(t, http.MethodPost, profilesPath(ws),
		map[string]any{"profiles": []any{profileBody(id, "Compat profile")}}, &imported, http.StatusCreated)
	if !imported.Imported {
		t.Fatalf("profile %q was not imported", id)
	}
	// The premise of the test: the profile lives in the workspace, not in the
	// platform scope. The import answer carries no scope; a read does.
	var offered providerProfile
	mustJSON(t, http.MethodGet, profilesPath(ws)+"/"+id, nil, &offered, http.StatusOK)
	if offered.Scope != "workspace" {
		t.Fatalf("imported profile %q has scope %q, want \"workspace\"", id, offered.Scope)
	}

	status, raw, err := do(http.MethodPost, providersPath(ws),
		providerBody(ws, name, id, map[string]string{profileCredentialKey: "s3cr3t-" + name}))
	if err != nil {
		t.Fatalf("create provider: %v", err)
	}
	t.Cleanup(func() {
		_, _, _ = do(http.MethodDelete, providersPath(ws)+"/"+name, nil)
	})
	if status != http.StatusCreated {
		t.Fatalf("create provider of workspace profile %q [gateway %s]: status = %d, want 201; body: %s",
			id, gatewayVersion, status, truncate(raw))
	}
	var created provider
	mustDecode(t, raw, &created)
	if created.Type != id || created.Metadata.Name != name {
		t.Errorf("created provider = %q of type %q, want %q of type %q", created.Metadata.Name, created.Type, name, id)
	}
	if created.ProfileWorkspace != ws {
		t.Errorf("created provider has profileWorkspace %q, want %q", created.ProfileWorkspace, ws)
	}

	var read provider
	mustJSON(t, http.MethodGet, providersPath(ws)+"/"+name, nil, &read, http.StatusOK)
	if read.ProfileWorkspace != ws {
		t.Errorf("provider reads back with profileWorkspace %q, want %q", read.ProfileWorkspace, ws)
	}
}

// TestProviderCredentialKeyedByEnvVar is the Add Provider and Edit Provider
// forms' requests for a profile whose credential has a name of its own and is
// injected under an environment variable with another name. That is how the
// profiles upstream publishes are written (providers/openai.yaml in
// NVIDIA/OpenShell at v0.1.0 and v0.1.2: `name: api_key`,
// `env_vars: [OPENAI_API_KEY]`).
//
// The gateway takes the variable as the key whenever a credential declares
// one and refuses the name ("provider credentials are not declared by
// profile"), on create and on update alike. The forms label each field with
// the credential's name and send its value under the variable.
func TestProviderCredentialKeyedByEnvVar(t *testing.T) {
	ws := newWorkspace(t)
	const credential, envVar = "api_key", "COMPAT_NAMED_API_KEY"
	const secret, rotated = "s3cr3t-keyed-by-env-var", "r0tated-keyed-by-env-var"
	profile := seedPlatformProfile(t, openshell.ProfileCredential{
		Name: credential, EnvVars: []string{envVar}, Required: true,
	})
	base := providersPath(ws)
	name := randName("pv")
	t.Cleanup(func() {
		_, _, _ = do(http.MethodDelete, base+"/"+name, nil)
	})
	noSecret := func(t *testing.T, what string, raw []byte) {
		t.Helper()
		for _, s := range []string{secret, rotated} {
			if bytes.Contains(raw, []byte(s)) {
				t.Errorf("%s returned a credential value to the browser: %s", what, truncate(raw))
			}
		}
	}

	// What the form is built from: the name it labels the field with, and the
	// variable it sends the value under.
	var offered providerProfile
	mustJSON(t, http.MethodGet, profilesPath(ws)+"/"+profile, nil, &offered, http.StatusOK)
	if len(offered.Credentials) != 1 || offered.Credentials[0].Name != credential ||
		len(offered.Credentials[0].EnvVars) != 1 || offered.Credentials[0].EnvVars[0] != envVar {
		t.Fatalf("profile %q offers credentials %+v, want one named %q with envVars [%s]",
			profile, offered.Credentials, credential, envVar)
	}

	t.Run("create", func(t *testing.T) {
		raw := mustRaw(t, http.MethodPost, base,
			providerBody("", name, profile, map[string]string{envVar: secret}), http.StatusCreated)
		noSecret(t, "create", raw)
		var created provider
		mustDecode(t, raw, &created)
		if created.Type != profile || created.Metadata.Name != name {
			t.Errorf("created provider = %q of type %q, want %q of type %q", created.Metadata.Name, created.Type, name, profile)
		}
		// The key the form sends is the key the provider is then listed with.
		if len(created.CredentialNames) != 1 || created.CredentialNames[0] != envVar {
			t.Errorf("credentialNames = %v, want [%s]", created.CredentialNames, envVar)
		}
	})

	t.Run("rotate and set expiry", func(t *testing.T) {
		const expiresAtMs = int64(1893456000000) // 2030-01-01T00:00:00Z
		noSecret(t, "update", mustRaw(t, http.MethodPut, base+"/"+name, map[string]any{
			"credentials":           map[string]string{envVar: rotated},
			"credentialExpiresAtMs": map[string]int64{envVar: expiresAtMs},
		}, http.StatusOK))
		var read provider
		raw := mustRaw(t, http.MethodGet, base+"/"+name, nil, http.StatusOK)
		noSecret(t, "get after update", raw)
		mustDecode(t, raw, &read)
		if got := read.CredentialExpiresAtMs[envVar]; got != expiresAtMs {
			t.Errorf("credentialExpiresAtMs[%s] = %d, want %d", envVar, got, expiresAtMs)
		}
		if len(read.CredentialNames) != 1 || read.CredentialNames[0] != envVar {
			t.Errorf("credentialNames after rotating = %v, want [%s]: the credential is replaced, not added", read.CredentialNames, envVar)
		}
	})
}

// TestProviderProfileScope is a workspace whose own profile shadows a platform
// profile of the same id. The gateway lists both, and the two take their
// credential under different keys, so which one a provider resolves to is
// decided by the profile scope its create request names and by nothing else.
// The Add Provider form offers such an id once per scope and names the scope
// of the one that was chosen.
//
// Each create below carries a key only one of the two profiles declares. The
// gateway refuses a key the resolved profile does not declare, so both
// succeeding is what shows the scope is honoured rather than dropped.
func TestProviderProfileScope(t *testing.T) {
	ws := newWorkspace(t)
	const platformKey, workspaceKey = "COMPAT_PLATFORM_KEY", "COMPAT_WORKSPACE_KEY"
	id := seedPlatformProfile(t, openshell.ProfileCredential{
		Name: platformKey, EnvVars: []string{platformKey}, Required: true,
	})
	base := providersPath(ws)
	fromWorkspace, fromPlatform := randName("pv"), randName("pv")
	t.Cleanup(func() {
		// Last-in first-out: the providers go before the workspace profile,
		// and the platform profile seeded above goes last.
		_, _, _ = do(http.MethodDelete, profilesPath(ws)+"/"+id, nil)
	})

	shadow := profileBody(id, "Compat workspace profile")
	shadow["credentials"] = []map[string]any{{
		"name": workspaceKey, "envVars": []string{workspaceKey}, "required": true,
	}}
	var imported struct {
		Diagnostics []profileDiagnostic `json:"diagnostics"`
		Imported    bool                `json:"imported"`
	}
	mustJSON(t, http.MethodPost, profilesPath(ws),
		map[string]any{"profiles": []any{shadow}}, &imported, http.StatusCreated)
	if !imported.Imported {
		t.Fatalf("workspace profile %q, shadowing the platform one, was not imported [gateway %s]: %+v",
			id, gatewayVersion, imported.Diagnostics)
	}

	t.Run("both profiles are listed, each with its scope", func(t *testing.T) {
		var list []providerProfile
		mustJSON(t, http.MethodGet, profilesPath(ws), nil, &list, http.StatusOK)
		keyByScope := map[string]string{}
		for _, p := range list {
			if p.ID == id && len(p.Credentials) == 1 && len(p.Credentials[0].EnvVars) == 1 {
				keyByScope[p.Scope] = p.Credentials[0].EnvVars[0]
			}
		}
		if keyByScope["platform"] != platformKey || keyByScope["workspace"] != workspaceKey || len(keyByScope) != 2 {
			t.Errorf("profile %q is listed as %v by scope, want platform: %s and workspace: %s",
				id, keyByScope, platformKey, workspaceKey)
		}
	})

	t.Run("the workspace scope resolves the workspace profile", func(t *testing.T) {
		t.Cleanup(func() {
			_, _, _ = do(http.MethodDelete, base+"/"+fromWorkspace, nil)
		})
		var p provider
		mustJSON(t, http.MethodPost, base,
			providerBody(ws, fromWorkspace, id, map[string]string{workspaceKey: "s3cr3t-workspace"}), &p, http.StatusCreated)
		if p.ProfileWorkspace != ws {
			t.Errorf("created provider has profileWorkspace %q, want %q", p.ProfileWorkspace, ws)
		}
		if len(p.CredentialNames) != 1 || p.CredentialNames[0] != workspaceKey {
			t.Errorf("credentialNames = %v, want [%s]", p.CredentialNames, workspaceKey)
		}
	})

	t.Run("no scope resolves the platform profile it shadows", func(t *testing.T) {
		t.Cleanup(func() {
			_, _, _ = do(http.MethodDelete, base+"/"+fromPlatform, nil)
		})
		var p provider
		mustJSON(t, http.MethodPost, base,
			providerBody("", fromPlatform, id, map[string]string{platformKey: "s3cr3t-platform"}), &p, http.StatusCreated)
		if p.ProfileWorkspace != "" {
			t.Errorf("created provider has profileWorkspace %q, want none", p.ProfileWorkspace)
		}
		if len(p.CredentialNames) != 1 || p.CredentialNames[0] != platformKey {
			t.Errorf("credentialNames = %v, want [%s]", p.CredentialNames, platformKey)
		}
	})
}

// TestProviderLifecycle covers the Providers page: create, read, list, update
// and delete, and that a credential value never comes back out.
func TestProviderLifecycle(t *testing.T) {
	ws := newWorkspace(t)
	profile := seedPlatformProfile(t, agreeingCredential())
	name := randName("pv")
	base := providersPath(ws)
	const secret, rotated = "s3cr3t-compat-value", "r0tated-compat-value"
	t.Cleanup(func() {
		_, _, _ = do(http.MethodDelete, base+"/"+name, nil)
	})

	// noSecret is the check that matters most here. Credentials are
	// write-only: whatever the gateway returns, the BFF must not pass a value
	// on to the browser. The gateway returns each one as the literal
	// "REDACTED", and that placeholder is not passed on either: only the keys
	// are.
	noSecret := func(t *testing.T, what string, raw []byte) {
		t.Helper()
		for _, s := range []string{secret, rotated, "REDACTED"} {
			if bytes.Contains(raw, []byte(s)) {
				t.Errorf("%s returned a credential value to the browser: %s", what, truncate(raw))
			}
		}
	}
	// holdsOnlyTheCredential checks that a provider names exactly the one
	// credential it was created with.
	holdsOnlyTheCredential := func(t *testing.T, what string, names []string) {
		t.Helper()
		if len(names) != 1 || names[0] != profileCredentialKey {
			t.Errorf("%s: credentialNames = %v, want [%s]", what, names, profileCredentialKey)
		}
	}
	get := func(t *testing.T) (provider, []byte) {
		t.Helper()
		raw := mustRaw(t, http.MethodGet, base+"/"+name, nil, http.StatusOK)
		var p provider
		mustDecode(t, raw, &p)
		return p, raw
	}

	// The Add Provider form offers what this list returns, so a platform
	// profile has to show up in every workspace.
	t.Run("platform profile is offered in the workspace", func(t *testing.T) {
		var list []providerProfile
		mustJSON(t, http.MethodGet, profilesPath(ws), nil, &list, http.StatusOK)
		for _, p := range list {
			if p.ID == profile {
				if p.Scope != "platform" {
					t.Errorf("profile %q has scope %q, want \"platform\"", profile, p.Scope)
				}
				return
			}
		}
		t.Errorf("platform profile %q is not in workspace %s's profile list of %d", profile, ws, len(list))
	})

	t.Run("a missing required credential is a 400", func(t *testing.T) {
		wantError(t, http.MethodPost, base, map[string]any{"name": name, "type": profile},
			http.StatusBadRequest, "invalid_argument")
	})

	t.Run("create", func(t *testing.T) {
		body := providerBody("", name, profile, map[string]string{profileCredentialKey: secret})
		body["config"] = map[string]string{"region": "us"}
		body["labels"] = map[string]string{"team": "compat"}
		raw := mustRaw(t, http.MethodPost, base, body, http.StatusCreated)
		noSecret(t, "create", raw)
		var p provider
		mustDecode(t, raw, &p)
		if p.Metadata.Name != name || p.Type != profile || p.Metadata.Workspace != ws {
			t.Errorf("created provider = %q of type %q in %q, want %q of type %q in %q",
				p.Metadata.Name, p.Type, p.Metadata.Workspace, name, profile, ws)
		}
		if p.Config["region"] != "us" || p.Metadata.Labels["team"] != "compat" {
			t.Errorf("config = %v, labels = %v; want region=us and team=compat", p.Config, p.Metadata.Labels)
		}
		// The create body mirrors the gateway's Provider message, so a request
		// that names no profile scope gets none: the BFF does not fill one in.
		// For a platform profile that is the platform scope, where it lives.
		if p.ProfileWorkspace != "" {
			t.Errorf("created provider has profileWorkspace %q, want none: the request named none", p.ProfileWorkspace)
		}
		holdsOnlyTheCredential(t, "create", p.CredentialNames)
	})

	t.Run("creating twice is a conflict", func(t *testing.T) {
		wantError(t, http.MethodPost, base, map[string]any{
			"name": name, "type": profile, "credentials": map[string]string{profileCredentialKey: secret},
		}, http.StatusConflict, "already_exists")
	})

	t.Run("get", func(t *testing.T) {
		p, raw := get(t)
		noSecret(t, "get", raw)
		if p.Type != profile || p.Config["region"] != "us" {
			t.Errorf("provider = type %q config %v, want type %q with region=us", p.Type, p.Config, profile)
		}
	})

	// The gateway reports which credentials a provider holds as the keys of
	// its redacted credentials map. The SDK drops that map, so the BFF reads
	// the keys from the gateway's answer itself (pkg/clients/rawprovider.go).
	// The provider list, the detail page, the sandbox's Providers tab and the
	// credential refresh form all show a provider's credentials from them.
	t.Run("credential names are reported", func(t *testing.T) {
		p, raw := get(t)
		noSecret(t, "get", raw)
		holdsOnlyTheCredential(t, "get", p.CredentialNames)
	})

	t.Run("appears in list", func(t *testing.T) {
		raw := mustRaw(t, http.MethodGet, base, nil, http.StatusOK)
		noSecret(t, "list", raw)
		var list []provider
		mustDecode(t, raw, &list)
		if len(list) != 1 || list[0].Metadata.Name != name {
			t.Fatalf("providers in workspace %s = %d entries, want exactly %q", ws, len(list), name)
		}
		holdsOnlyTheCredential(t, "list", list[0].CredentialNames)
	})

	t.Run("update config", func(t *testing.T) {
		before, _ := get(t)
		var p provider
		mustJSON(t, http.MethodPut, base+"/"+name, map[string]any{"config": map[string]string{"region": "eu"}}, &p, http.StatusOK)
		if p.Config["region"] != "eu" {
			t.Errorf("config after update = %v, want region=eu", p.Config)
		}
		if p.Metadata.ResourceVersion <= before.Metadata.ResourceVersion {
			t.Errorf("resourceVersion = %d after an update, want more than %d", p.Metadata.ResourceVersion, before.Metadata.ResourceVersion)
		}
		// An update that names no credential leaves the stored one alone: the
		// BFF sends only what the request names. This can only see the key,
		// not the value; the handler's unit test pins what is sent.
		holdsOnlyTheCredential(t, "update", p.CredentialNames)
	})

	t.Run("rotate credential and set its expiry", func(t *testing.T) {
		const expiresAtMs = int64(1893456000000) // 2030-01-01T00:00:00Z
		noSecret(t, "update", mustRaw(t, http.MethodPut, base+"/"+name, map[string]any{
			"credentials":           map[string]string{profileCredentialKey: rotated},
			"credentialExpiresAtMs": map[string]int64{profileCredentialKey: expiresAtMs},
		}, http.StatusOK))
		p, raw := get(t)
		noSecret(t, "get after update", raw)
		if got := p.CredentialExpiresAtMs[profileCredentialKey]; got != expiresAtMs {
			t.Errorf("credentialExpiresAtMs[%s] = %d, want %d", profileCredentialKey, got, expiresAtMs)
		}
		// Sending only credentials must leave the config alone.
		if p.Config["region"] != "eu" {
			t.Errorf("config after a credentials-only update = %v, want region=eu kept", p.Config)
		}
		// Rotating replaces the credential under its key; it adds none.
		holdsOnlyTheCredential(t, "get after rotating", p.CredentialNames)
	})

	// Configuring a refresh for real needs a profile that declares a token
	// endpoint and an OAuth server behind it. What can be shown is that each
	// of the four refresh RPCs reaches the gateway and that its answer for a
	// provider with nothing configured maps to the status the UI expects.
	t.Run("credential refresh without a configuration", func(t *testing.T) {
		refresh := base + "/" + name + "/refresh"
		raw := mustRaw(t, http.MethodGet, base+"/"+name+"/refresh-status", nil, http.StatusOK)
		if string(bytes.TrimSpace(raw)) != "[]" {
			t.Errorf("refresh-status of a provider with no refresh configured = %s, want []", truncate(raw))
		}
		// "static" is a strategy the gateway knows but cannot mint.
		wantError(t, http.MethodPost, refresh, map[string]any{"credentialKey": profileCredentialKey, "strategy": "static"},
			http.StatusBadRequest, "invalid_argument")
		wantError(t, http.MethodPost, refresh+"/rotate", map[string]any{"credentialKey": profileCredentialKey},
			http.StatusNotFound, "not_found")
		wantError(t, http.MethodDelete, refresh+"?credentialKey="+profileCredentialKey, nil,
			http.StatusNotFound, "not_found")
	})

	var outcome string
	t.Run("delete", func(t *testing.T) {
		outcome = assertDeleted(t, http.MethodDelete, base+"/"+name)
	})

	t.Run("get after delete", func(t *testing.T) {
		if !establishesCompletion[outcome] {
			t.Skipf("delete outcome was %q, not a completion — skipping the 404 check", outcome)
		}
		wantError(t, http.MethodGet, base+"/"+name, nil, http.StatusNotFound, "not_found")
	})

	// What the OpenShell CLI and TUI send by default: the provider's own
	// workspace as the profile scope, whatever scope the profile is in. The
	// gateway resolves the profile the workspace sees, which for an id only
	// the platform has is the platform's.
	t.Run("the workspace as profile scope also resolves a platform profile", func(t *testing.T) {
		other := randName("pv")
		t.Cleanup(func() {
			_, _, _ = do(http.MethodDelete, base+"/"+other, nil)
		})
		var p provider
		mustJSON(t, http.MethodPost, base,
			providerBody(ws, other, profile, map[string]string{profileCredentialKey: secret}), &p, http.StatusCreated)
		if p.ProfileWorkspace != ws {
			t.Errorf("created provider has profileWorkspace %q, want %q", p.ProfileWorkspace, ws)
		}
	})
}

// TestSandboxProviderAttachDetach covers the Providers tab of a sandbox:
// listing the attached providers and attaching and detaching one, both of
// which are guarded by the sandbox's resource version.
func TestSandboxProviderAttachDetach(t *testing.T) {
	ws, sb := sharedSandbox(t)
	profile := seedPlatformProfile(t, agreeingCredential())
	name := randName("pv")
	const secret = "s3cr3t-attach-value"
	attachPath := sandboxPath(ws, sb) + "/providers/" + name

	mustJSON(t, http.MethodPost, providersPath(ws),
		providerBody("", name, profile, map[string]string{profileCredentialKey: secret}), nil, http.StatusCreated)
	t.Cleanup(func() {
		// The shared sandbox outlives this test, so it must be left with
		// nothing attached; a provider cannot be deleted while it is.
		_, _, _ = do(http.MethodDelete, attachPath, nil)
		_, _, _ = do(http.MethodDelete, providersPath(ws)+"/"+name, nil)
	})

	attached := func(t *testing.T) []string {
		t.Helper()
		raw := mustRaw(t, http.MethodGet, sandboxPath(ws, sb)+"/providers", nil, http.StatusOK)
		if bytes.Contains(raw, []byte(secret)) {
			t.Errorf("the sandbox's provider list returned a credential value: %s", truncate(raw))
		}
		var list []provider
		mustDecode(t, raw, &list)
		names := make([]string, 0, len(list))
		for _, p := range list {
			names = append(names, p.Metadata.Name)
			// The Providers tab shows each attached provider's credentials.
			if len(p.CredentialNames) != 1 || p.CredentialNames[0] != profileCredentialKey {
				t.Errorf("attached provider %s: credentialNames = %v, want [%s]",
					p.Metadata.Name, p.CredentialNames, profileCredentialKey)
			}
		}
		return names
	}
	// attachResult is what both calls return: a flag and the updated sandbox.
	type attachResult struct {
		Sandbox  *sandbox `json:"sandbox"`
		Attached bool     `json:"attached"`
		Detached bool     `json:"detached"`
	}
	decode := func(t *testing.T, raw []byte) attachResult {
		t.Helper()
		var res attachResult
		mustDecode(t, raw, &res)
		return res
	}
	// stale is the version the sandbox has before this test touches it. Every
	// attach and detach bumps the version, so from the first attach on it is
	// one a client could still be holding but the gateway has moved past.
	stale := getSandbox(t, ws, sb).Metadata.ResourceVersion

	t.Run("nothing attached at first", func(t *testing.T) {
		if got := attached(t); len(got) != 0 {
			t.Errorf("providers attached to the shared sandbox = %v, want none", got)
		}
	})

	t.Run("attach", func(t *testing.T) {
		res := decode(t, withCurrentVersion(t, ws, sb, func(version uint64) (int, []byte, error) {
			return do(http.MethodPost, attachPath, map[string]any{"expectedResourceVersion": version})
		}))
		if !res.Attached || res.Sandbox == nil {
			t.Fatalf("attach result = attached %v, sandbox %v; want attached with the updated sandbox", res.Attached, res.Sandbox)
		}
		if len(res.Sandbox.Spec.Providers) != 1 || res.Sandbox.Spec.Providers[0] != name {
			t.Errorf("sandbox spec.providers after attach = %v, want [%s]", res.Sandbox.Spec.Providers, name)
		}
		if res.Sandbox.Metadata.ResourceVersion <= stale {
			t.Errorf("sandbox resourceVersion = %d after attach, want more than %d", res.Sandbox.Metadata.ResourceVersion, stale)
		}
		if got := attached(t); len(got) != 1 || got[0] != name {
			t.Errorf("providers attached to the sandbox = %v, want [%s]", got, name)
		}
	})

	t.Run("attach with a stale resource version is a conflict", func(t *testing.T) {
		wantError(t, http.MethodPost, attachPath, map[string]any{"expectedResourceVersion": stale},
			http.StatusConflict, "conflict")
	})

	t.Run("attaching again changes nothing", func(t *testing.T) {
		// No body, so the gateway skips the version check.
		var res attachResult
		mustJSON(t, http.MethodPost, attachPath, nil, &res, http.StatusOK)
		if res.Attached {
			t.Error("attached = true for a provider that was already attached, want false")
		}
		if got := attached(t); len(got) != 1 {
			t.Errorf("providers attached after a repeated attach = %v, want just [%s]", got, name)
		}
	})

	t.Run("an attached provider cannot be deleted", func(t *testing.T) {
		wantError(t, http.MethodDelete, providersPath(ws)+"/"+name, nil, http.StatusConflict, "conflict")
	})

	t.Run("detach with a stale resource version is a conflict", func(t *testing.T) {
		wantError(t, http.MethodDelete, attachPath, map[string]any{"expectedResourceVersion": stale},
			http.StatusConflict, "conflict")
		if got := attached(t); len(got) != 1 {
			t.Errorf("a refused detach still changed the attached providers to %v", got)
		}
	})

	t.Run("detach", func(t *testing.T) {
		res := decode(t, withCurrentVersion(t, ws, sb, func(version uint64) (int, []byte, error) {
			return do(http.MethodDelete, attachPath, map[string]any{"expectedResourceVersion": version})
		}))
		if !res.Detached || res.Sandbox == nil {
			t.Fatalf("detach result = detached %v, sandbox %v; want detached with the updated sandbox", res.Detached, res.Sandbox)
		}
		if len(res.Sandbox.Spec.Providers) != 0 {
			t.Errorf("sandbox spec.providers after detach = %v, want none", res.Sandbox.Spec.Providers)
		}
		if got := attached(t); len(got) != 0 {
			t.Errorf("providers attached after detach = %v, want none", got)
		}
	})

	t.Run("unknown sandbox is a 404", func(t *testing.T) {
		wantError(t, http.MethodGet, sandboxPath(ws, "no-such-sandbox")+"/providers", nil, http.StatusNotFound, "not_found")
	})
}
