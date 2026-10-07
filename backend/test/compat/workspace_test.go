//go:build compat

package compat

import (
	"fmt"
	"math/rand"
	"net/http"
	"net/url"
	"testing"
	"time"
)

type objectMeta struct {
	Labels          map[string]string `json:"labels"`
	Annotations     map[string]string `json:"annotations"`
	Name            string            `json:"name"`
	Workspace       string            `json:"workspace"`
	ID              string            `json:"id"`
	ResourceVersion uint64            `json:"resourceVersion"`
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

// newWorkspace creates a throwaway workspace and removes it when the test
// ends. Cleanups run last-in first-out, so anything a test creates inside it
// afterwards is deleted before the workspace is.
func newWorkspace(t *testing.T) string {
	t.Helper()
	name := randName("cw")
	mustJSON(t, http.MethodPost, "/api/v1/workspaces", map[string]any{"name": name}, nil, http.StatusCreated)
	t.Cleanup(func() { removeWorkspace(name) })
	return name
}

// removeWorkspace deletes a workspace, retrying while the gateway still
// refuses. A workspace cannot be deleted while it holds resources, and a
// sandbox delete may only have been accepted for asynchronous cleanup, so the
// first attempt right after a test is often a 409.
func removeWorkspace(name string) {
	deadline := time.Now().Add(time.Minute)
	for time.Now().Before(deadline) {
		status, _, err := do(http.MethodDelete, "/api/v1/workspaces/"+name, nil)
		if err == nil && (status == http.StatusOK || status == http.StatusNotFound) {
			return
		}
		time.Sleep(time.Second)
	}
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

// TestWorkspaceLabels covers the labels a workspace is created with and the
// labelSelector filter on the workspace list.
func TestWorkspaceLabels(t *testing.T) {
	name := randName("cw")
	tag := randName("tag")
	var created workspace
	mustJSON(t, http.MethodPost, "/api/v1/workspaces",
		map[string]any{"name": name, "labels": map[string]string{"compat-tag": tag}}, &created, http.StatusCreated)
	t.Cleanup(func() { removeWorkspace(name) })

	if got := created.Metadata.Labels["compat-tag"]; got != tag {
		t.Errorf("label compat-tag on the created workspace = %q, want %q", got, tag)
	}

	var matching []workspace
	mustJSON(t, http.MethodGet, "/api/v1/workspaces?labelSelector=compat-tag%3D"+tag, nil, &matching, http.StatusOK)
	if len(matching) != 1 || matching[0].Metadata.Name != name {
		t.Errorf("workspaces matching compat-tag=%s = %d entries, want exactly %q", tag, len(matching), name)
	}

	// "default" carries no such label, so a selector the gateway ignored
	// would return it.
	var none []workspace
	mustJSON(t, http.MethodGet, "/api/v1/workspaces?labelSelector=compat-tag%3Dnot-"+tag, nil, &none, http.StatusOK)
	if len(none) != 0 {
		t.Errorf("workspaces matching a label nobody has = %d entries, want none", len(none))
	}

	// The workspace list's filter box sends what the user typed. A selector
	// that is not key=value pairs has to come back as a 400 the page can show
	// beside the box, not as an empty list or a 500.
	wantError(t, http.MethodGet, "/api/v1/workspaces?labelSelector=compat-tag", nil,
		http.StatusBadRequest, "invalid_argument")

	// The detail page shows what `openshell workspace get` prints: the id, the
	// resource version and the creation time beside the labels. The id and
	// the creation time are set when the workspace is created.
	var got struct {
		Metadata struct {
			Labels          map[string]string `json:"labels"`
			ID              string            `json:"id"`
			CreatedAtMs     int64             `json:"createdAtMs"`
			ResourceVersion uint64            `json:"resourceVersion"`
		} `json:"metadata"`
	}
	mustJSON(t, http.MethodGet, "/api/v1/workspaces/"+name, nil, &got, http.StatusOK)
	t.Logf("workspace metadata: %+v", got.Metadata)
	if got.Metadata.ID == "" || got.Metadata.ID != created.Metadata.ID || got.Metadata.CreatedAtMs <= 0 {
		t.Errorf("workspace metadata = %+v, want the id it was created with (%q) and a creation time",
			got.Metadata, created.Metadata.ID)
	}
	if got.Metadata.Labels["compat-tag"] != tag {
		t.Errorf("label compat-tag on the fetched workspace = %q, want %q", got.Metadata.Labels["compat-tag"], tag)
	}
}

// workspaceMember mirrors models.WorkspaceMember.
type workspaceMember struct {
	PrincipalSubject string `json:"principalSubject"`
	Role             string `json:"role"`
}

// TestWorkspaceMembers covers the Members tab: add, list, change a role and
// remove.
func TestWorkspaceMembers(t *testing.T) {
	ws := newWorkspace(t)
	membersPath := "/api/v1/workspaces/" + ws + "/members"

	// A subject is an OIDC sub claim, which is free-form. This one carries
	// the characters that have to survive the URL path on remove.
	const user, admin = "alice@example.com", "oidc:issuer/bob|42"

	roles := func(t *testing.T) map[string]string {
		t.Helper()
		var members []workspaceMember
		mustJSON(t, http.MethodGet, membersPath, nil, &members, http.StatusOK)
		out := make(map[string]string, len(members))
		for _, m := range members {
			out[m.PrincipalSubject] = m.Role
		}
		return out
	}
	add := func(t *testing.T, subject, role string) {
		t.Helper()
		var m workspaceMember
		mustJSON(t, http.MethodPost, membersPath,
			map[string]any{"principalSubject": subject, "role": role}, &m, http.StatusCreated)
		if m.PrincipalSubject != subject || m.Role != role {
			t.Errorf("added member = %+v, want %s as %s", m, subject, role)
		}
	}
	remove := func(t *testing.T, subject string) {
		t.Helper()
		var res struct {
			Removed bool `json:"removed"`
		}
		mustJSON(t, http.MethodDelete, membersPath+"/"+url.PathEscape(subject), nil, &res, http.StatusOK)
		if !res.Removed {
			t.Errorf("remove %s: removed = false, want true", subject)
		}
	}

	t.Run("add", func(t *testing.T) {
		add(t, user, "USER")
		add(t, admin, "ADMIN")
	})

	t.Run("list", func(t *testing.T) {
		got := roles(t)
		if got[user] != "USER" || got[admin] != "ADMIN" {
			t.Errorf("members = %v, want %s as USER and %s as ADMIN", got, user, admin)
		}
	})

	t.Run("adding twice is a conflict", func(t *testing.T) {
		wantError(t, http.MethodPost, membersPath,
			map[string]any{"principalSubject": user, "role": "USER"}, http.StatusConflict, "already_exists")
	})

	// There is no update-role RPC: a role is changed by removing the member
	// and adding them back.
	t.Run("change role by remove and add", func(t *testing.T) {
		remove(t, user)
		add(t, user, "ADMIN")
		if got := roles(t)[user]; got != "ADMIN" {
			t.Errorf("role of %s after remove and add = %q, want ADMIN", user, got)
		}
	})

	t.Run("remove", func(t *testing.T) {
		remove(t, user)
		remove(t, admin)
		if got := roles(t); len(got) != 0 {
			t.Errorf("members after removing everyone = %v, want none", got)
		}
	})

	t.Run("removing a non-member is a 404", func(t *testing.T) {
		wantError(t, http.MethodDelete, membersPath+"/"+url.PathEscape(user), nil, http.StatusNotFound, "not_found")
	})

	t.Run("unknown workspace is a 404", func(t *testing.T) {
		wantError(t, http.MethodGet, "/api/v1/workspaces/no-such-workspace/members", nil,
			http.StatusNotFound, "not_found")
	})
}
