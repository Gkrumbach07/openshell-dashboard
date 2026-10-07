//go:build compat

package compat

import (
	"bytes"
	"encoding/json"
	"net/http"
	"sort"
	"strings"
	"testing"
)

// The tests in this file cover the lists that span every workspace: the
// all-workspaces page of the dashboard, and `--all-workspaces` on the CLI's
// sandbox, service, sandbox template and provider lists.
//
// Each one puts a resource of the same name into two workspaces. In a list
// across workspaces the workspace is then the only thing that tells the two
// apart, so an item that came back without it, or with the wrong one, cannot
// pass. The gateway answers these lists for platform admins only; the compat
// stack's gateway allows unauthenticated users and treats them as such.

// scoped is the part every item of an all-workspaces list has: a name and the
// workspace it lives in.
type scoped struct {
	workspace string
	name      string
}

func sortScoped(items []scoped) []scoped {
	sort.Slice(items, func(i, j int) bool {
		if items[i].workspace != items[j].workspace {
			return items[i].workspace < items[j].workspace
		}
		return items[i].name < items[j].name
	})
	return items
}

// inBoth is what a list must hold for one name in two workspaces.
func inBoth(workspaceA, workspaceB, name string) []scoped {
	return sortScoped([]scoped{{workspaceA, name}, {workspaceB, name}})
}

func sameScoped(got, want []scoped) bool {
	if len(got) != len(want) {
		return false
	}
	for i := range got {
		if got[i] != want[i] {
			return false
		}
	}
	return true
}

// countScoped counts the items named name that live in one of the workspaces.
func countScoped(items []scoped, name string, workspaces ...string) int {
	found := 0
	for _, item := range items {
		for _, ws := range workspaces {
			if item.name == name && item.workspace == ws {
				found++
			}
		}
	}
	return found
}

// wantEmptyArray fails unless the list at path is an empty JSON array. Not
// null: the page maps over the response.
func wantEmptyArray(t *testing.T, path string) {
	t.Helper()
	raw := mustRaw(t, http.MethodGet, path, nil, http.StatusOK)
	if got := strings.TrimSpace(string(raw)); got != "[]" {
		t.Errorf("GET %s [gateway %s] = %s, want []", path, gatewayVersion, truncate(raw))
	}
}

// sandboxPair is one sandbox name in two workspaces, both carrying the same
// label.
type sandboxPair struct {
	wsA, wsB string
	name     string
	tag      string
	idA, idB string
}

// newSandboxPair creates the two sandboxes and waits for both to become READY.
//
// Nothing the test asserts needs a running sandbox: a sandbox is listed, and a
// service endpoint can be registered for it, from the moment it is created.
// The wait is for the delete at the end. A sandbox deleted while the gateway
// was still provisioning it was seen, on gateway 0.1.2 with the docker driver,
// to leave a created-but-never-started `openshell-supervisor-extract-…`
// container behind on the host, which nothing removes.
func newSandboxPair(t *testing.T) sandboxPair {
	t.Helper()
	p := sandboxPair{wsA: newWorkspace(t), wsB: newWorkspace(t), name: randName("aw"), tag: randName("tag")}
	labelled := map[string]any{"labels": map[string]string{"compat-tag": p.tag}}
	p.idA = createSandbox(t, p.wsA, p.name, labelled).Metadata.ID
	p.idB = createSandbox(t, p.wsB, p.name, labelled).Metadata.ID
	waitForPhase(t, p.wsA, p.name, "READY")
	waitForPhase(t, p.wsB, p.name, "READY")
	return p
}

// TestAllWorkspacesSandboxes covers the sandboxes and the service endpoints of
// the all-workspaces page.
func TestAllWorkspacesSandboxes(t *testing.T) {
	requireSandboxes(t)
	pair := newSandboxPair(t)
	t.Run("sandboxes", pair.checkSandboxes)
	t.Run("services", pair.checkServices)
}

