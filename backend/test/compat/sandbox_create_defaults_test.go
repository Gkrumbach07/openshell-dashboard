//go:build compat

package compat

import (
	"bytes"
	"encoding/json"
	"net/http"
	"os"
	"testing"
	"time"
)

// deleteWhenSettled deletes a sandbox once it has stopped booting. A sandbox
// deleted in the first instants of its boot can leave its container behind on
// the host, so the tests here, which may fail right after a create, give it a
// short while to be READY first. One that does not get there is deleted
// anyway: this is a cleanup, and must not turn a failure into a long wait.
func deleteWhenSettled(workspace, name string) {
	_, _ = awaitPhase(workspace, name, "READY", 20*time.Second)
	_, _, _ = do(http.MethodDelete, sandboxPath(workspace, name), nil)
}

// TestSandboxDefaultImage covers a Create Sandbox form whose image is left
// empty. `openshell sandbox create` without --from sends no image either, and
// the gateway then runs its own default image (the compute driver's). The
// sandbox it returns names the image it chose, which is what the list and the
// detail page show.
//
// The policy is not optional in the same way: gateway 0.1.2 accepts a create
// without one, but that sandbox's configuration is rejected and it never
// becomes ready, so the BFF goes on requiring a policy. That refusal is the
// BFF's own and is covered by its unit tests.
func TestSandboxDefaultImage(t *testing.T) {
	requireSandboxes(t)
	ws := newWorkspace(t)
	name := randName("di")

	var created sandbox
	mustJSON(t, http.MethodPost, sandboxesPath(ws), map[string]any{
		"name":   name,
		"policy": basePolicy(),
	}, &created, http.StatusCreated)
	t.Cleanup(func() { deleteWhenSettled(ws, name) })

	if created.Spec.Image == "" {
		t.Errorf("spec.image is empty in the answer to a create without an image [gateway %s] — the gateway "+
			"no longer says which image it chose, and the dashboard would show none", gatewayVersion)
	}
	ready := waitForPhase(t, ws, name, "READY")
	if ready.Spec.Image == "" || ready.Spec.Image != created.Spec.Image {
		t.Errorf("spec.image = %q once READY, want the image the create answered with, %q", ready.Spec.Image, created.Spec.Image)
	}
	t.Logf("gateway %s default sandbox image: %s", gatewayVersion, ready.Spec.Image)
}

// TestSandboxTemplateDefaultImage covers a workload template created without
// an image, which `openshell sandbox template create` without --image makes
// and lists as "<default>". The template keeps no image, and a sandbox
// created from it runs the gateway's default one.
//
// What the gateway does require of a template is its workload. The BFF sends
// a template without one as it is, and the gateway's refusal comes back.
func TestSandboxTemplateDefaultImage(t *testing.T) {
	ws := newWorkspace(t)
	name := randName("td")
	sb := randName("fd")
	templates := "/api/v1/workspaces/" + ws + "/templates"
	t.Cleanup(func() { _, _, _ = do(http.MethodDelete, templates+"/"+name, nil) })

	t.Run("a template without a workload is refused by the gateway", func(t *testing.T) {
		refused := randName("td")
		t.Cleanup(func() { _, _, _ = do(http.MethodDelete, templates+"/"+refused, nil) })
		wantError(t, http.MethodPost, templates, map[string]any{
			"name": refused,
			"spec": map[string]any{},
		}, http.StatusBadRequest, "invalid_argument")
		wantError(t, http.MethodGet, templates+"/"+refused, nil, http.StatusNotFound, "not_found")
	})

	t.Run("create without an image", func(t *testing.T) {
		var tpl sandboxTemplate
		mustJSON(t, http.MethodPost, templates, map[string]any{
			"name": name,
			"spec": map[string]any{
				"workload": map[string]any{"environment": map[string]string{"COMPAT_FROM": "default-image"}},
			},
		}, &tpl, http.StatusCreated)
		if tpl.Spec.Workload == nil || tpl.Spec.Workload.Image != "" {
			t.Errorf("created template workload = %+v, want one without an image", tpl.Spec.Workload)
		}
	})

	t.Run("the stored template still has no image", func(t *testing.T) {
		var tpl sandboxTemplate
		mustJSON(t, http.MethodGet, templates+"/"+name, nil, &tpl, http.StatusOK)
		if tpl.Spec.Workload == nil || tpl.Spec.Workload.Image != "" {
			t.Errorf("stored template workload = %+v, want one without an image: the default is resolved when "+
				"a sandbox is created, not when the template is", tpl.Spec.Workload)
		}
		if tpl.Spec.Workload != nil && tpl.Spec.Workload.Environment["COMPAT_FROM"] != "default-image" {
			t.Errorf("stored template environment = %v, want COMPAT_FROM=default-image", tpl.Spec.Workload.Environment)
		}
	})

	t.Run("a sandbox from it runs the gateway's default image", func(t *testing.T) {
		requireSandboxes(t)
		var created sandbox
		mustJSON(t, http.MethodPost, sandboxesPath(ws)+"/from-template", map[string]any{
			"name":         sb,
			"templateName": name,
			"policy":       basePolicy(),
		}, &created, http.StatusCreated)
		t.Cleanup(func() { deleteWhenSettled(ws, sb) })

		if created.Spec.Image == "" {
			t.Errorf("spec.image is empty for a sandbox created from a template without an image [gateway %s]", gatewayVersion)
		}
		if created.CreatedFromWorkloadTemplate == nil || created.CreatedFromWorkloadTemplate.Name != name {
			t.Errorf("createdFromWorkloadTemplate = %+v, want the template %q", created.CreatedFromWorkloadTemplate, name)
		}
		ready := waitForPhase(t, ws, sb, "READY")
		if ready.Spec.Environment["COMPAT_FROM"] != "default-image" {
			t.Errorf("spec.environment = %v, want the template's COMPAT_FROM=default-image", ready.Spec.Environment)
		}
	})
}

