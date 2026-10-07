//go:build compat

package compat

import (
	"encoding/json"
	"fmt"
	"net/http"
	"reflect"
	"testing"
)

// This file covers what a provider profile carries beyond a name and a
// credential, and the platform scope:
//
//	whole profiles   a profile imported with a header name, discovery,
//	                 binaries, annotations and endpoints that say what they
//	                 allow is read back with all of it, and still has all of
//	                 it after an update                                    TestProviderProfileKeepsEveryField
//	platform scope   lint, import, read, update and delete of a
//	                 platform-scoped profile through the BFF, and how a
//	                 workspace sees it                                     TestPlatformProviderProfiles
//	no credentials   a provider with no stored credentials, on a profile
//	                 whose required credential the gateway mints, and the
//	                 refusal on a profile that needs one                   TestProviderWithoutCredentials
//
// The profiles are upstream's own, so that the gateway accepting them is not
// this suite's guess: providers/github.yaml and providers/google-cloud.yaml in
// NVIDIA/OpenShell, which read the same at v0.1.0 and v0.1.2. Only the ids and
// the environment variable names are this suite's.
//
// Not covered: a token grant. The profiles upstream publishes with one point
// at token services inside a demo cluster, and the gateway checks where a
// token endpoint may be.

// fullProfile mirrors the parts of models.ProviderProfile this file reads.
type fullProfile struct {
	Annotations map[string]string `json:"annotations"`
	Discovery   *struct {
		Credentials []string `json:"credentials"`
	} `json:"discovery"`
	ID          string `json:"id"`
	DisplayName string `json:"displayName"`
	Scope       string `json:"scope"`
	Credentials []struct {
		Refresh *struct {
			Strategy      string   `json:"strategy"`
			TokenURL      string   `json:"tokenUrl"`
			RefreshBefore string   `json:"refreshBefore"`
			MaxLifetime   string   `json:"maxLifetime"`
			Scopes        []string `json:"scopes"`
			Material      []struct {
				Name     string `json:"name"`
				Required bool   `json:"required"`
				Secret   bool   `json:"secret"`
			} `json:"material"`
		} `json:"refresh"`
		Name       string   `json:"name"`
		AuthStyle  string   `json:"authStyle"`
		HeaderName string   `json:"headerName"`
		EnvVars    []string `json:"envVars"`
		Required   bool     `json:"required"`
	} `json:"credentials"`
	Endpoints        []string          `json:"endpoints"`
	NetworkEndpoints []json.RawMessage `json:"networkEndpoints"`
	Binaries         []struct {
		Path string `json:"path"`
	} `json:"binaries"`
	ResourceVersion uint64 `json:"resourceVersion"`
}

func platformProfilesPath() string {
	return "/api/v1/provider-profiles"
}

// githubEndpoints are the endpoints of upstream's providers/github.yaml, as
// the dashboard sends a profile file's endpoints: whole, in the spelling
// sandbox policies use.
func githubEndpoints() []map[string]any {
	allow := func(method, path string) map[string]any {
		return map[string]any{"allow": map[string]any{"method": method, "path": path}}
	}
	return []map[string]any{
		{
			"host": "api.github.com", "port": 443, "protocol": "rest",
			"access": "NETWORK_ACCESS_PRESET_READ_ONLY", "enforcement": "NETWORK_ENFORCEMENT_MODE_ENFORCE",
		},
		{
			"host": "api.github.com", "port": 443, "path": "/graphql", "protocol": "graphql",
			"access": "NETWORK_ACCESS_PRESET_READ_ONLY", "enforcement": "NETWORK_ENFORCEMENT_MODE_ENFORCE",
		},
		{
			"host": "github.com", "port": 443, "protocol": "rest",
			"enforcement": "NETWORK_ENFORCEMENT_MODE_ENFORCE",
			"rules": []map[string]any{
				allow("GET", "**"), allow("HEAD", "**"), allow("OPTIONS", "**"), allow("POST", "/**/git-upload-pack"),
			},
		},
	}
}

