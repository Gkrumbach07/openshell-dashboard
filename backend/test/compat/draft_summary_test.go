//go:build compat

package compat

import (
	"bytes"
	"net/http"
	"testing"
)

// draftSandboxSummary and draftSummary mirror models.DraftSandboxSummary and
// models.DraftSummary.
type draftSandboxSummary struct {
	Workspace        string `json:"workspace"`
	SandboxName      string `json:"sandboxName"`
	PendingCount     int    `json:"pendingCount"`
	HasSecurityFlags bool   `json:"hasSecurityFlags"`
	Unavailable      bool   `json:"unavailable"`
}

type draftSummary struct {
	Sandboxes    []draftSandboxSummary `json:"sandboxes"`
	TotalPending int                   `json:"totalPending"`
}

// entry returns the summary's entry for a sandbox, if it has one.
func (s draftSummary) entry(workspace, name string) (draftSandboxSummary, bool) {
	for _, e := range s.Sandboxes {
		if e.Workspace == workspace && e.SandboxName == name {
			return e, true
		}
	}
	return draftSandboxSummary{}, false
}

// readDraftSummary GETs a summary and checks what holds of every one: the
// list is an array, and the total is the sum of the counts that were read.
func readDraftSummary(t *testing.T, path string) draftSummary {
	t.Helper()
	raw := mustRaw(t, http.MethodGet, path, nil, http.StatusOK)
	// Nothing pending is an empty array, never null: the list page calls
	// sandboxes.find on it.
	if !bytes.Contains(raw, []byte(`"sandboxes":[`)) {
		t.Errorf(`GET %s: want a "sandboxes" array, got: %s`, path, truncate(raw))
	}
	var summary draftSummary
	mustDecode(t, raw, &summary)
	total := 0
	for _, e := range summary.Sandboxes {
		total += e.PendingCount
		if e.Unavailable && e.PendingCount != 0 {
			t.Errorf("GET %s: %s/%s is unavailable and still counts %d pending", path, e.Workspace, e.SandboxName, e.PendingCount)
		}
	}
	if summary.TotalPending != total {
		t.Errorf("GET %s: totalPending = %d, want the sum of the entries, %d", path, summary.TotalPending, total)
	}
	return summary
}

// TestDraftSummary covers the "N pending" badge beside each sandbox in the
// list: the pending draft chunks of every sandbox of a workspace, which the
// BFF collects with one GetDraftPolicy per sandbox, as the TUI does.
//
// A draft chunk is produced only by the in-sandbox supervisor's policy
// analysis, so a compat sandbox has none pending (see TestDraftPolicy). What
// is asserted is that the summary agrees with the sandbox's own inbox, read
// the way the Proposals tab reads it, and that the sandbox is not reported as
// unavailable — which is what a draft read the gateway refused would look
// like. The workspace is not "default", so a summary that ignored the
// workspace would be reading the inbox of a sandbox that does not exist.
func TestDraftSummary(t *testing.T) {
	ws, name := sharedSandbox(t)

	var inbox struct {
		Chunks []struct {
			ID string `json:"id"`
		} `json:"chunks"`
	}
	mustJSON(t, http.MethodGet, sandboxPath(ws, name)+"/drafts?status=pending", nil, &inbox, http.StatusOK)
	pending := len(inbox.Chunks)

	// agrees checks a summary against the shared sandbox's own inbox.
	agrees := func(t *testing.T, path string) {
		t.Helper()
		summary := readDraftSummary(t, path)
		entry, listed := summary.entry(ws, name)
		switch {
		case listed && entry.Unavailable:
			t.Errorf("GET %s [gateway %s]: the pending chunks of %s/%s could not be read — the gateway refused "+
				"the GetDraftPolicy the summary is built from", path, gatewayVersion, ws, name)
		case pending == 0 && listed:
			t.Errorf("GET %s: %s/%s is listed with %d pending, but its inbox is empty", path, ws, name, entry.PendingCount)
		case pending > 0 && (!listed || entry.PendingCount != pending):
			t.Errorf("GET %s: %s/%s = %+v (listed: %v), want %d pending as its inbox says", path, ws, name, entry, listed, pending)
		}
	}

	t.Run("a workspace", func(t *testing.T) {
		path := "/api/v1/workspaces/" + ws + "/draft-summary"
		agrees(t, path)
		for _, e := range readDraftSummary(t, path).Sandboxes {
			if e.Workspace != ws {
				t.Errorf("GET %s lists %s/%s, a sandbox of another workspace", path, e.Workspace, e.SandboxName)
			}
		}
	})

	t.Run("the route outside a workspace, for one workspace", func(t *testing.T) {
		agrees(t, "/api/v1/draft-summary?workspace="+ws)
	})

	// Without a workspace the old route answers what it did before there was
	// a real summary: nothing, and without asking the gateway. Frontends
	// older than the workspace route poll it for every user.
	t.Run("the route outside a workspace, without a workspace, is empty", func(t *testing.T) {
		summary := readDraftSummary(t, "/api/v1/draft-summary")
		if len(summary.Sandboxes) != 0 || summary.TotalPending != 0 {
			t.Errorf("GET /api/v1/draft-summary = %+v, want an empty summary", summary)
		}
	})

	t.Run("a workspace without sandboxes", func(t *testing.T) {
		empty := newWorkspace(t)
		summary := readDraftSummary(t, "/api/v1/workspaces/"+empty+"/draft-summary")
		if len(summary.Sandboxes) != 0 || summary.TotalPending != 0 {
			t.Errorf("summary of an empty workspace = %+v, want no sandboxes and nothing pending", summary)
		}
	})

	t.Run("an unknown workspace is a 404", func(t *testing.T) {
		wantError(t, http.MethodGet, "/api/v1/workspaces/"+randName("nows")+"/draft-summary", nil, http.StatusNotFound, "not_found")
		wantError(t, http.MethodGet, "/api/v1/draft-summary?workspace="+randName("nows"), nil, http.StatusNotFound, "not_found")
	})
}
