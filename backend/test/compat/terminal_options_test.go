//go:build compat

package compat

import (
	"strings"
	"testing"

	"github.com/gorilla/websocket"
)

// openTerminalWith opens the terminal websocket in the mode where the first
// frame chooses what the session runs, and sends that frame.
func openTerminalWith(t *testing.T, workspace, sandboxName, start string) *terminal {
	t.Helper()
	wsURL := "ws" + strings.TrimPrefix(bffURL, "http") + sandboxPath(workspace, sandboxName) + "/terminal?cols=100&rows=30&start=message"
	conn, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		status := 0
		if resp != nil {
			status = resp.StatusCode
		}
		t.Fatalf("open terminal %s [gateway %s]: %v (handshake status %d)", wsURL, gatewayVersion, err, status)
	}
	t.Cleanup(func() { conn.Close() })
	tm := &terminal{t: t, conn: conn}
	tm.send(websocket.TextMessage, start)
	return tm
}

// TestTerminalSessionOptions covers what `openshell sandbox exec` can choose
// and the terminal could not: the command, its working directory, its
// environment, and whether the shell's startup files are sourced. They reach
// the gateway as the fields of the interactive exec request.
func TestTerminalSessionOptions(t *testing.T) {
	ws, name := sharedSandbox(t)

	// The command is an argv: "-c" and its script are two arguments and no
	// shell on the way splits or joins them. The arithmetic keeps the marker
	// out of the echoed command line, so it can only come from the output.
	t.Run("command, working directory and environment", func(t *testing.T) {
		start := `{"type":"start",` +
			`"command":["/bin/sh","-c","echo opts-$((6*7))-$PWD-$COMPAT_TERM_OPT; exit 5"],` +
			`"workdir":"/tmp",` +
			`"environment":{"COMPAT_TERM_OPT":"` + shared.runID + `"},` +
			`"noLoginShell":true}`
		tm := openTerminalWith(t, ws, name, start)

		tm.waitFor("opts-42-/tmp-" + shared.runID)
		closed := tm.waitClose()
		if closed.Code != websocket.CloseNormalClosure || closed.Text != "5" {
			t.Errorf("close frame after `exit 5` = code %d text %q, want 1000 with the exit code %q as text",
				closed.Code, closed.Text, "5")
		}
	})

	// A start message that chooses nothing runs the default shell, which is
	// what a socket opened without ?start=message has always done.
	t.Run("an empty start message runs the default shell", func(t *testing.T) {
		tm := openTerminalWith(t, ws, name, `{"type":"start"}`)
		tm.run("echo shell-$((1+1))-$0; exit 0")
		tm.waitFor("shell-2-")
		if closed := tm.waitClose(); closed.Code != websocket.CloseNormalClosure || closed.Text != "0" {
			t.Errorf("close frame = code %d text %q, want 1000 and exit code 0", closed.Code, closed.Text)
		}
	})

	// The BFF refuses a first frame that is not a start message before it
	// opens anything on the gateway.
	t.Run("keystrokes instead of a start message are refused", func(t *testing.T) {
		tm := openTerminalWith(t, ws, name, `{"type":"resize","cols":1,"rows":1}`)
		if closed := tm.waitClose(); closed.Code != websocket.ClosePolicyViolation {
			t.Errorf("close frame = code %d text %q, want 1008", closed.Code, closed.Text)
		}
	})
}