func (p sandboxPair) checkSandboxes(t *testing.T) {
	list := func(t *testing.T, path string) ([]scoped, map[string]string) {
		t.Helper()
		var sandboxes []sandbox
		mustJSON(t, http.MethodGet, path, nil, &sandboxes, http.StatusOK)
		items := make([]scoped, 0, len(sandboxes))
		ids := map[string]string{}
		for _, sb := range sandboxes {
			items = append(items, scoped{sb.Metadata.Workspace, sb.Metadata.Name})
			ids[sb.Metadata.Workspace] = sb.Metadata.ID
		}
		return sortScoped(items), ids
	}
	selector := "?labelSelector=compat-tag%3D" + p.tag

	t.Run("label selector across workspaces", func(t *testing.T) {
		got, ids := list(t, "/api/v1/sandboxes"+selector)
		if want := inBoth(p.wsA, p.wsB, p.name); !sameScoped(got, want) {
			t.Fatalf("sandboxes labelled compat-tag=%s across workspaces = %v, want exactly %v", p.tag, got, want)
		}
		// The ids are what each workspace-scoped create returned, so the
		// workspace on an item is the one it was really created in.
		if ids[p.wsA] != p.idA || ids[p.wsB] != p.idB {
			t.Errorf("ids by workspace = %v, want %s in %s and %s in %s", ids, p.idA, p.wsA, p.idB, p.wsB)
		}
	})

	t.Run("unfiltered list holds both", func(t *testing.T) {
		got, _ := list(t, "/api/v1/sandboxes")
		if found := countScoped(got, p.name, p.wsA, p.wsB); found != 2 {
			t.Errorf("found %d of the two sandboxes named %s in the list of every workspace, want both", found, p.name)
		}
	})

	t.Run("selector that matches nothing", func(t *testing.T) {
		wantEmptyArray(t, "/api/v1/sandboxes?labelSelector=compat-tag%3Dnot-"+p.tag)
	})

	t.Run("malformed selector is a 400", func(t *testing.T) {
		wantError(t, http.MethodGet, "/api/v1/sandboxes?labelSelector=%3D%3D%3D", nil,
			http.StatusBadRequest, "invalid_argument")
	})

	// The same selector on a workspace's own list still stops at the
	// workspace: the two routes are not one list under two paths.
	t.Run("workspace list stays scoped", func(t *testing.T) {
		got, _ := list(t, sandboxesPath(p.wsA)+selector)
		if want := []scoped{{p.wsA, p.name}}; !sameScoped(got, want) {
			t.Errorf("sandboxes of workspace %s labelled compat-tag=%s = %v, want %v", p.wsA, p.tag, got, want)
		}
	})
}

// scopedEndpoint mirrors models.ServiceEndpoint as an all-workspaces list
// returns it.
type scopedEndpoint struct {
	ID          string `json:"id"`
	Workspace   string `json:"workspace"`
	SandboxID   string `json:"sandboxId"`
	SandboxName string `json:"sandboxName"`
	ServiceName string `json:"serviceName"`
	URL         string `json:"url"`
	TargetPort  uint32 `json:"targetPort"`
	Domain      bool   `json:"domain"`
}

// endpoints lists the service endpoints at path and keeps those of the pair's
// two sandboxes, by workspace.
func (p sandboxPair) endpoints(t *testing.T, path string) map[string][]scopedEndpoint {
	t.Helper()
	var all []scopedEndpoint
	mustJSON(t, http.MethodGet, path, nil, &all, http.StatusOK)
	own := map[string][]scopedEndpoint{}
	for _, e := range all {
		if e.SandboxName == p.name && (e.Workspace == p.wsA || e.Workspace == p.wsB) {
			own[e.Workspace] = append(own[e.Workspace], e)
		}
	}
	return own
}

