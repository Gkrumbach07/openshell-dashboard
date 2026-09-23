//go:build compat

package compat

import (
	"net/http"
	"os"
	"strconv"
	"testing"
	"time"
)

// sandboxImage is the workload image compat sandboxes run. The community base
// image publishes no semver tags, so it is pinned by digest in CI via
// COMPAT_SANDBOX_IMAGE rather than moving with the gateway version.
func sandboxImage() string {
	if v := os.Getenv("COMPAT_SANDBOX_IMAGE"); v != "" {
		return v
	}
	return "ghcr.io/nvidia/openshell-community/sandboxes/base:latest"
}

type sandbox struct {
	Metadata objectMeta `json:"metadata"`
	Status   struct {
		Phase                string `json:"phase"`
		SandboxName          string `json:"sandboxName"`
		ExitCode             *int32 `json:"exitCode"`
		CurrentPolicyVersion uint32 `json:"currentPolicyVersion"`
	} `json:"status"`
}

func basePolicy() map[string]any {
	return map[string]any{
		"version": 1,
		"filesystem": map[string]any{
			"includeWorkdir": true,
			"readOnly":       []string{"/usr"},
			"readWrite":      []string{"/sandbox"},
		},
		"networkPolicies": map[string]any{},
	}
}

// Ports cypress/e2e-integration/sandbox-lifecycle.cy.ts — the one compat test
// that exercises the whole stack: gateway, compute driver, supervisor image
// and the sandbox workload.
func TestSandboxLifecycle(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping full sandbox lifecycle in -short mode")
	}
	name := randName("cs")
	base := "/api/v1/workspaces/default/sandboxes"

	t.Cleanup(func() {
		// Best-effort: the delete subtest normally handles this.
		_, _, _ = do(http.MethodDelete, base+"/"+name, nil)
	})

	t.Run("create", func(t *testing.T) {
		var sb sandbox
		mustJSON(t, http.MethodPost, base, map[string]any{
			"name":   name,
			"image":  sandboxImage(),
			"policy": basePolicy(),
		}, &sb, http.StatusCreated)

		if sb.Metadata.Name != name {
			t.Errorf("metadata.name = %q, want %q", sb.Metadata.Name, name)
		}
		switch sb.Status.Phase {
		case "PROVISIONING", "READY":
		default:
			t.Errorf("phase = %q, want PROVISIONING or READY", sb.Status.Phase)
		}
	})

	t.Run("reaches READY", func(t *testing.T) {
		poll(t, 5*time.Minute, 3*time.Second, "sandbox "+name+" to reach READY", func() (bool, string) {
			var sb sandbox
			status, _, err := do(http.MethodGet, base+"/"+name, nil)
			if err != nil || status != http.StatusOK {
				return false, "get failed"
			}
			if _, err := doJSON(http.MethodGet, base+"/"+name, nil, &sb); err != nil {
				return false, "decode failed"
			}
			switch sb.Status.Phase {
			case "READY":
				return true, "READY"
			case "ERROR":
				exit := "nil"
				if sb.Status.ExitCode != nil {
					exit = strconv.Itoa(int(*sb.Status.ExitCode))
				}
				// Fail fast rather than burning the full timeout.
				t.Fatalf("sandbox entered ERROR [gateway %s], exitCode=%s", gatewayVersion, exit)
				return false, "ERROR"
			default:
				return false, "phase=" + sb.Status.Phase
			}
		})
	})

	// The SDK renamed SandboxStatus.SandboxName; the BFF now fills it from
	// the sandbox's own name. An empty value here means that broke again.
	t.Run("status carries sandboxName", func(t *testing.T) {
		var sb sandbox
		mustJSON(t, http.MethodGet, base+"/"+name, nil, &sb, http.StatusOK)
		if sb.Status.SandboxName != name {
			t.Errorf("status.sandboxName = %q, want %q", sb.Status.SandboxName, name)
		}
	})

	t.Run("appears in list", func(t *testing.T) {
		var list []sandbox
		mustJSON(t, http.MethodGet, base, nil, &list, http.StatusOK)
		for _, sb := range list {
			if sb.Metadata.Name == name {
				return
			}
		}
		t.Errorf("sandbox %q not in list of %d", name, len(list))
	})

	t.Run("logs", func(t *testing.T) {
		// Shape must stay {logs: [...], bufferTotal: n} — models.SandboxLogs.
		// Content is not asserted: an idle sandbox may legitimately be quiet.
		// This proves GetSandboxLogs still resolves the sandbox by name and
		// that the response still decodes into the DTO the frontend reads.
		var logs struct {
			Logs *[]struct {
				Message     string            `json:"message"`
				Level       string            `json:"level"`
				Source      string            `json:"source"`
				TimestampMs int64             `json:"timestampMs"`
				Fields      map[string]string `json:"fields"`
			} `json:"logs"`
			BufferTotal *uint32 `json:"bufferTotal"`
		}
		mustJSON(t, http.MethodGet, base+"/"+name+"/logs?lines=50", nil, &logs, http.StatusOK)
		if logs.Logs == nil {
			t.Error(`logs response has no "logs" key — GetSandboxLogs DTO changed`)
		}
		if logs.BufferTotal == nil {
			t.Error(`logs response has no "bufferTotal" key — GetSandboxLogs DTO changed`)
		}
	})

	t.Run("delete", func(t *testing.T) {
		assertDeleted(t, http.MethodDelete, base+"/"+name)
	})
}