// githubProfileBody is upstream's providers/github.yaml under the given id:
// a credential that says which header it goes in, discovery, three endpoints
// that say what they allow, and the binaries that may reach them. It is what
// the import form's old body could not express and the gateway would not take
// in part: a credential together with an endpoint needs the header name and
// the L7 fields.
func githubProfileBody(id, displayName string) map[string]any {
	return map[string]any{
		"id":               id,
		"displayName":      displayName,
		"description":      "GitHub API and Git operations (backend/test/compat)",
		"category":         "SOURCE_CONTROL",
		"inferenceCapable": false,
		"annotations":      map[string]string{"example.com/source": "backend-test-compat"},
		"credentials": []map[string]any{{
			"name":        "api_token",
			"description": "GitHub token",
			"envVars":     []string{"COMPAT_GITHUB_TOKEN", "COMPAT_GH_TOKEN"},
			"required":    true,
			"authStyle":   "bearer",
			"headerName":  "authorization",
		}},
		"discovery":        map[string]any{"credentials": []string{"api_token"}},
		"networkEndpoints": githubEndpoints(),
		"binaries": []map[string]any{
			{"path": "/usr/bin/gh"}, {"path": "/usr/local/bin/gh"}, {"path": "/usr/bin/git"}, {"path": "/usr/local/bin/git"},
		},
	}
}

// mintedProfileBody is the adc_token credential of upstream's
// providers/google-cloud.yaml under the given id, made required: a credential
// the gateway mints from refresh material, so a provider of this type starts
// with none stored.
func mintedProfileBody(id string) map[string]any {
	return map[string]any{
		"id":               id,
		"displayName":      "Compat minted credential",
		"description":      "A credential the gateway mints (backend/test/compat)",
		"category":         "OTHER",
		"inferenceCapable": false,
		"credentials": []map[string]any{{
			"name":        "adc_token",
			"description": "Access token from application default credentials",
			"envVars":     []string{"COMPAT_ADC_ACCESS_TOKEN"},
			"required":    true,
			"authStyle":   "bearer",
			"headerName":  "authorization",
			"refresh": map[string]any{
				"strategy":      "OAUTH2_REFRESH_TOKEN",
				"tokenUrl":      "https://oauth2.googleapis.com/token",
				"scopes":        []string{"https://www.googleapis.com/auth/cloud-platform"},
				"refreshBefore": "300s",
				"maxLifetime":   "3600s",
				"material": []map[string]any{
					{"name": "client_id", "description": "OAuth2 client ID", "required": true, "secret": false},
					{"name": "client_secret", "description": "OAuth2 client secret", "required": true, "secret": true},
					{"name": "refresh_token", "description": "OAuth2 refresh token", "required": true, "secret": true},
				},
			},
		}},
	}
}

// asJSON turns a value into what encoding/json reads it back as, so that a
// request body built from Go literals can be compared with a response.
func asJSON(t *testing.T, v any) any {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var out any
	mustDecode(t, raw, &out)
	return out
}

// missingFrom reports the first thing in want that got does not have: a key
// of an object, an element of an array, or a value. The gateway may add to
// what it was sent; this suite asks only that it drops nothing.
func missingFrom(want, got any, path string) string {
	switch w := want.(type) {
	case map[string]any:
		g, ok := got.(map[string]any)
		if !ok {
			return fmt.Sprintf("%s: got %v, want an object", path, got)
		}
		for key, value := range w {
			if _, present := g[key]; !present {
				return fmt.Sprintf("%s.%s is missing (want %v)", path, key, value)
			}
			if missing := missingFrom(value, g[key], path+"."+key); missing != "" {
				return missing
			}
		}
	case []any:
		g, ok := got.([]any)
		if !ok || len(g) != len(w) {
			return fmt.Sprintf("%s: got %v, want %d elements", path, got, len(w))
		}
		for i := range w {
			if missing := missingFrom(w[i], g[i], fmt.Sprintf("%s[%d]", path, i)); missing != "" {
				return missing
			}
		}
	default:
		if !reflect.DeepEqual(want, got) {
			return fmt.Sprintf("%s = %v, want %v", path, got, want)
		}
	}
	return ""
}

