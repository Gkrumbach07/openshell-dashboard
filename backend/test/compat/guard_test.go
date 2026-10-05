//go:build compat

package compat

import (
	"go/ast"
	"go/parser"
	"go/token"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// The tests in this file check the suite's own guards: the decisions that keep
// it from damaging a gateway it does not have to itself, from skipping where
// it should fail, and from waiting where waiting cannot help. They are the
// only tests here that do not drive the gateway. Each decision is exercised
// against canned answers, because the situations they exist for (somebody
// else's global policy, a settings list that no longer decodes, a gateway that
// cannot boot a sandbox) are the ones a healthy compat stack never produces.

// withFakeBFF points the suite at a stand-in BFF for the rest of the test.
// Tests run one after another, so swapping the package's address is safe.
func withFakeBFF(t *testing.T, handler http.HandlerFunc) {
	t.Helper()
	srv := httptest.NewServer(handler)
	actual := bffURL
	bffURL = srv.URL
	t.Cleanup(func() {
		bffURL = actual
		srv.Close()
	})
}

func settingsOf(pairs ...string) gatewaySettings {
	var s gatewaySettings
	for i := 0; i+1 < len(pairs); i += 2 {
		s.Settings = append(s.Settings, struct {
			Key   string `json:"key"`
			Value string `json:"value"`
		}{pairs[i], pairs[i+1]})
	}
	return s
}

// TestGuardSettingWrite pins what TestGlobalSettings concludes from the
// settings it reads before writing.
func TestGuardSettingWrite(t *testing.T) {
	const key = "proposal_approval_mode"
	cases := []struct {
		name   string
		reason string
		listed gatewaySettings
		want   verdict
	}{
		{
			name:   "listed and unset may be written",
			listed: settingsOf("ocsf_json_enabled", "", key, ""),
			want:   proceed,
		},
		{
			// The reviewed version skipped here and the lane stayed green
			// while the Settings page was blank.
			name:   "an empty list is a failure, not a skip",
			listed: settingsOf(),
			want:   broken,
			reason: "listed no settings at all",
		},
		{
			// The reviewed version overwrote the value and then unset it.
			name:   "a value somebody else set is left alone",
			listed: settingsOf("ocsf_json_enabled", "", key, "auto"),
			want:   standDown,
			reason: `already set to "auto"`,
		},
		{
			name:   "even when it equals what the test would write",
			listed: settingsOf(key, "manual"),
			want:   standDown,
			reason: `already set to "manual"`,
		},
		{
			name:   "a key this gateway does not offer",
			listed: settingsOf("ocsf_json_enabled", ""),
			want:   standDown,
			reason: "does not offer",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, reason := settingWriteVerdict(tc.listed, key)
			if got != tc.want {
				t.Errorf("verdict = %d (%q), want %d", got, reason, tc.want)
			}
			if !strings.Contains(reason, tc.reason) {
				t.Errorf("reason = %q, want it to mention %q", reason, tc.reason)
			}
		})
	}
}

// TestGuardGlobalPolicyInForce pins how TestGlobalPolicy tells a gateway with
// a global policy from one without. The statuses are the ones gateway 0.1.2
// reports: LOADED while a policy is set, SUPERSEDED for every revision once it
// has been removed.
func TestGuardGlobalPolicyInForce(t *testing.T) {
	view := func(statuses ...string) policyView {
		var v policyView
		// Newest first, the way the gateway lists them.
		for i, status := range statuses {
			v.Revisions = append(v.Revisions, policyRevision{Version: uint32(len(statuses) - i), Status: status})
		}
		if len(v.Revisions) > 0 {
			v.Latest = &v.Revisions[0]
			// The BFF reports the newest revision as active whatever its
			// status, which is why activeVersion cannot be the test.
			v.ActiveVersion = v.Revisions[0].Version
		}
		return v
	}
	cases := []struct {
		name string
		view policyView
		want uint32 // version in force, 0 for none
	}{
		{"a gateway that never had one", view(), 0},
		{"one that was set and removed", view("SUPERSEDED", "SUPERSEDED"), 0},
		{"one in force", view("LOADED", "SUPERSEDED"), 2},
		{"one still loading", view("PENDING"), 1},
		{"one that failed to load is still somebody's", view("FAILED", "SUPERSEDED"), 2},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var got uint32
			if rev := globalPolicyInForce(tc.view); rev != nil {
				got = rev.Version
			}
			if got != tc.want {
				t.Errorf("revision in force = v%d, want v%d (0 means none)", got, tc.want)
			}
		})
	}
}

