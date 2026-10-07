//go:build compat

package compat

import (
	"bytes"
	"net/http"
	"reflect"
	"sort"
	"strings"
	"testing"
)

// This file covers what the Add Provider and Edit Provider forms rely on the
// gateway to do with the requests they send:
//
//	edits            an edit sends the configuration entries that were
//	                 changed and removed and no others, and the gateway
//	                 leaves every other entry as it is by then             TestProviderEditSendsOnlyChanges
//	credential keys  a credential the profile accepts under several keys
//	                 is stored under the one the request names, a key the
//	                 profile does not declare is refused, and a profile
//	                 with no credentials takes none                        TestProviderCredentialKeys
//	no profile       a provider whose profile is gone stays, and a
//	                 credential it holds can still be given a new value    TestProviderWithoutProfile

// sortedKeys returns the keys of a config map in order, for messages.
func sortedKeys(m map[string]string) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// TestProviderEditSendsOnlyChanges is the Edit Provider form saving while the
// provider is being changed from somewhere else: the CLI, the TUI, another
// browser.
//
// The gateway merges an update into the provider it holds. An entry that is
// sent is written, one sent with an empty value is removed, and one that is
// not sent keeps whatever value it has by then. So what the form sends is what
// was changed in the form since it opened, and no more. It used to send every
// entry it had when it opened; the "stale form" subtest sends that request, to
// keep on record what it does to a provider and why the form stopped.
func TestProviderEditSendsOnlyChanges(t *testing.T) {
	ws := newWorkspace(t)
	profile := seedPlatformProfile(t, agreeingCredential())
	base := providersPath(ws)
	name := randName("pv")
	path := base + "/" + name
	const secret, rotated = "s3cr3t-edit-value", "r0tated-edit-value"
	t.Cleanup(func() {
		_, _, _ = do(http.MethodDelete, path, nil)
	})

	configIs := func(t *testing.T, what string, want map[string]string) {
		t.Helper()
		var p provider
		raw := mustRaw(t, http.MethodGet, path, nil, http.StatusOK)
		for _, s := range []string{secret, rotated, "REDACTED"} {
			if bytes.Contains(raw, []byte(s)) {
				t.Errorf("%s: the provider came back with a credential value: %s", what, truncate(raw))
			}
		}
		mustDecode(t, raw, &p)
		if len(p.Config) == 0 && len(want) == 0 {
			return
		}
		if !reflect.DeepEqual(p.Config, want) {
			t.Errorf("%s: config = %v, want %v", what, p.Config, want)
		}
	}
	// elsewhere is a change made by someone else while the form is open.
	elsewhere := func(t *testing.T, config map[string]string) {
		t.Helper()
		mustJSON(t, http.MethodPut, path, map[string]any{"config": config}, nil, http.StatusOK)
	}

	body := providerBody("", name, profile, map[string]string{profileCredentialKey: secret})
	body["config"] = map[string]string{"region": "us", "tier": "free"}
	mustJSON(t, http.MethodPost, base, body, nil, http.StatusCreated)

	// The form opens here, on region=us and tier=free.
	t.Run("a credential is rotated while the configuration changes elsewhere", func(t *testing.T) {
		elsewhere(t, map[string]string{"region": "eu", "extra": "1"})
		// The form's request for a new credential value: no configuration.
		mustJSON(t, http.MethodPut, path, map[string]any{
			"credentials": map[string]string{profileCredentialKey: rotated},
		}, nil, http.StatusOK)
		configIs(t, "after rotating a credential", map[string]string{"region": "eu", "tier": "free", "extra": "1"})
	})

	t.Run("one entry is changed, one removed and one added", func(t *testing.T) {
		// Edited in the form: tier removed, team added. region and extra were
		// not touched, so they are not in the request.
		var p provider
		mustJSON(t, http.MethodPut, path, map[string]any{
			"config": map[string]string{"tier": "", "team": "ml"},
		}, &p, http.StatusOK)
		want := map[string]string{"region": "eu", "extra": "1", "team": "ml"}
		if !reflect.DeepEqual(p.Config, want) {
			t.Errorf("config in the answer = %v, want %v", p.Config, want)
		}
		configIs(t, "after the edit", want)
		if len(p.CredentialNames) != 1 || p.CredentialNames[0] != profileCredentialKey {
			t.Errorf("credentialNames after a configuration edit = %v, want [%s]", p.CredentialNames, profileCredentialKey)
		}
	})

	// What the form sent before: every entry it held when it opened, and an
	// empty value for each entry the provider has by now that the form did not
	// hold. The gateway does exactly what it is told.
	t.Run("stale form: sending every entry puts old values back", func(t *testing.T) {
		elsewhere(t, map[string]string{"region": "ap", "extra": "2"})
		mustJSON(t, http.MethodPut, path, map[string]any{
			"credentials": map[string]string{profileCredentialKey: rotated},
			// Held by a form that opened on region=eu, extra=1, team=ml.
			"config": map[string]string{"region": "eu", "extra": "1", "team": "ml"},
		}, nil, http.StatusOK)
		var p provider
		mustJSON(t, http.MethodGet, path, nil, &p, http.StatusOK)
		if p.Config["region"] != "eu" || p.Config["extra"] != "1" {
			t.Errorf("config after a request that names every entry = %v (keys %v); the gateway was expected to "+
				"write the entries it was sent, which is why the form must not send the ones it did not change",
				p.Config, sortedKeys(p.Config))
		}
	})

	t.Run("an update that names nothing changes nothing", func(t *testing.T) {
		var before, after provider
		mustJSON(t, http.MethodGet, path, nil, &before, http.StatusOK)
		mustJSON(t, http.MethodPut, path, map[string]any{}, nil, http.StatusOK)
		mustJSON(t, http.MethodGet, path, nil, &after, http.StatusOK)
		if !reflect.DeepEqual(before.Config, after.Config) || !reflect.DeepEqual(before.CredentialNames, after.CredentialNames) {
			t.Errorf("an empty update changed the provider: config %v -> %v, credentials %v -> %v",
				before.Config, after.Config, before.CredentialNames, after.CredentialNames)
		}
	})
}