// assertGithubProfile checks that a profile read back holds what
// githubProfileBody sent, field by field for the fields the dashboard used to
// drop.
func assertGithubProfile(t *testing.T, got fullProfile, raw []byte) {
	t.Helper()
	if len(got.Credentials) != 1 || got.Credentials[0].HeaderName != "authorization" ||
		got.Credentials[0].AuthStyle != "bearer" || len(got.Credentials[0].EnvVars) != 2 {
		t.Errorf("credential = %+v, want api_token as a bearer authorization header under two variables", got.Credentials)
	}
	if got.Discovery == nil || !reflect.DeepEqual(got.Discovery.Credentials, []string{"api_token"}) {
		t.Errorf("discovery = %+v, want [api_token]", got.Discovery)
	}
	paths := make([]string, 0, len(got.Binaries))
	for _, binary := range got.Binaries {
		paths = append(paths, binary.Path)
	}
	if want := []string{"/usr/bin/gh", "/usr/local/bin/gh", "/usr/bin/git", "/usr/local/bin/git"}; !reflect.DeepEqual(paths, want) {
		t.Errorf("binaries = %v, want %v", paths, want)
	}
	if got.Annotations["example.com/source"] != "backend-test-compat" {
		t.Errorf("annotations = %v, want example.com/source kept", got.Annotations)
	}
	if want := []string{"api.github.com:443", "api.github.com:443", "github.com:443"}; !reflect.DeepEqual(got.Endpoints, want) {
		t.Errorf("endpoint summaries = %v, want %v", got.Endpoints, want)
	}

	var whole map[string]any
	mustDecode(t, raw, &whole)
	if missing := missingFrom(asJSON(t, githubEndpoints()), whole["networkEndpoints"], "networkEndpoints"); missing != "" {
		t.Errorf("the profile's endpoints came back without what they were sent with [gateway %s]: %s",
			gatewayVersion, missing)
	}
}

// TestProviderProfileKeepsEveryField imports a profile the way the dashboard's
// file import sends one, with everything upstream's github profile declares,
// reads it back, and then updates it.
//
// The update is the point. The gateway replaces a stored profile with the one
// an update sends, and the dashboard used to send a body with no room for a
// header name, discovery, binaries, annotations or anything of an endpoint but
// its host and port, so saving a profile removed them. Here the profile that
// was read is sent back with one field changed, and everything else has to
// still be there.
func TestProviderProfileKeepsEveryField(t *testing.T) {
	ws := newWorkspace(t)
	id := randName("cpf")
	base := profilesPath(ws)
	t.Cleanup(func() {
		_, _, _ = do(http.MethodDelete, base+"/"+id, nil)
	})

	t.Run("lint", func(t *testing.T) {
		var res struct {
			Diagnostics []profileDiagnostic `json:"diagnostics"`
			Valid       bool                `json:"valid"`
		}
		mustJSON(t, http.MethodPost, base+"/lint",
			map[string]any{"profiles": []any{githubProfileBody(id, "Compat GitHub")}}, &res, http.StatusOK)
		if !res.Valid {
			t.Fatalf("upstream's github profile lints as invalid [gateway %s]: %+v", gatewayVersion, res.Diagnostics)
		}
	})

	t.Run("import", func(t *testing.T) {
		var res struct {
			Diagnostics []profileDiagnostic `json:"diagnostics"`
			Profiles    []fullProfile       `json:"profiles"`
			Imported    bool                `json:"imported"`
		}
		mustJSON(t, http.MethodPost, base,
			map[string]any{"profiles": []any{githubProfileBody(id, "Compat GitHub")}}, &res, http.StatusCreated)
		if !res.Imported || len(res.Profiles) != 1 || res.Profiles[0].ID != id {
			t.Fatalf("import = imported %v, %d profiles [gateway %s]: %+v",
				res.Imported, len(res.Profiles), gatewayVersion, res.Diagnostics)
		}
	})

	var read map[string]any
	var version uint64
	t.Run("read back whole", func(t *testing.T) {
		raw := mustRaw(t, http.MethodGet, base+"/"+id, nil, http.StatusOK)
		var got fullProfile
		mustDecode(t, raw, &got)
		assertGithubProfile(t, got, raw)
		mustDecode(t, raw, &read)
		version = got.ResourceVersion
	})

	t.Run("listed whole", func(t *testing.T) {
		raw := mustRaw(t, http.MethodGet, base, nil, http.StatusOK)
		var list []json.RawMessage
		mustDecode(t, raw, &list)
		for _, entry := range list {
			var got fullProfile
			mustDecode(t, entry, &got)
			if got.ID == id && got.Scope == "workspace" {
				assertGithubProfile(t, got, entry)
				return
			}
		}
		t.Errorf("profile %q is not in the workspace's list of %d", id, len(list))
	})

	t.Run("an update that changes one field keeps the rest", func(t *testing.T) {
		if read == nil {
			t.Skip("the profile was not read")
		}
		// What a client that edits a profile sends: the profile it read, with
		// its change. The host:port summaries are derived from
		// networkEndpoints and are not part of what is written.
		delete(read, "endpoints")
		read["displayName"] = "Compat GitHub, renamed"
		var res struct {
			Diagnostics []profileDiagnostic `json:"diagnostics"`
			Updated     bool                `json:"updated"`
		}
		mustJSON(t, http.MethodPut, base+"/"+id,
			map[string]any{"profile": read, "expectedResourceVersion": version}, &res, http.StatusOK)
		if !res.Updated {
			t.Fatalf("the profile that was read was not accepted back [gateway %s]: %+v", gatewayVersion, res.Diagnostics)
		}

		raw := mustRaw(t, http.MethodGet, base+"/"+id, nil, http.StatusOK)
		var got fullProfile
		mustDecode(t, raw, &got)
		if got.DisplayName != "Compat GitHub, renamed" || got.ResourceVersion <= version {
			t.Errorf("profile = %q at resourceVersion %d, want the new name at more than %d",
				got.DisplayName, got.ResourceVersion, version)
		}
		assertGithubProfile(t, got, raw)
	})
}