// TestGuardForeignSandboxes pins how the suite recognizes a gateway it does
// not have to itself: any sandbox, in any workspace, that this process did not
// create.
func TestGuardForeignSandboxes(t *testing.T) {
	mine, theirs, alsoMine := randName("own"), randName("oth"), randName("own")
	notASandbox := randName("pv")
	t.Cleanup(func() {
		delete(ownSandboxes, "default/"+mine)
		delete(ownSandboxes, "team-a/"+alsoMine)
	})

	named := func(names ...string) string {
		items := make([]string, 0, len(names))
		for _, n := range names {
			items = append(items, `{"metadata":{"name":"`+n+`"}}`)
		}
		return "[" + strings.Join(items, ",") + "]"
	}
	sandboxesIn := map[string]string{
		"default": named(mine, theirs),
		"team-a":  named(alsoMine),
		"empty":   "[]",
	}
	withFakeBFF(t, func(w http.ResponseWriter, r *http.Request) {
		const prefix = "/api/v1/workspaces"
		if r.Method == http.MethodPost {
			// A create that fails: the sandbox it names is this run's all the same.
			http.Error(w, `{"code":"internal_error","message":"boom"}`, http.StatusInternalServerError)
			return
		}
		if r.URL.Path == prefix {
			// "gone" is listed but deleted before its sandboxes are read.
			_, _ = w.Write([]byte(named("default", "team-a", "empty", "gone")))
			return
		}
		ws := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, prefix+"/"), "/sandboxes")
		body, ok := sandboxesIn[ws]
		if !ok {
			http.Error(w, `{"code":"not_found","message":"workspace not found"}`, http.StatusNotFound)
			return
		}
		_, _ = w.Write([]byte(body))
	})

	// The suite's own sandboxes are the ones it asked for, by either route.
	// Nothing else it creates counts, whatever it is called.
	_, _, _ = do(http.MethodPost, sandboxesPath("default"), map[string]any{"name": mine})
	_, _, _ = do(http.MethodPost, sandboxesPath("team-a")+"/from-template", map[string]any{"name": alsoMine})
	_, _, _ = do(http.MethodPost, providersPath("default"), map[string]any{"name": notASandbox})
	if !ownSandboxes["default/"+mine] || !ownSandboxes["team-a/"+alsoMine] {
		t.Fatalf("a sandbox create sent through the harness was not recorded as this run's own: %v", ownSandboxes)
	}
	if ownSandboxes["default/"+notASandbox] {
		t.Errorf("a provider create was recorded as a sandbox of this run")
	}

	if got, want := foreignSandboxes(t), []string{"default/" + theirs}; !reflect.DeepEqual(got, want) {
		t.Errorf("foreign sandboxes = %v, want %v", got, want)
	}
	if reason := sharedWithOthers(t); !strings.Contains(reason, "default/"+theirs) {
		t.Errorf("reason = %q, want it to name default/%s", reason, theirs)
	}

	// The same name in another workspace is somebody else's sandbox.
	if got := notOwn([]string{"team-b/" + mine}); len(got) != 1 {
		t.Errorf("a sandbox with this run's name in another workspace was taken for its own: %v", got)
	}

	// With only this run's sandboxes left, the gateway is the suite's own.
	sandboxesIn["default"] = named(mine)
	if reason := sharedWithOthers(t); reason != "" {
		t.Errorf("a gateway holding only this run's sandboxes is reported as shared: %s", reason)
	}
}

