//go:build compat

package compat

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
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

// sandbox mirrors models.Sandbox, field order included.
type sandbox struct {
	Spec struct {
		LogLevel    string            `json:"logLevel"`
		Environment map[string]string `json:"environment"`
		Image       string            `json:"image"`
		Providers   []string          `json:"providers"`
		Policy      json.RawMessage   `json:"policy"`
	} `json:"spec"`
	Status struct {
		ExitCode             *int32 `json:"exitCode"`
		SandboxName          string `json:"sandboxName"`
		Phase                string `json:"phase"`
		CurrentPolicyVersion uint32 `json:"currentPolicyVersion"`
	} `json:"status"`
	Metadata objectMeta `json:"metadata"`
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

func sandboxesPath(workspace string) string {
	return "/api/v1/workspaces/" + workspace + "/sandboxes"
}

func sandboxPath(workspace, name string) string {
	return sandboxesPath(workspace) + "/" + name
}

// createSandbox creates a sandbox with the base policy and registers its
// deletion. extra is merged over the default body, so a test states only what
// it cares about.
func createSandbox(t *testing.T, workspace, name string, extra map[string]any) sandbox {
	t.Helper()
	body := map[string]any{
		"name":   name,
		"image":  sandboxImage(),
		"policy": basePolicy(),
	}
	for k, v := range extra {
		body[k] = v
	}
	var sb sandbox
	mustJSON(t, http.MethodPost, sandboxesPath(workspace), body, &sb, http.StatusCreated)
	t.Cleanup(func() {
		_, _, _ = do(http.MethodDelete, sandboxPath(workspace, name), nil)
	})
	return sb
}

func getSandbox(t *testing.T, workspace, name string) sandbox {
	t.Helper()
	var sb sandbox
	mustJSON(t, http.MethodGet, sandboxPath(workspace, name), nil, &sb, http.StatusOK)
	return sb
}

// awaitPhase polls a sandbox until it reports want.
//
// It gives up before the limit in the three cases where waiting cannot help,
// because a slow boot is the only thing the limit is there for. A sandbox that
// enters ERROR is reported at once with its exit code, which is usually the
// whole diagnosis. One that does not exist will not start existing. And one
// that cannot be read at all for half a minute means the gateway is gone or
// does not understand the request, which is exactly the situation this suite
// is run to detect, and no reason to spend minutes per test detecting it.
func awaitPhase(workspace, name, want string, limit time.Duration) (sandbox, error) {
	const unreadableLimit = 30 * time.Second
	deadline := time.Now().Add(limit)
	lastRead := time.Now()
	last := "no response yet"
	for time.Now().Before(deadline) {
		var sb sandbox
		status, err := doJSON(http.MethodGet, sandboxPath(workspace, name), nil, &sb)
		switch {
		case err == nil && status == http.StatusNotFound:
			return sandbox{}, fmt.Errorf("sandbox %s/%s does not exist, so it will never reach %s", workspace, name, want)
		case err != nil || status != http.StatusOK:
			if err != nil {
				last = err.Error()
			} else {
				last = "status " + strconv.Itoa(status)
			}
			if time.Since(lastRead) > unreadableLimit {
				return sandbox{}, fmt.Errorf("sandbox %s/%s could not be read for %s while waiting for %s; last answer: %s",
					workspace, name, unreadableLimit, want, last)
			}
		case sb.Status.Phase == want:
			return sb, nil
		case sb.Status.Phase == "ERROR":
			exit := "nil"
			if sb.Status.ExitCode != nil {
				exit = strconv.Itoa(int(*sb.Status.ExitCode))
			}
			return sb, fmt.Errorf("sandbox %s/%s entered ERROR while waiting for %s, exitCode=%s", workspace, name, want, exit)
		default:
			lastRead = time.Now()
			last = "phase=" + sb.Status.Phase
		}
		time.Sleep(time.Second)
	}
	return sandbox{}, fmt.Errorf("%w after %s waiting for sandbox %s/%s to reach %s; last state: %s",
		errPhaseTimeout, limit, workspace, name, want, last)
}

// errPhaseTimeout marks the one awaitPhase failure that says nothing went
// wrong that it could see: the sandbox was readable and simply never got
// there.
var errPhaseTimeout = errors.New("timed out")

// readyLimit is how long a sandbox gets to become READY, and phaseLimit how
// long it gets for any other transition. A boot takes a few seconds once the
// images are on the host. The rest is for a first local run, where the gateway
// still has to pull the multi-gigabyte workload image; CI pulls it beforehand.
const (
	readyLimit = 5 * time.Minute
	phaseLimit = 5 * time.Minute
)

// bootFailure is set the first time a sandbox is still not READY when
// readyLimit runs out, and from then on no test waits for another one.
//
// A sandbox the gateway keeps in PROVISIONING for good (a supervisor that
// hangs instead of exiting, a workload image that never finishes pulling)
// costs the whole of readyLimit. Six places in this suite boot a sandbox and
// wait for it, so without this the suite would spend readyLimit on each, run
// into `go test -timeout` and end in a goroutine dump instead of a result.
// With it the first wait is the only long one: that test and every sandbox
// test after it fail with this same sentence, and TestMain repeats it as the
// last line of the run.
//
// A sandbox that enters ERROR does not set it. That answer comes within
// seconds, and one failed boot says too little about the next one to stop
// trying. bootSummary still says so at the end when none of them worked.
var bootFailure string

// firstNotReady is the first failure of any kind while waiting for READY, and
// everReady whether any sandbox got there. bootSummary reads them.
var (
	firstNotReady string
	everReady     bool
)

const bootHint = "Check that the in-sandbox supervisor can reach the gateway (OPENSHELL_GRPC_ENDPOINT) and, " +
	"on a first run, that the workload image has been pulled"

// awaitReady is awaitPhase for READY, with bootFailure as its memory. who
// names the test that is waiting, for the message.
func awaitReady(who, workspace, name string, limit time.Duration) (sandbox, error) {
	if bootFailure != "" {
		return sandbox{}, errors.New(bootFailure)
	}
	sb, err := awaitPhase(workspace, name, "READY", limit)
	if errors.Is(err, errPhaseTimeout) {
		bootFailure = fmt.Sprintf("sandboxes do not become READY on this gateway: %v (first seen in %s; no test "+
			"waits for another one). %s", err, who, bootHint)
		err = errors.New(bootFailure)
	}
	switch {
	case err == nil:
		everReady = true
	case firstNotReady == "":
		firstNotReady = fmt.Sprintf("%v (in %s)", err, who)
	}
	return sb, err
}

// bootSummary is the line TestMain ends the run with when the gateway could
// not boot sandboxes, so that a log with a dozen failed tests in it names
// their one cause in one place. It is empty when at least one sandbox became
// READY: the failures are then about something else.
func bootSummary() string {
	switch {
	case bootFailure != "":
		return bootFailure
	case firstNotReady != "" && !everReady:
		return fmt.Sprintf("no sandbox became READY on this gateway, which is what failed every test that "+
			"needs one. The first: %s. %s", firstNotReady, bootHint)
	}
	return ""
}

func waitForPhase(t *testing.T, workspace, name, want string) sandbox {
	t.Helper()
	var (
		sb  sandbox
		err error
	)
	if want == "READY" {
		sb, err = awaitReady(t.Name(), workspace, name, readyLimit)
	} else {
		sb, err = awaitPhase(workspace, name, want, phaseLimit)
	}
	if err != nil {
		t.Fatalf("[gateway %s] %v", gatewayVersion, err)
	}
	return sb
}

// withCurrentVersion calls send with the sandbox's current resourceVersion
// and returns the body of the 200 it gets. It re-reads and retries on a 409:
// the gateway also bumps the version by itself when the sandbox reports status
// (a policy revision finishing loading, for one), so a version read a moment
// ago can lose that race. A real client re-reads and tries again, and without
// doing the same these tests would fail every so often for no fault of the
// gateway.
func withCurrentVersion(t *testing.T, workspace, name string, send func(version uint64) (int, []byte, error)) []byte {
	t.Helper()
	var (
		status int
		raw    []byte
		err    error
	)
	for attempt := 0; attempt < 5; attempt++ {
		status, raw, err = send(getSandbox(t, workspace, name).Metadata.ResourceVersion)
		if err != nil {
			t.Fatalf("[gateway %s] %v", gatewayVersion, err)
		}
		if status == http.StatusOK {
			return raw
		}
		if status != http.StatusConflict {
			break
		}
		time.Sleep(500 * time.Millisecond)
	}
	t.Fatalf("call with the sandbox's current resourceVersion [gateway %s]: status = %d, want 200; body: %s",
		gatewayVersion, status, truncate(raw))
	return nil
}

// Ports cypress/e2e-integration/sandbox-lifecycle.cy.ts — the one compat test
// that exercises the whole stack: gateway, compute driver, supervisor image
// and the sandbox workload.
func TestSandboxLifecycle(t *testing.T) {
	requireSandboxes(t)
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
		waitForPhase(t, "default", name, "READY")
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

// TestSandboxCreateOptions covers the optional fields of the create form that
// no other test sends: the CPU and memory limits and the log level. The limits
// travel as a free-form struct under the sandbox's template, which is the kind
// of field that breaks without a compile error.
//
// Nothing the BFF returns reports the limits back, so a sandbox that booted
// would prove only that the gateway did not choke on them. They are read where
// they take effect instead: in the cgroup the workload runs in. The sandbox's
// policy lets it read /sys/fs/cgroup for that, which the base policy does not.
func TestSandboxCreateOptions(t *testing.T) {
	requireSandboxes(t)
	name := randName("co")
	policy := basePolicy()
	policy["filesystem"] = map[string]any{
		"includeWorkdir": true,
		"readOnly":       []string{"/usr", "/sys/fs/cgroup"},
		"readWrite":      []string{"/sandbox"},
	}
	created := createSandbox(t, "default", name, map[string]any{
		"cpu":      "500m",
		"memory":   "512Mi",
		"logLevel": "debug",
		"policy":   policy,
	})
	if created.Spec.LogLevel != "debug" {
		t.Errorf("spec.logLevel = %q, want %q", created.Spec.LogLevel, "debug")
	}
	waitForPhase(t, "default", name, "READY")

	// These are the cgroup v2 files; a cgroup v1 host keeps the same numbers
	// under other names and would need those added here. A sandbox without
	// limits reads "max" in both, so neither value can be there by accident.
	cgroup := func(t *testing.T, file string) string {
		t.Helper()
		path := "/sys/fs/cgroup/" + file
		status, _, raw, err := downloadFile("default", name, path)
		if err != nil {
			t.Fatalf("download %s: %v", path, err)
		}
		if status != http.StatusOK {
			t.Fatalf("reading %s inside the sandbox [gateway %s]: status = %d, want 200; body: %s — either the "+
				"gateway no longer honors the readOnly path this sandbox's policy grants, or this host does "+
				"not use cgroup v2", path, gatewayVersion, status, truncate(raw))
		}
		return strings.TrimSpace(string(raw))
	}

	t.Run("memory limit is applied", func(t *testing.T) {
		const want = 512 << 20
		if got := cgroup(t, "memory.max"); got != strconv.Itoa(want) {
			t.Errorf("memory.max inside a sandbox created with memory 512Mi = %q, want %d — the limit did not "+
				"reach the workload on gateway %s", got, want, gatewayVersion)
		}
	})

	t.Run("cpu limit is applied", func(t *testing.T) {
		// "<quota> <period>" in microseconds: 500m is half a period.
		got := cgroup(t, "cpu.max")
		fields := strings.Fields(got)
		var quota, period int
		if len(fields) == 2 {
			quota, _ = strconv.Atoi(fields[0])
			period, _ = strconv.Atoi(fields[1])
		}
		if quota <= 0 || period != 2*quota {
			t.Errorf("cpu.max inside a sandbox created with cpu 500m = %q, want a quota of half the period "+
				"(such as \"50000 100000\") — the limit did not reach the workload on gateway %s", got, gatewayVersion)
		}
	})
}

// TestSandboxStopStart covers StopSandbox and StartSandbox, which arrived in
// gateway 0.0.113 and added the STOPPING, STOPPED and STARTING phases. It runs
// in a workspace of its own, so it also proves that sandbox create, get, stop,
// start and exec carry a non-default workspace scope.
func TestSandboxStopStart(t *testing.T) {
	requireSandboxes(t)
	ws := newWorkspace(t)
	name := randName("ss")
	createSandbox(t, ws, name, nil)
	waitForPhase(t, ws, name, "READY")

	// A file written before the stop is how "stop retains persistent state"
	// is observed from the outside.
	marker := []byte("written before stop by " + name + "\n")
	mustUpload(t, ws, name, "", "marker.txt", marker)

	t.Run("stop", func(t *testing.T) {
		var sb sandbox
		mustJSON(t, http.MethodPost, sandboxPath(ws, name)+"/stop", nil, &sb, http.StatusOK)
		switch sb.Status.Phase {
		case "STOPPING", "STOPPED":
		default:
			t.Errorf("phase after stop = %q, want STOPPING or STOPPED", sb.Status.Phase)
		}
		waitForPhase(t, ws, name, "STOPPED")
	})

	// The file browser and the terminal are offered on the sandbox page
	// whatever its phase, so what a stopped sandbox answers matters: a
	// conflict the UI can explain, not a 500.
	t.Run("exec is refused while stopped", func(t *testing.T) {
		status, _, raw, err := downloadFile(ws, name, "/sandbox/marker.txt")
		if err != nil {
			t.Fatalf("download: %v", err)
		}
		checkError(t, "download from a stopped sandbox", status, raw, http.StatusConflict, "conflict")
	})

	t.Run("start", func(t *testing.T) {
		var sb sandbox
		mustJSON(t, http.MethodPost, sandboxPath(ws, name)+"/start", nil, &sb, http.StatusOK)
		switch sb.Status.Phase {
		case "STARTING", "PROVISIONING", "READY":
		default:
			t.Errorf("phase after start = %q, want STARTING, PROVISIONING or READY", sb.Status.Phase)
		}
		waitForPhase(t, ws, name, "READY")
	})

	t.Run("state survives the restart", func(t *testing.T) {
		if got, _ := mustDownload(t, ws, name, "/sandbox/marker.txt"); !bytes.Equal(got, marker) {
			t.Errorf("marker after restart = %q, want %q — stop no longer retains the sandbox's state", got, marker)
		}
	})
}

// TestSandboxLabelsAndSelector covers the labels and annotations a sandbox is
// created with and the labelSelector filter the list page sends.
func TestSandboxLabelsAndSelector(t *testing.T) {
	ws, name := sharedSandbox(t)

	t.Run("labels and annotations round trip", func(t *testing.T) {
		sb := getSandbox(t, ws, name)
		if got := sb.Metadata.Labels[sharedLabelKey]; got != shared.runID {
			t.Errorf("label %s = %q, want %q; labels: %v", sharedLabelKey, got, shared.runID, sb.Metadata.Labels)
		}
		// The gateway adds annotations of its own; only ours is asserted.
		if got := sb.Metadata.Annotations["compat/purpose"]; got != "shared fixture" {
			t.Errorf("annotation compat/purpose = %q, want %q; annotations: %v",
				got, "shared fixture", sb.Metadata.Annotations)
		}
		if sb.Metadata.Workspace != ws {
			t.Errorf("metadata.workspace = %q, want %q", sb.Metadata.Workspace, ws)
		}
	})

	list := func(t *testing.T, workspace, selector string) []string {
		t.Helper()
		path := sandboxesPath(workspace)
		if selector != "" {
			path += "?labelSelector=" + selector
		}
		var sandboxes []sandbox
		mustJSON(t, http.MethodGet, path, nil, &sandboxes, http.StatusOK)
		names := make([]string, 0, len(sandboxes))
		for _, sb := range sandboxes {
			names = append(names, sb.Metadata.Name)
		}
		return names
	}

	t.Run("selector matches", func(t *testing.T) {
		got := list(t, ws, sharedLabelKey+"%3D"+shared.runID)
		if len(got) != 1 || got[0] != name {
			t.Errorf("sandboxes matching %s=%s = %v, want [%s]", sharedLabelKey, shared.runID, got, name)
		}
	})

	t.Run("selector with two terms", func(t *testing.T) {
		got := list(t, ws, sharedLabelKey+"%3D"+shared.runID+"%2Ctier%3Dshared")
		if len(got) != 1 || got[0] != name {
			t.Errorf("sandboxes matching both labels = %v, want [%s]", got, name)
		}
		if got := list(t, ws, sharedLabelKey+"%3D"+shared.runID+"%2Ctier%3Dother"); len(got) != 0 {
			t.Errorf("sandboxes matching %s=%s,tier=other = %v, want none — a selector's terms are ANDed",
				sharedLabelKey, shared.runID, got)
		}
	})

	t.Run("selector that matches nothing", func(t *testing.T) {
		if got := list(t, ws, sharedLabelKey+"%3Dnot-"+shared.runID); len(got) != 0 {
			t.Errorf("sandboxes matching a label nobody has = %v, want none", got)
		}
	})

	t.Run("malformed selector is a 400", func(t *testing.T) {
		wantError(t, http.MethodGet, sandboxesPath(ws)+"?labelSelector=%3D%3D%3D", nil,
			http.StatusBadRequest, "invalid_argument")
	})

	// A list that ignored its workspace scope would show this sandbox to
	// every workspace.
	t.Run("other workspaces do not see it", func(t *testing.T) {
		for _, other := range list(t, "default", "") {
			if other == name {
				t.Errorf("sandbox %s of workspace %s is listed in workspace default", name, ws)
			}
		}
	})
}

type logLine struct {
	Fields      map[string]string `json:"fields"`
	Level       string            `json:"level"`
	Target      string            `json:"target"`
	Message     string            `json:"message"`
	Source      string            `json:"source"`
	TimestampMs int64             `json:"timestampMs"`
}

type sandboxLogs struct {
	Logs        []logLine `json:"logs"`
	BufferTotal uint32    `json:"bufferTotal"`
}

// TestSandboxLogFilters covers the query parameters of the logs view: lines,
// level, source and sinceMs. Each one is a separate field on the wire, so a
// filter the gateway stops honoring shows up here as lines that should have
// been filtered out.
func TestSandboxLogFilters(t *testing.T) {
	ws, name := sharedSandbox(t)
	logsPath := sandboxPath(ws, name) + "/logs"

	fetch := func(t *testing.T, query string) sandboxLogs {
		t.Helper()
		var logs sandboxLogs
		mustJSON(t, http.MethodGet, logsPath+query, nil, &logs, http.StatusOK)
		return logs
	}
	hasLevel := func(lines []logLine, level string) bool {
		for _, l := range lines {
			if strings.EqualFold(l.Level, level) {
				return true
			}
		}
		return false
	}

	// The supervisor ships its log lines to the gateway asynchronously, so a
	// sandbox that has only just turned READY may not have any yet. Every
	// filter below needs INFO lines from the sandbox itself to work against.
	var all sandboxLogs
	poll(t, time.Minute, time.Second, "INFO lines from the sandbox in the log buffer", func() (bool, string) {
		all = fetch(t, "?lines=500")
		for _, l := range all.Logs {
			if strings.EqualFold(l.Level, "INFO") && l.Source == "sandbox" {
				return true, ""
			}
		}
		return false, fmt.Sprintf("%d lines, none of them INFO from source sandbox", len(all.Logs))
	})

	t.Run("lines limits the result", func(t *testing.T) {
		if got := fetch(t, "?lines=1"); len(got.Logs) != 1 {
			t.Errorf("lines=1 returned %d lines, want 1 (the buffer holds %d)", len(got.Logs), len(all.Logs))
		}
	})

	t.Run("level is a minimum level", func(t *testing.T) {
		got := fetch(t, "?lines=500&level=WARN")
		for _, lower := range []string{"INFO", "DEBUG", "TRACE"} {
			if hasLevel(got.Logs, lower) {
				t.Errorf("level=WARN returned %s lines — the minimum-level filter is not applied", lower)
			}
		}
	})

	t.Run("source selects gateway or sandbox lines", func(t *testing.T) {
		for _, source := range []string{"gateway", "sandbox"} {
			for _, l := range fetch(t, "?lines=500&source="+source).Logs {
				if l.Source != source {
					t.Errorf("source=%s returned a line from %q: %q", source, l.Source, l.Message)
					break
				}
			}
		}
		if len(fetch(t, "?lines=500&source=sandbox").Logs) == 0 {
			t.Error("source=sandbox returned nothing although the unfiltered buffer has sandbox lines")
		}
	})

	t.Run("sinceMs drops older lines", func(t *testing.T) {
		future := time.Now().Add(24 * time.Hour).UnixMilli()
		raw := mustRaw(t, http.MethodGet, logsPath+"?sinceMs="+strconv.FormatInt(future, 10), nil, http.StatusOK)
		var got sandboxLogs
		mustDecode(t, raw, &got)
		if len(got.Logs) != 0 {
			t.Errorf("sinceMs=tomorrow returned %d lines, want none", len(got.Logs))
		}
		// No lines is an empty array, never null or a missing key.
		if !bytes.Contains(raw, []byte(`"logs":[]`)) {
			t.Errorf(`an empty result must serialize as "logs":[], got: %s`, truncate(raw))
		}
	})

	t.Run("unknown sandbox is a 404", func(t *testing.T) {
		wantError(t, http.MethodGet, sandboxPath(ws, "no-such-sandbox")+"/logs", nil,
			http.StatusNotFound, "not_found")
	})
}

// serviceEndpoint mirrors models.ServiceEndpoint.
type serviceEndpoint struct {
	SandboxName string `json:"sandboxName"`
	ServiceName string `json:"serviceName"`
	URL         string `json:"url"`
	TargetPort  uint32 `json:"targetPort"`
}

// TestSandboxServices covers exposing a port of a sandbox as a service
// endpoint, listing the endpoints and removing one again.
func TestSandboxServices(t *testing.T) {
	ws, name := sharedSandbox(t)
	servicesPath := sandboxPath(ws, name) + "/services"
	svc := randName("sv")

	listed := func(t *testing.T) bool {
		t.Helper()
		var endpoints []serviceEndpoint
		mustJSON(t, http.MethodGet, servicesPath, nil, &endpoints, http.StatusOK)
		for _, e := range endpoints {
			if e.ServiceName == svc {
				return true
			}
		}
		return false
	}

	t.Cleanup(func() {
		_, _, _ = do(http.MethodDelete, servicesPath+"/"+svc, nil)
	})

	t.Run("expose", func(t *testing.T) {
		var got serviceEndpoint
		mustJSON(t, http.MethodPost, servicesPath,
			map[string]any{"service": svc, "targetPort": 8000, "domain": false}, &got, http.StatusCreated)
		if got.ServiceName != svc || got.SandboxName != name || got.TargetPort != 8000 {
			t.Errorf("exposed endpoint = %+v, want service %q on sandbox %q port 8000", got, svc, name)
		}
		if got.URL == "" {
			t.Error("exposed endpoint has no url — the UI renders it as the link to open")
		}
	})

	t.Run("appears in list", func(t *testing.T) {
		if !listed(t) {
			t.Errorf("service %q is not in the sandbox's service list", svc)
		}
	})

	var outcome string
	t.Run("delete", func(t *testing.T) {
		outcome = assertDeleted(t, http.MethodDelete, servicesPath+"/"+svc)
	})

	t.Run("gone after delete", func(t *testing.T) {
		if !establishesCompletion[outcome] {
			t.Skipf("delete outcome was %q, not a completion — the endpoint may legitimately still be listed", outcome)
		}
		if listed(t) {
			t.Errorf("service %q is still listed after a completed delete", svc)
		}
		wantError(t, http.MethodDelete, servicesPath+"/"+svc, nil, http.StatusNotFound, "not_found")
	})
}
