//go:build compat

package compat

import (
	"fmt"
	"math/rand"
	"net/http"
	"testing"
)

type objectMeta struct {
	Name      string `json:"name"`
	Workspace string `json:"workspace"`
	ID        string `json:"id"`
}

type workspace struct {
	Phase    string     `json:"phase"`
	Metadata objectMeta `json:"metadata"`
}

func randName(prefix string) string {
	const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, 6)
	for i := range b {
		b[i] = alphabet[rand.Intn(len(alphabet))]
	}
	// Gateway enforces a max name length — keep these short.
	return fmt.Sprintf("%s-%s", prefix, string(b))
}

// Ports cypress/e2e-integration/workspace-lifecycle.cy.ts.
func TestWorkspaceLifecycle(t *testing.T) {
	name := randName("cw")

	t.Run("list includes default", func(t *testing.T) {
		// A JSON array here (not a pager envelope) is the contract the
		// frontend depends on; see ListAll in .claude/rules/openshell-api.md.
		var list []workspace
		mustJSON(t, http.MethodGet, "/api/v1/workspaces", nil, &list, http.StatusOK)
		for _, ws := range list {
			if ws.Metadata.Name == "default" {
				return
			}
		}
		t.Fatalf("workspace list has no \"default\" entry; got %d workspaces", len(list))
	})

	t.Run("create", func(t *testing.T) {
		var ws workspace
		mustJSON(t, http.MethodPost, "/api/v1/workspaces",
			map[string]any{"name": name}, &ws, http.StatusCreated)
		if ws.Metadata.Name != name {
			t.Errorf("metadata.name = %q, want %q", ws.Metadata.Name, name)
		}
	})

	t.Run("get", func(t *testing.T) {
		var ws workspace
		mustJSON(t, http.MethodGet, "/api/v1/workspaces/"+name, nil, &ws, http.StatusOK)
		if ws.Metadata.Name != name {
			t.Errorf("metadata.name = %q, want %q", ws.Metadata.Name, name)
		}
	})

	var outcome string
	t.Run("delete", func(t *testing.T) {
		outcome = assertDeleted(t, http.MethodDelete, "/api/v1/workspaces/"+name)
	})

	t.Run("get after delete", func(t *testing.T) {
		if !establishesCompletion[outcome] {
			// The gateway only accepted the delete for asynchronous cleanup,
			// so the workspace may legitimately still be readable.
			t.Skipf("delete outcome was %q, not a completion — skipping the 404 check", outcome)
		}
		status, raw, err := do(http.MethodGet, "/api/v1/workspaces/"+name, nil)
		if err != nil {
			t.Fatalf("get: %v", err)
		}
		if status != http.StatusNotFound {
			t.Errorf("status = %d, want 404 after a completed delete; body: %s", status, truncate(raw))
		}
	})
}