// TestGuardReadyLatch pins the behavior that keeps a gateway which cannot
// boot sandboxes from running the suite into `go test -timeout`: the first
// sandbox that never becomes READY is waited for, and no later one is.
func TestGuardReadyLatch(t *testing.T) {
	// The real run's memory is put aside and handed back, so that this test
	// neither sees what earlier tests recorded nor leaves its own behind.
	savedFailure, savedFirst, savedReady := bootFailure, firstNotReady, everReady
	bootFailure, firstNotReady, everReady = "", "", false
	t.Cleanup(func() { bootFailure, firstNotReady, everReady = savedFailure, savedFirst, savedReady })

	var phase atomic.Value
	var requests atomic.Int32
	withFakeBFF(t, func(w http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		p, _ := phase.Load().(string)
		if p == "" {
			http.Error(w, `{"code":"not_found","message":"sandbox not found"}`, http.StatusNotFound)
			return
		}
		_, _ = w.Write([]byte(`{"status":{"phase":"` + p + `"}}`))
	})

	if got := bootSummary(); got != "" {
		t.Fatalf("a run that has not waited for a sandbox yet ends with %q, want nothing", got)
	}

	// The failures awaitPhase can explain do not set the latch: one sandbox
	// in ERROR, or one that does not exist, says nothing about the next.
	phase.Store("ERROR")
	if _, err := awaitReady("TestA", "ws", "sb", time.Minute); err == nil || !strings.Contains(err.Error(), "entered ERROR") {
		t.Fatalf("a sandbox in ERROR: err = %v, want it reported as entering ERROR", err)
	}
	phase.Store("")
	if _, err := awaitReady("TestB", "ws", "sb", time.Minute); err == nil || !strings.Contains(err.Error(), "does not exist") {
		t.Fatalf("a missing sandbox: err = %v, want it reported as not existing", err)
	}
	if bootFailure != "" {
		t.Fatalf("an ERROR or a 404 set the latch: %s", bootFailure)
	}
	// They are still summed up at the end while no sandbox has worked, with
	// the first of them as the example.
	if got := bootSummary(); !strings.Contains(got, "no sandbox became READY") ||
		!strings.Contains(got, "entered ERROR") || !strings.Contains(got, "TestA") {
		t.Errorf("summary after only failed boots = %q, want it to say that no sandbox became READY and "+
			"quote the first failure, from TestA", got)
	}

	// One sandbox that boots, and the earlier failures are no longer about
	// the gateway as a whole.
	phase.Store("READY")
	if _, err := awaitReady("TestC", "ws", "sb", time.Minute); err != nil {
		t.Fatalf("a sandbox that is READY: %v", err)
	}
	if got := bootSummary(); got != "" {
		t.Errorf("summary once a sandbox has become READY = %q, want nothing", got)
	}

	// A sandbox that stays in PROVISIONING until the limit sets the latch.
	phase.Store("PROVISIONING")
	_, err := awaitReady("TestFirst", "ws", "stuck", 300*time.Millisecond)
	if err == nil || bootFailure == "" {
		t.Fatalf("a sandbox stuck in PROVISIONING: err = %v, latch = %q; want an error and the latch set", err, bootFailure)
	}
	for _, want := range []string{"sandboxes do not become READY", "ws/stuck", "phase=PROVISIONING", "TestFirst"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("first failure = %q, want it to mention %q", err, want)
		}
	}
	if got := bootSummary(); got != err.Error() {
		t.Errorf("summary with the latch set = %q, want the sentence the tests fail with, %q", got, err)
	}

	// From here on nobody waits: no request is sent, and the answer is the
	// sentence the first failure produced, so every test says the same thing.
	before := requests.Load()
	start := time.Now()
	_, again := awaitReady("TestLater", "ws", "other", time.Minute)
	if again == nil || again.Error() != err.Error() {
		t.Errorf("a later wait: err = %v, want the first failure's message, %q", again, err)
	}
	if spent := time.Since(start); spent > time.Second {
		t.Errorf("a later wait took %s, want it to return at once", spent)
	}
	if sent := requests.Load() - before; sent != 0 {
		t.Errorf("a later wait sent %d request(s), want none", sent)
	}

	// Waiting for any other phase is not affected.
	phase.Store("STOPPED")
	if _, err := awaitPhase("ws", "sb", "STOPPED", time.Minute); err != nil {
		t.Errorf("waiting for STOPPED with the latch set: %v", err)
	}
}

// TestGuardDocCounts keeps the counts in the package comment true. The
// reviewed version of that comment was off by one because it had been counted
// by hand, TestMain included.
func TestGuardDocCounts(t *testing.T) {
	files, err := filepath.Glob("*_test.go")
	if err != nil || len(files) == 0 {
		t.Skipf("the test sources are not in the working directory (%v), so there is nothing to count", err)
	}
	fset := token.NewFileSet()
	var doc string
	gatewayTests, guardTests := 0, 0
	for _, file := range files {
		src, err := os.ReadFile(file)
		if err != nil {
			t.Fatalf("read %s: %v", file, err)
		}
		parsed, err := parser.ParseFile(fset, file, src, parser.ParseComments)
		if err != nil {
			t.Fatalf("parse %s: %v", file, err)
		}
		if parsed.Doc != nil {
			doc += parsed.Doc.Text()
		}
		for _, decl := range parsed.Decls {
			fn, ok := decl.(*ast.FuncDecl)
			// TestMain is not a test, and is the one the hand count included.
			if !ok || fn.Recv != nil || !strings.HasPrefix(fn.Name.Name, "Test") || fn.Name.Name == "TestMain" {
				continue
			}
			if file == "guard_test.go" {
				guardTests++
			} else {
				gatewayTests++
			}
		}
	}

	stated := regexp.MustCompile(`(\d+) test functions: (\d+) drive the gateway and (\d+) check`).FindStringSubmatch(
		strings.Join(strings.Fields(doc), " "))
	if stated == nil {
		t.Fatal(`the package comment no longer states the counts as "N test functions: N drive the gateway and N check ..."`)
	}
	want := []int{gatewayTests + guardTests, gatewayTests, guardTests}
	for i, label := range []string{"test functions", "that drive the gateway", "that check the suite's own guards"} {
		if got, _ := strconv.Atoi(stated[i+1]); got != want[i] {
			t.Errorf("the package comment says %d %s; there are %d — update the comment in harness_test.go",
				got, label, want[i])
		}
	}
}
