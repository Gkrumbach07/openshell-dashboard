//go:build compat

package compat

import (
	"net/http"
	"reflect"
	"testing"
)

// sandboxTemplate mirrors models.SandboxTemplate.
type sandboxTemplate struct {
	Spec struct {
		Workload *struct {
			Resources *struct {
				CPU    string `json:"cpu"`
				Memory string `json:"memory"`
			} `json:"resources"`
			Environment map[string]string `json:"environment"`
			Image       string            `json:"image"`
		} `json:"workload"`
		DesiredServiceLevel *struct {
			Startup *struct {
				ReadyWithinMs int64  `json:"readyWithinMs"`
				MaxBurst      uint32 `json:"maxBurst"`
			} `json:"startup"`
		} `json:"desiredServiceLevel"`
	} `json:"spec"`
	Metadata objectMeta `json:"metadata"`
}

// TestSandboxTemplates covers the Templates tab and the create-from-template
// modal: a reusable workload template, and a sandbox whose image and
// environment come from it.
//
// Templates are a set of RPCs of their own (gateway 0.0.116 does not have them
// at all), and create-from-template rides on CreateSandboxRequest, the message
// whose field renumbering is what broke 0.0.116. Both make this one of the
// paths most exposed to a wire change.
func TestSandboxTemplates(t *testing.T) {
	ws := newWorkspace(t)
	name := randName("tp")
	sb := randName("ft")
	// orphan is the sandbox the "unknown template" request asks for. It must
	// not come into being, but a gateway that ignored the template name would
	// create it, so it is cleaned up all the same.
	orphan := randName("ft")
	tag := randName("tag")
	base := "/api/v1/workspaces/" + ws + "/templates"
	// Registered here rather than in the subtest that creates the sandbox: a
	// subtest's cleanups run when it returns, and later subtests still need
	// the sandbox.
	t.Cleanup(func() {
		_, _, _ = do(http.MethodDelete, sandboxPath(ws, sb), nil)
		_, _, _ = do(http.MethodDelete, sandboxPath(ws, orphan), nil)
		_, _, _ = do(http.MethodDelete, base+"/"+name, nil)
	})

	body := map[string]any{
		"name":        name,
		"labels":      map[string]string{"compat-tag": tag},
		"annotations": map[string]string{"compat/purpose": "template test"},
		"spec": map[string]any{
			"workload": map[string]any{
				"image":       sandboxImage(),
				"environment": map[string]string{"COMPAT_FROM": "template"},
				"resources":   map[string]string{"cpu": "500m", "memory": "512Mi"},
			},
			// `sandbox template create --ready-within 30s --max-burst 2`. The
			// duration crosses the wire as a protobuf Duration.
			"desiredServiceLevel": map[string]any{
				"startup": map[string]any{"readyWithinMs": 30000, "maxBurst": 2},
			},
		},
	}
	check := func(t *testing.T, what string, tpl sandboxTemplate) {
		t.Helper()
		if tpl.Metadata.Name != name || tpl.Metadata.Workspace != ws {
			t.Errorf("%s: template = %q in %q, want %q in %q", what, tpl.Metadata.Name, tpl.Metadata.Workspace, name, ws)
		}
		if tpl.Metadata.Labels["compat-tag"] != tag || tpl.Metadata.Annotations["compat/purpose"] != "template test" {
			t.Errorf("%s: labels = %v, annotations = %v; want the ones the template was created with",
				what, tpl.Metadata.Labels, tpl.Metadata.Annotations)
		}
		w := tpl.Spec.Workload
		if w == nil {
			t.Fatalf("%s: template has no spec.workload", what)
		}
		if w.Image != sandboxImage() || w.Environment["COMPAT_FROM"] != "template" {
			t.Errorf("%s: workload image = %q, environment = %v; want %q and COMPAT_FROM=template",
				what, w.Image, w.Environment, sandboxImage())
		}
		if w.Resources == nil || w.Resources.CPU != "500m" || w.Resources.Memory != "512Mi" {
			t.Errorf("%s: workload resources = %+v, want cpu 500m and memory 512Mi", what, w.Resources)
		}
		level := tpl.Spec.DesiredServiceLevel
		if level == nil || level.Startup == nil || level.Startup.ReadyWithinMs != 30000 || level.Startup.MaxBurst != 2 {
			t.Errorf("%s: desiredServiceLevel = %+v, want a startup ready within 30000 ms with a burst of 2", what, level)
		}
	}

	t.Run("create", func(t *testing.T) {
		var tpl sandboxTemplate
		mustJSON(t, http.MethodPost, base, body, &tpl, http.StatusCreated)
		check(t, "create", tpl)
	})

	t.Run("creating twice is a conflict", func(t *testing.T) {
		wantError(t, http.MethodPost, base, body, http.StatusConflict, "already_exists")
	})

	t.Run("get", func(t *testing.T) {
		var tpl sandboxTemplate
		mustJSON(t, http.MethodGet, base+"/"+name, nil, &tpl, http.StatusOK)
		check(t, "get", tpl)
	})

	t.Run("list and label selector", func(t *testing.T) {
		for query, want := range map[string]int{
			"":                                       1,
			"?labelSelector=compat-tag%3D" + tag:     1,
			"?labelSelector=compat-tag%3Dnot-" + tag: 0,
		} {
			var list []sandboxTemplate
			mustJSON(t, http.MethodGet, base+query, nil, &list, http.StatusOK)
			if len(list) != want {
				t.Errorf("GET templates%s returned %d templates, want %d", query, len(list), want)
			}
		}
	})

	t.Run("unknown template is a 404", func(t *testing.T) {
		wantError(t, http.MethodGet, base+"/no-such-template", nil, http.StatusNotFound, "not_found")
		wantError(t, http.MethodPost, sandboxesPath(ws)+"/from-template", map[string]any{
			"name": orphan, "templateName": "no-such-template", "policy": basePolicy(),
		}, http.StatusNotFound, "not_found")
	})

	t.Run("create sandbox from template", func(t *testing.T) {
		requireSandboxes(t)
		// The request carries governance and what a template does not hold:
		// the sandbox's own labels and annotations, its main command and a
		// service to expose. The image and the environment asserted below
		// were never sent: they can only come from the template.
		command := []string{"sh", "-c", "exec sleep infinity"}
		var created sandbox
		mustJSON(t, http.MethodPost, sandboxesPath(ws)+"/from-template", map[string]any{
			"name":             sb,
			"templateName":     name,
			"policy":           basePolicy(),
			"labels":           map[string]string{"compat-tag": tag},
			"annotations":      map[string]string{"compat/purpose": "from template"},
			"command":          command,
			"serviceExposures": []map[string]any{{"targetPort": 8000}},
		}, &created, http.StatusCreated)
		if created.Metadata.Name != sb || created.Metadata.Labels["compat-tag"] != tag {
			t.Errorf("created sandbox = %q with labels %v, want %q labelled compat-tag=%s",
				created.Metadata.Name, created.Metadata.Labels, sb, tag)
		}
		if got := created.Metadata.Annotations["compat/purpose"]; got != "from template" {
			t.Errorf("annotation compat/purpose = %q, want %q; annotations: %v", got, "from template", created.Metadata.Annotations)
		}
		if created.Spec.Image != sandboxImage() || created.Spec.Environment["COMPAT_FROM"] != "template" {
			t.Errorf("sandbox spec image = %q, environment = %v; want the template's %q and COMPAT_FROM=template",
				created.Spec.Image, created.Spec.Environment, sandboxImage())
		}
		if !reflect.DeepEqual(created.Spec.Command, command) {
			t.Errorf("spec.command = %q, want %q", created.Spec.Command, command)
		}
		if created.ServiceURLs[""] == "" {
			t.Errorf("serviceUrls = %v, want a URL for the unnamed service exposed with the sandbox", created.ServiceURLs)
		}
		// The sandbox page names the template a sandbox was made from.
		if from := created.CreatedFromWorkloadTemplate; from == nil || from.Name != name {
			t.Errorf("createdFromWorkloadTemplate = %+v, want template %q", from, name)
		}
		// The template's CPU and memory become the sandbox's limits, which is
		// where the sandbox page reads them.
		var limits any
		if tpl := created.Spec.Template; tpl != nil {
			limits = tpl.Resources["limits"]
		}
		if want := map[string]any{"cpu": "500m", "memory": "512Mi"}; !reflect.DeepEqual(limits, want) {
			t.Errorf("spec.template.resources.limits = %v, want the template's %v", limits, want)
		}
		// A workload the gateway resolved from a template has to actually run.
		waitForPhase(t, ws, sb, "READY")
	})

	var outcome string
	t.Run("delete", func(t *testing.T) {
		outcome = assertDeleted(t, http.MethodDelete, base+"/"+name)
	})

	t.Run("gone after delete", func(t *testing.T) {
		if !establishesCompletion[outcome] {
			t.Skipf("delete outcome was %q, not a completion — skipping the 404 check", outcome)
		}
		wantError(t, http.MethodGet, base+"/"+name, nil, http.StatusNotFound, "not_found")
	})

	// A template is only read at creation: deleting it must not take the
	// sandboxes made from it along.
	t.Run("sandbox outlives its template", func(t *testing.T) {
		requireSandboxes(t)
		if got := getSandbox(t, ws, sb); got.Status.Phase != "READY" {
			t.Errorf("sandbox %s is %s after its template was deleted, want READY", sb, got.Status.Phase)
		}
	})
}
