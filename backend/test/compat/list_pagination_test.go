//go:build compat

package compat

import (
	"net/http"
	"net/url"
	"sort"
	"testing"
)

type gatewayPage[T any] struct {
	Items         []T    `json:"items"`
	NextPageToken string `json:"nextPageToken"`
}

func TestWorkspaceCursorPagination(t *testing.T) {
	tag := randName("page")
	names := []string{randName("pgw"), randName("pgw")}
	for _, name := range names {
		mustJSON(t, http.MethodPost, "/api/v1/workspaces",
			map[string]any{"name": name, "labels": map[string]string{"compat-page": tag}}, nil, http.StatusCreated)
		t.Cleanup(func() { removeWorkspace(name) })
	}

	path := "/api/v1/workspaces?pageSize=1&labelSelector=compat-page%3D" + tag
	var first gatewayPage[workspace]
	mustJSON(t, http.MethodGet, path, nil, &first, http.StatusOK)
	if len(first.Items) != 1 || first.NextPageToken == "" {
		t.Fatalf("first workspace page: %+v, want one item and a token", first)
	}
	var second gatewayPage[workspace]
	mustJSON(t, http.MethodGet, path+"&pageToken="+url.QueryEscape(first.NextPageToken), nil, &second, http.StatusOK)
	if len(second.Items) != 1 || second.NextPageToken != "" {
		t.Fatalf("last workspace page: %+v, want one item and no token", second)
	}
	got := []string{first.Items[0].Metadata.Name, second.Items[0].Metadata.Name}
	sort.Strings(got)
	sort.Strings(names)
	if got[0] != names[0] || got[1] != names[1] {
		t.Errorf("paged workspace names = %v, want %v", got, names)
	}
}

func TestSandboxCursorPaginationAndScope(t *testing.T) {
	requireSandboxes(t)
	pair := newSandboxPair(t)
	selector := "compat-tag%3D" + pair.tag
	path := "/api/v1/sandboxes?pageSize=1&labelSelector=" + selector
	var first gatewayPage[sandbox]
	mustJSON(t, http.MethodGet, path, nil, &first, http.StatusOK)
	if len(first.Items) != 1 || first.NextPageToken == "" {
		t.Fatalf("first all-workspaces sandbox page: %+v, want one item and a token", first)
	}
	var second gatewayPage[sandbox]
	mustJSON(t, http.MethodGet, path+"&pageToken="+url.QueryEscape(first.NextPageToken), nil, &second, http.StatusOK)
	if len(second.Items) != 1 || second.NextPageToken != "" {
		t.Fatalf("last all-workspaces sandbox page: %+v, want one item and no token", second)
	}
	got := []string{first.Items[0].Metadata.Workspace, second.Items[0].Metadata.Workspace}
	sort.Strings(got)
	want := []string{pair.wsA, pair.wsB}
	sort.Strings(want)
	if got[0] != want[0] || got[1] != want[1] {
		t.Errorf("paged sandbox workspaces = %v, want %v", got, want)
	}

	var scoped gatewayPage[sandbox]
	mustJSON(t, http.MethodGet, sandboxesPath(pair.wsA)+"?pageSize=1&labelSelector="+selector, nil, &scoped, http.StatusOK)
	if len(scoped.Items) != 1 || scoped.Items[0].Metadata.Workspace != pair.wsA || scoped.NextPageToken != "" {
		t.Errorf("scoped sandbox page = %+v, want one sandbox in %s and no token", scoped, pair.wsA)
	}
}