// checkServices exposes a named service on the sandbox in wsA and the unnamed
// one, which the CLI's `service expose <sandbox> <port>` creates, on the
// sandbox in wsB.
func (p sandboxPair) checkServices(t *testing.T) {
	svc := randName("sv")
	servicesA, servicesB := sandboxPath(p.wsA, p.name)+"/services", sandboxPath(p.wsB, p.name)+"/services"
	t.Cleanup(func() {
		_, _, _ = do(http.MethodDelete, servicesA+"/"+svc, nil)
		_, _, _ = do(http.MethodDelete, servicesB, nil)
	})

	t.Run("expose a named service", func(t *testing.T) {
		var got scopedEndpoint
		mustJSON(t, http.MethodPost, servicesA,
			map[string]any{"service": svc, "targetPort": 8000, "domain": true}, &got, http.StatusCreated)
		if got.ServiceName != svc || got.SandboxName != p.name || got.Workspace != p.wsA || got.TargetPort != 8000 {
			t.Errorf("endpoint = %+v, want service %q on %s/%s port 8000", got, svc, p.wsA, p.name)
		}
	})

	// No service name at all: the body the Expose form sends when the name
	// is left empty.
	t.Run("expose the unnamed service", func(t *testing.T) {
		var got scopedEndpoint
		mustJSON(t, http.MethodPost, servicesB,
			map[string]any{"targetPort": 9000, "domain": true}, &got, http.StatusCreated)
		if got.ServiceName != "" || got.SandboxName != p.name || got.Workspace != p.wsB || got.TargetPort != 9000 {
			t.Errorf("endpoint = %+v, want the unnamed service on %s/%s port 9000", got, p.wsB, p.name)
		}
		if got.SandboxID != p.idB {
			t.Errorf("sandboxId of the endpoint = %q, want the sandbox's id %q", got.SandboxID, p.idB)
		}
		// The gateway enables browser-facing routing on every endpoint,
		// whatever the request says; the Services tab shows this flag.
		if !got.Domain {
			t.Error("domain = false, want true")
		}
	})

	t.Run("services across workspaces", func(t *testing.T) {
		got := p.endpoints(t, "/api/v1/services")
		if len(got[p.wsA]) != 1 || len(got[p.wsB]) != 1 {
			t.Fatalf("endpoints of the two sandboxes named %s across workspaces = %+v, want one in %s and one in %s",
				p.name, got, p.wsA, p.wsB)
		}
		if e := got[p.wsA][0]; e.ServiceName != svc || e.TargetPort != 8000 || e.ID == "" {
			t.Errorf("endpoint in %s = %+v, want service %q on port 8000 with an id", p.wsA, e, svc)
		}
		if e := got[p.wsB][0]; e.ServiceName != "" || e.TargetPort != 9000 || e.ID == "" {
			t.Errorf("endpoint in %s = %+v, want the unnamed service on port 9000 with an id", p.wsB, e)
		}
	})

	// `openshell service list` without a sandbox: every endpoint of one
	// workspace, and none of another's.
	t.Run("services of one workspace", func(t *testing.T) {
		got := p.endpoints(t, "/api/v1/workspaces/"+p.wsA+"/services")
		if len(got[p.wsA]) != 1 || len(got[p.wsB]) != 0 || got[p.wsA][0].ServiceName != svc {
			t.Errorf("endpoints of workspace %s = %+v, want only service %q", p.wsA, got, svc)
		}
	})

	// A sandbox name says nothing without its workspace, so the gateway
	// refuses the filter across workspaces rather than guess.
	t.Run("sandbox filter across workspaces is a 400", func(t *testing.T) {
		wantError(t, http.MethodGet, "/api/v1/services?sandbox="+p.name, nil,
			http.StatusBadRequest, "invalid_argument")
	})

	var outcome string
	t.Run("delete the unnamed service", func(t *testing.T) {
		outcome = assertDeleted(t, http.MethodDelete, servicesB)
	})

	t.Run("unnamed service gone after delete", func(t *testing.T) {
		if !establishesCompletion[outcome] {
			t.Skipf("delete outcome was %q, not a completion — the endpoint may legitimately still be listed", outcome)
		}
		got := p.endpoints(t, "/api/v1/services")
		// The route without a service name deleted the unnamed endpoint of
		// its own sandbox and nothing else.
		if len(got[p.wsB]) != 0 {
			t.Errorf("endpoints left in %s = %+v, want none", p.wsB, got[p.wsB])
		}
		if len(got[p.wsA]) != 1 || got[p.wsA][0].ServiceName != svc {
			t.Errorf("endpoints left in %s = %+v, want service %q untouched", p.wsA, got[p.wsA], svc)
		}
	})
}

// TestAllWorkspacesTemplates covers the templates of the all-workspaces page.
func TestAllWorkspacesTemplates(t *testing.T) {
	wsA, wsB := newWorkspace(t), newWorkspace(t)
	name := randName("at")
	tag := randName("tag")
	for _, ws := range []string{wsA, wsB} {
		base := "/api/v1/workspaces/" + ws + "/templates"
		// The workload TestSandboxTemplates creates, which every supported
		// gateway is known to accept.
		mustJSON(t, http.MethodPost, base, map[string]any{
			"name":   name,
			"labels": map[string]string{"compat-tag": tag},
			"spec": map[string]any{"workload": map[string]any{
				"image":       sandboxImage(),
				"environment": map[string]string{"COMPAT_FROM": "template"},
				"resources":   map[string]string{"cpu": "500m", "memory": "512Mi"},
			}},
		}, nil, http.StatusCreated)
		t.Cleanup(func() { _, _, _ = do(http.MethodDelete, base+"/"+name, nil) })
	}

	list := func(t *testing.T, path string) []scoped {
		t.Helper()
		var templates []sandboxTemplate
		mustJSON(t, http.MethodGet, path, nil, &templates, http.StatusOK)
		items := make([]scoped, 0, len(templates))
		for _, tpl := range templates {
			items = append(items, scoped{tpl.Metadata.Workspace, tpl.Metadata.Name})
		}
		return sortScoped(items)
	}
	selector := "?labelSelector=compat-tag%3D" + tag

	t.Run("label selector across workspaces", func(t *testing.T) {
		got := list(t, "/api/v1/templates"+selector)
		if want := inBoth(wsA, wsB, name); !sameScoped(got, want) {
			t.Errorf("templates labelled compat-tag=%s across workspaces = %v, want exactly %v", tag, got, want)
		}
	})

	t.Run("unfiltered list holds both", func(t *testing.T) {
		if found := countScoped(list(t, "/api/v1/templates"), name, wsA, wsB); found != 2 {
			t.Errorf("found %d of the two templates named %s in the list of every workspace, want both", found, name)
		}
	})

	t.Run("selector that matches nothing", func(t *testing.T) {
		wantEmptyArray(t, "/api/v1/templates?labelSelector=compat-tag%3Dnot-"+tag)
	})

	t.Run("workspace list stays scoped", func(t *testing.T) {
		got := list(t, "/api/v1/workspaces/"+wsB+"/templates"+selector)
		if want := []scoped{{wsB, name}}; !sameScoped(got, want) {
			t.Errorf("templates of workspace %s labelled compat-tag=%s = %v, want %v", wsB, tag, got, want)
		}
	})
}