// TestProviderCredentialKeys is the Add Provider form's choice of the key a
// credential is stored under, and the reason it offers no free-form key.
//
// A profile credential may list several environment variables. The gateway
// accepts the credential under any of them and stores it under the one the
// request names; the form offers the choice and defaults to the first. The
// gateway refuses a key the profile does not declare, on create and on update,
// and that includes a profile that declares no credential at all: the TUI's
// "Env var name / Value" entry for such a profile has nothing it could store.
func TestProviderCredentialKeys(t *testing.T) {
	ws := newWorkspace(t)
	const first, second = "COMPAT_TOKEN", "COMPAT_TOKEN_ALT"
	profile := seedPlatformProfile(t, credentialSchema{
		Name: "api_token", EnvVars: []string{first, second}, Required: true,
	})
	base := providersPath(ws)

	create := func(t *testing.T, credentials map[string]string) provider {
		t.Helper()
		name := randName("pv")
		t.Cleanup(func() {
			_, _, _ = do(http.MethodDelete, base+"/"+name, nil)
		})
		var p provider
		mustJSON(t, http.MethodPost, base, providerBody("", name, profile, credentials), &p, http.StatusCreated)
		return p
	}
	holds := func(t *testing.T, p provider, want ...string) {
		t.Helper()
		got := append([]string(nil), p.CredentialNames...)
		sort.Strings(got)
		sort.Strings(want)
		if !reflect.DeepEqual(got, want) {
			t.Errorf("credentialNames = %v, want %v", got, want)
		}
	}
	refusedAsUndeclared := func(t *testing.T, method, path string, body map[string]any, key string) {
		t.Helper()
		status, raw, err := do(method, path, body)
		if err != nil {
			t.Fatalf("%s %s [gateway %s]: %v", method, path, gatewayVersion, err)
		}
		checkError(t, method+" "+path, status, raw, http.StatusBadRequest, "invalid_argument")
		if !strings.Contains(string(raw), "not declared by profile") || !strings.Contains(string(raw), key) {
			t.Errorf("%s %s was refused with %s, want the gateway's \"not declared by profile\" naming %s",
				method, path, truncate(raw), key)
		}
	}

	t.Run("stored under the first key", func(t *testing.T) {
		holds(t, create(t, map[string]string{first: "s3cr3t-first"}), first)
	})

	t.Run("stored under the second key when that is the one chosen", func(t *testing.T) {
		p := create(t, map[string]string{second: "s3cr3t-second"})
		holds(t, p, second)

		// A new value under the key it holds replaces it; under the other key
		// it is a second copy, which is what the form's default avoids.
		var rotated provider
		mustJSON(t, http.MethodPut, base+"/"+p.Metadata.Name, map[string]any{
			"credentials": map[string]string{second: "r0tated-second"},
		}, &rotated, http.StatusOK)
		holds(t, rotated, second)

		var both provider
		mustJSON(t, http.MethodPut, base+"/"+p.Metadata.Name, map[string]any{
			"credentials": map[string]string{first: "s3cr3t-also-first"},
		}, &both, http.StatusOK)
		holds(t, both, first, second)
	})

	t.Run("the credential's own name is not a key when it declares env vars", func(t *testing.T) {
		refusedAsUndeclared(t, http.MethodPost, base,
			providerBody("", randName("pv"), profile, map[string]string{"api_token": "s3cr3t-by-name"}), "api_token")
	})

	t.Run("a key the profile does not declare is refused on create", func(t *testing.T) {
		refusedAsUndeclared(t, http.MethodPost, base, providerBody("", randName("pv"), profile,
			map[string]string{first: "s3cr3t-first", "COMPAT_UNDECLARED": "s3cr3t-extra"}), "COMPAT_UNDECLARED")
	})

	t.Run("a key the profile does not declare is refused on update", func(t *testing.T) {
		p := create(t, map[string]string{first: "s3cr3t-first"})
		refusedAsUndeclared(t, http.MethodPut, base+"/"+p.Metadata.Name, map[string]any{
			"credentials": map[string]string{"COMPAT_UNDECLARED": "s3cr3t-extra"},
		}, "COMPAT_UNDECLARED")
		var after provider
		mustJSON(t, http.MethodGet, base+"/"+p.Metadata.Name, nil, &after, http.StatusOK)
		holds(t, after, first)
	})

	// A profile that declares no credential: what the TUI's generic entry is
	// for. The profile is imported into the workspace, with no credentials.
	t.Run("a profile with no credentials takes no key at all", func(t *testing.T) {
		id := randName("cpf")
		t.Cleanup(func() {
			_, _, _ = do(http.MethodDelete, profilesPath(ws)+"/"+id, nil)
		})
		bare := profileBody(id, "Compat profile without credentials")
		delete(bare, "credentials")
		var imported struct {
			Diagnostics []profileDiagnostic `json:"diagnostics"`
			Imported    bool                `json:"imported"`
		}
		mustJSON(t, http.MethodPost, profilesPath(ws), map[string]any{"profiles": []any{bare}}, &imported, http.StatusCreated)
		if !imported.Imported {
			t.Fatalf("profile %q without credentials was not imported [gateway %s]: %+v", id, gatewayVersion, imported.Diagnostics)
		}

		refusedAsUndeclared(t, http.MethodPost, base,
			providerBody(ws, randName("pv"), id, map[string]string{"COMPAT_ANY_ENV": "s3cr3t-generic"}), "COMPAT_ANY_ENV")

		// It takes a provider with no credentials, and still no key after.
		name := randName("pv")
		t.Cleanup(func() {
			_, _, _ = do(http.MethodDelete, base+"/"+name, nil)
		})
		var p provider
		mustJSON(t, http.MethodPost, base, providerBody(ws, name, id, nil), &p, http.StatusCreated)
		holds(t, p)
		refusedAsUndeclared(t, http.MethodPut, base+"/"+name, map[string]any{
			"credentials": map[string]string{"COMPAT_ANY_ENV": "s3cr3t-generic"},
		}, "COMPAT_ANY_ENV")
	})
}