// policyPresetsFile holds the starter policies of the Create Sandbox form, the
// same ones as frontend/src/components/policy/policyTemplates.ts. A frontend
// unit test fails when the two differ, so what is proven here is proven of the
// form.
const policyPresetsFile = "testdata/policy_presets.json"

type policyPreset struct {
	ID     string          `json:"id"`
	Policy json.RawMessage `json:"policy"`
}

func loadPolicyPresets(t *testing.T) []policyPreset {
	t.Helper()
	raw, err := os.ReadFile(policyPresetsFile)
	if err != nil {
		t.Fatalf("read %s: %v — it is the copy of the Create Sandbox form's starter policies this test checks", policyPresetsFile, err)
	}
	var presets []policyPreset
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&presets); err != nil {
		t.Fatalf("decode %s: %v", policyPresetsFile, err)
	}
	if len(presets) == 0 {
		t.Fatalf("%s holds no presets, so this test would pass having checked nothing", policyPresetsFile)
	}
	seen := map[string]bool{}
	for _, preset := range presets {
		if preset.ID == "" || len(preset.Policy) == 0 || seen[preset.ID] {
			t.Fatalf("%s: every preset needs an id of its own and a policy; got id %q", policyPresetsFile, preset.ID)
		}
		seen[preset.ID] = true
	}
	return presets
}

// TestPolicyPresets creates a sandbox from every starter policy the Create
// Sandbox form offers and waits for it to be READY.
//
// The gateway validates a policy when the sandbox is created (hosts, ports,
// wildcard shapes), and the sandbox validates it again when it loads it. A
// preset that fails either can never create a sandbox, and nothing short of a
// real gateway says so: the "Web egress (audit)" preset this form used to have
// allowed the host `**`, which gateway 0.1.2 refuses ("recursive '**' is only
// allowed as the entire first label"), and every unit test passed.
//
// The sandboxes are booted one after another, each deleted before the next.
func TestPolicyPresets(t *testing.T) {
	requireSandboxes(t)
	presets := loadPolicyPresets(t)
	ws := newWorkspace(t)
	for _, preset := range presets {
		t.Run(preset.ID, func(t *testing.T) {
			name := randName("pp")
			status, raw, err := do(http.MethodPost, sandboxesPath(ws), map[string]any{
				"name":   name,
				"image":  sandboxImage(),
				"policy": preset.Policy,
			})
			if err != nil {
				t.Fatalf("create with preset %q [gateway %s]: %v", preset.ID, gatewayVersion, err)
			}
			if status != http.StatusCreated {
				t.Fatalf("the gateway refused the %q preset of the Create Sandbox form [gateway %s]: status = %d; body: %s",
					preset.ID, gatewayVersion, status, truncate(raw))
			}
			// Deleted before the next preset boots, not when the test ends.
			defer deleteWhenSettled(ws, name)

			ready := waitForPhase(t, ws, name, "READY")
			if ready.Status.CurrentPolicyVersion == 0 {
				t.Errorf("preset %q: the sandbox is READY with no policy version loaded", preset.ID)
			}
		})
	}
}