// TestPlatformProviderProfiles is the platform-admin Provider profiles page:
// a profile that belongs to no workspace and that every workspace sees,
// managed through /api/v1/provider-profiles the way a workspace's own are
// managed under the workspace. It is the CLI's `provider profile ... --global`.
//
// It leaves the gateway as it found it: the one profile it creates has a
// random id and is deleted, by the test and again by its cleanup.
func TestPlatformProviderProfiles(t *testing.T) {
	ws := newWorkspace(t)
	id := randName("cpp")
	base := platformProfilesPath()
	t.Cleanup(func() {
		_, _, _ = do(http.MethodDelete, base+"/"+id, nil)
	})

	t.Run("lint", func(t *testing.T) {
		var res struct {
			Diagnostics []profileDiagnostic `json:"diagnostics"`
			Valid       bool                `json:"valid"`
		}
		mustJSON(t, http.MethodPost, base+"/lint",
			map[string]any{"profiles": []any{githubProfileBody(id, "Compat platform GitHub")}}, &res, http.StatusOK)
		if !res.Valid {
			t.Fatalf("the profile lints as invalid in the platform scope [gateway %s]: %+v", gatewayVersion, res.Diagnostics)
		}
	})

	t.Run("import", func(t *testing.T) {
		var res struct {
			Diagnostics []profileDiagnostic `json:"diagnostics"`
			Imported    bool                `json:"imported"`
		}
		mustJSON(t, http.MethodPost, base,
			map[string]any{"profiles": []any{githubProfileBody(id, "Compat platform GitHub")}}, &res, http.StatusCreated)
		if !res.Imported {
			t.Fatalf("the platform profile was not imported [gateway %s]: %+v", gatewayVersion, res.Diagnostics)
		}
	})

	t.Run("importing twice is refused", func(t *testing.T) {
		// Not an HTTP error: the answer says nothing was imported and why.
		var res struct {
			Diagnostics []profileDiagnostic `json:"diagnostics"`
			Imported    bool                `json:"imported"`
		}
		mustJSON(t, http.MethodPost, base,
			map[string]any{"profiles": []any{githubProfileBody(id, "Compat platform GitHub")}}, &res, http.StatusCreated)
		if res.Imported || len(res.Diagnostics) == 0 {
			t.Errorf("second import = imported %v with %d diagnostics, want it refused with a diagnostic",
				res.Imported, len(res.Diagnostics))
		}
	})

	var version uint64
	t.Run("read from the platform scope", func(t *testing.T) {
		raw := mustRaw(t, http.MethodGet, base+"/"+id, nil, http.StatusOK)
		var got fullProfile
		mustDecode(t, raw, &got)
		if got.ID != id || got.Scope != "platform" {
			t.Errorf("profile = %q in scope %q, want %q in \"platform\"", got.ID, got.Scope, id)
		}
		assertGithubProfile(t, got, raw)
		version = got.ResourceVersion
	})

	t.Run("listed in the platform scope", func(t *testing.T) {
		var list []fullProfile
		mustJSON(t, http.MethodGet, base, nil, &list, http.StatusOK)
		for _, p := range list {
			if p.ID == id {
				return
			}
		}
		t.Errorf("profile %q is not in the platform's list of %d", id, len(list))
	})

	// The profile is not the workspace's, so the workspace cannot change it:
	// a workspace lists it with its scope, which is how the Profiles tab knows
	// to offer no delete for it.
	t.Run("a workspace sees it as a platform profile", func(t *testing.T) {
		var list []fullProfile
		mustJSON(t, http.MethodGet, profilesPath(ws), nil, &list, http.StatusOK)
		for _, p := range list {
			if p.ID == id {
				if p.Scope != "platform" {
					t.Errorf("workspace %q lists %q with scope %q, want \"platform\"", ws, id, p.Scope)
				}
				return
			}
		}
		t.Errorf("workspace %q does not list platform profile %q among its %d", ws, id, len(list))
	})

	t.Run("a workspace cannot delete it", func(t *testing.T) {
		status, raw, err := do(http.MethodDelete, profilesPath(ws)+"/"+id, nil)
		if err != nil {
			t.Fatalf("delete through the workspace: %v", err)
		}
		if status == http.StatusOK {
			var res deleteResult
			mustDecode(t, raw, &res)
			if res.Outcome == "completed" {
				t.Fatalf("deleting platform profile %q through workspace %q completed", id, ws)
			}
		}
		mustJSON(t, http.MethodGet, base+"/"+id, nil, &fullProfile{}, http.StatusOK)
	})

	t.Run("update with a stale resource version is a conflict", func(t *testing.T) {
		wantError(t, http.MethodPut, base+"/"+id, map[string]any{
			"profile":                 githubProfileBody(id, "Compat platform GitHub, stale"),
			"expectedResourceVersion": version + 7,
		}, http.StatusConflict, "conflict")
	})

	t.Run("update", func(t *testing.T) {
		var res struct {
			Profile     *fullProfile        `json:"profile"`
			Diagnostics []profileDiagnostic `json:"diagnostics"`
			Updated     bool                `json:"updated"`
		}
		mustJSON(t, http.MethodPut, base+"/"+id, map[string]any{
			"profile":                 githubProfileBody(id, "Compat platform GitHub, renamed"),
			"expectedResourceVersion": version,
		}, &res, http.StatusOK)
		if !res.Updated || res.Profile == nil || res.Profile.DisplayName != "Compat platform GitHub, renamed" {
			t.Fatalf("update = updated %v, profile %+v [gateway %s]: %+v", res.Updated, res.Profile, gatewayVersion, res.Diagnostics)
		}
	})

	var outcome string
	t.Run("delete", func(t *testing.T) {
		outcome = assertDeleted(t, http.MethodDelete, base+"/"+id)
	})

	t.Run("gone from both scopes", func(t *testing.T) {
		if !establishesCompletion[outcome] {
			t.Skipf("delete outcome was %q, not a completion — skipping the 404 check", outcome)
		}
		wantError(t, http.MethodGet, base+"/"+id, nil, http.StatusNotFound, "not_found")
		var list []fullProfile
		mustJSON(t, http.MethodGet, profilesPath(ws), nil, &list, http.StatusOK)
		for _, p := range list {
			if p.ID == id {
				t.Errorf("workspace %q still lists deleted platform profile %q", ws, id)
			}
		}
	})
}