// TestProviderWithoutProfile is a provider whose type matches no profile any
// more, which the TUI calls legacy or unprofiled.
//
// It comes about without anything going wrong: the OpenShell CLI and TUI
// create a provider naming its own workspace as the profile scope, the gateway
// counts only providers that name no scope as users of a platform profile, and
// so that profile can be deleted from under the provider. The provider stays,
// with its type and its credentials. The dashboard then has no profile to
// build the Edit Provider form from, and offers a field for each credential
// the provider holds; with no profile to check against, the gateway takes a
// new value and an expiry for them.
func TestProviderWithoutProfile(t *testing.T) {
	ws := newWorkspace(t)
	const key = "COMPAT_LEGACY_TOKEN"
	const secret, rotated = "s3cr3t-legacy-value", "r0tated-legacy-value"
	profile := seedPlatformProfile(t, credentialSchema{Name: "token", EnvVars: []string{key}, Required: true})
	base := providersPath(ws)
	name := randName("pv")
	path := base + "/" + name
	t.Cleanup(func() {
		_, _, _ = do(http.MethodDelete, path, nil)
	})

	// As the CLI and the TUI create it: the workspace is the profile scope.
	body := providerBody(ws, name, profile, map[string]string{key: secret})
	body["config"] = map[string]string{"region": "us"}
	mustJSON(t, http.MethodPost, base, body, nil, http.StatusCreated)

	t.Run("the platform profile can be deleted from under it", func(t *testing.T) {
		assertDeleted(t, http.MethodDelete, platformProfilesPath()+"/"+profile)
		var list []providerProfile
		mustJSON(t, http.MethodGet, profilesPath(ws), nil, &list, http.StatusOK)
		for _, p := range list {
			if p.ID == profile {
				t.Fatalf("profile %q is still in workspace %s's list after it was deleted", profile, ws)
			}
		}
	})

	t.Run("the provider stays as it was", func(t *testing.T) {
		var p provider
		mustJSON(t, http.MethodGet, path, nil, &p, http.StatusOK)
		if p.Type != profile || p.ProfileWorkspace != ws || p.Config["region"] != "us" {
			t.Errorf("provider = type %q, profileWorkspace %q, config %v; want type %q, profileWorkspace %q, region=us",
				p.Type, p.ProfileWorkspace, p.Config, profile, ws)
		}
		if len(p.CredentialNames) != 1 || p.CredentialNames[0] != key {
			t.Errorf("credentialNames = %v, want [%s]", p.CredentialNames, key)
		}
	})

	t.Run("a credential it holds takes a new value and an expiry", func(t *testing.T) {
		const expiresAtMs = int64(1893456000000) // 2030-01-01T00:00:00Z
		raw := mustRaw(t, http.MethodPut, path, map[string]any{
			"credentials":           map[string]string{key: rotated},
			"credentialExpiresAtMs": map[string]int64{key: expiresAtMs},
		}, http.StatusOK)
		for _, s := range []string{secret, rotated, "REDACTED"} {
			if bytes.Contains(raw, []byte(s)) {
				t.Errorf("update returned a credential value to the browser: %s", truncate(raw))
			}
		}
		var p provider
		mustJSON(t, http.MethodGet, path, nil, &p, http.StatusOK)
		if len(p.CredentialNames) != 1 || p.CredentialNames[0] != key {
			t.Errorf("credentialNames after rotating = %v, want [%s]", p.CredentialNames, key)
		}
		if got := p.CredentialExpiresAtMs[key]; got != expiresAtMs {
			t.Errorf("credentialExpiresAtMs[%s] = %d, want %d", key, got, expiresAtMs)
		}
		if p.Config["region"] != "us" {
			t.Errorf("config after a credentials-only update = %v, want region=us kept", p.Config)
		}
	})

	t.Run("its refresh status still reads", func(t *testing.T) {
		raw := mustRaw(t, http.MethodGet, path+"/refresh-status", nil, http.StatusOK)
		if string(bytes.TrimSpace(raw)) != "[]" {
			t.Errorf("refresh-status of a provider with no refresh configured = %s, want []", truncate(raw))
		}
	})
}