// TestAllWorkspacesProviders covers the providers of the all-workspaces page,
// including the names of the credentials each one holds. Those are read with
// a second request that has to ask for every workspace as well (see
// pkg/clients/rawprovider_allworkspaces.go), and a credential's value must
// not come back from either.
func TestAllWorkspacesProviders(t *testing.T) {
	wsA, wsB := newWorkspace(t), newWorkspace(t)
	profile := seedPlatformProfile(t, agreeingCredential())
	name := randName("ap")
	secrets := map[string]string{wsA: "s3cr3t-in-a-" + randName("v"), wsB: "s3cr3t-in-b-" + randName("v")}
	for _, ws := range []string{wsA, wsB} {
		base := providersPath(ws)
		mustJSON(t, http.MethodPost, base,
			providerBody("", name, profile, map[string]string{profileCredentialKey: secrets[ws]}), nil, http.StatusCreated)
		t.Cleanup(func() { _, _, _ = do(http.MethodDelete, base+"/"+name, nil) })
	}

	raw := mustRaw(t, http.MethodGet, "/api/v1/providers", nil, http.StatusOK)
	var all []provider
	mustDecode(t, raw, &all)
	var own []provider
	for _, p := range all {
		if p.Metadata.Name == name && (p.Metadata.Workspace == wsA || p.Metadata.Workspace == wsB) {
			own = append(own, p)
		}
	}

	t.Run("both workspaces are listed", func(t *testing.T) {
		items := make([]scoped, 0, len(own))
		for _, p := range own {
			items = append(items, scoped{p.Metadata.Workspace, p.Metadata.Name})
			if p.Type != profile {
				t.Errorf("provider %s/%s has type %q, want %q", p.Metadata.Workspace, name, p.Type, profile)
			}
		}
		if want := inBoth(wsA, wsB, name); !sameScoped(sortScoped(items), want) {
			t.Errorf("providers named %s across workspaces = %v, want exactly %v", name, items, want)
		}
	})

	t.Run("credential names are reported", func(t *testing.T) {
		for _, p := range own {
			if len(p.CredentialNames) != 1 || p.CredentialNames[0] != profileCredentialKey {
				t.Errorf("provider %s/%s: credentialNames = %v, want [%s]",
					p.Metadata.Workspace, name, p.CredentialNames, profileCredentialKey)
			}
		}
	})

	t.Run("no credential value is returned", func(t *testing.T) {
		for _, s := range []string{secrets[wsA], secrets[wsB], "REDACTED"} {
			if bytes.Contains(raw, []byte(s)) {
				t.Errorf("the all-workspaces provider list returned a credential value to the browser: %s", truncate(raw))
			}
		}
	})
}

// TestAllWorkspacesListsReturnArrays is TestListEndpointsReturnArrays for the
// lists across workspaces and for a workspace's service endpoints.
func TestAllWorkspacesListsReturnArrays(t *testing.T) {
	paths := []string{
		"/api/v1/sandboxes",
		"/api/v1/providers",
		"/api/v1/templates",
		"/api/v1/services",
		"/api/v1/workspaces/default/services",
	}
	for _, p := range paths {
		t.Run(strings.TrimPrefix(p, "/api/v1/"), func(t *testing.T) {
			raw := mustRaw(t, http.MethodGet, p, nil, http.StatusOK)
			var arr []json.RawMessage
			if err := json.Unmarshal(raw, &arr); err != nil || arr == nil {
				t.Fatalf("GET %s [gateway %s]: body is not a JSON array (%v); body: %s", p, gatewayVersion, err, truncate(raw))
			}
		})
	}
}