// TestProviderWithoutCredentials is the Add Provider form with nothing typed
// into a credential field, which is the CLI's `provider create
// --runtime-credentials`.
//
// The gateway takes a provider with no stored credentials when every required
// credential of its profile is resolved at runtime: here one the gateway mints
// from refresh material. It refuses one when the profile requires a credential
// that can only be given, and the form reads the same profile fields to decide
// which case it is in before it sends anything.
func TestProviderWithoutCredentials(t *testing.T) {
	ws := newWorkspace(t)
	minted, static := randName("cpf"), randName("cpf")
	name := randName("pv")
	t.Cleanup(func() {
		// Last-in first-out: the provider goes before the profiles.
		_, _, _ = do(http.MethodDelete, profilesPath(ws)+"/"+minted, nil)
		_, _, _ = do(http.MethodDelete, profilesPath(ws)+"/"+static, nil)
	})
	for id, body := range map[string]map[string]any{minted: mintedProfileBody(minted), static: profileBody(static, "Compat profile")} {
		var res struct {
			Diagnostics []profileDiagnostic `json:"diagnostics"`
			Imported    bool                `json:"imported"`
		}
		mustJSON(t, http.MethodPost, profilesPath(ws), map[string]any{"profiles": []any{body}}, &res, http.StatusCreated)
		if !res.Imported {
			t.Fatalf("profile %q was not imported [gateway %s]: %+v", id, gatewayVersion, res.Diagnostics)
		}
	}

	// What the form reads to know the credential needs no value: that it
	// declares a refresh the gateway performs.
	t.Run("the profile says its credential is minted", func(t *testing.T) {
		var got fullProfile
		mustJSON(t, http.MethodGet, profilesPath(ws)+"/"+minted, nil, &got, http.StatusOK)
		if len(got.Credentials) != 1 || got.Credentials[0].Refresh == nil {
			t.Fatalf("credentials = %+v, want one that declares a refresh", got.Credentials)
		}
		refresh := got.Credentials[0].Refresh
		if !got.Credentials[0].Required || refresh.Strategy != "OAUTH2_REFRESH_TOKEN" ||
			refresh.TokenURL != "https://oauth2.googleapis.com/token" ||
			refresh.RefreshBefore != "300s" || refresh.MaxLifetime != "3600s" {
			t.Errorf("refresh = %+v, want the oauth2_refresh_token declaration that was imported", refresh)
		}
		secrets := map[string]bool{}
		for _, material := range refresh.Material {
			secrets[material.Name] = material.Secret
		}
		if want := map[string]bool{"client_id": false, "client_secret": true, "refresh_token": true}; !reflect.DeepEqual(secrets, want) {
			t.Errorf("refresh material = %v, want %v", secrets, want)
		}
	})

	t.Run("a provider with no credentials is created", func(t *testing.T) {
		t.Cleanup(func() {
			_, _, _ = do(http.MethodDelete, providersPath(ws)+"/"+name, nil)
		})
		var created provider
		mustJSON(t, http.MethodPost, providersPath(ws),
			map[string]any{"name": name, "type": minted, "profileWorkspace": ws}, &created, http.StatusCreated)
		if created.Type != minted || len(created.CredentialNames) != 0 {
			t.Errorf("created provider = type %q holding %v, want type %q holding nothing",
				created.Type, created.CredentialNames, minted)
		}
		var read provider
		mustJSON(t, http.MethodGet, providersPath(ws)+"/"+name, nil, &read, http.StatusOK)
		if len(read.CredentialNames) != 0 {
			t.Errorf("provider reads back holding %v, want nothing", read.CredentialNames)
		}
	})

	t.Run("a profile that needs a credential refuses one", func(t *testing.T) {
		refused := randName("pv")
		t.Cleanup(func() {
			_, _, _ = do(http.MethodDelete, providersPath(ws)+"/"+refused, nil)
		})
		wantError(t, http.MethodPost, providersPath(ws),
			map[string]any{"name": refused, "type": static, "profileWorkspace": ws},
			http.StatusBadRequest, "invalid_argument")
	})
}
