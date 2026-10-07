//go:build compat

package compat

import (
	"bytes"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// binaryPayload returns n bytes that a text channel would mangle: every byte
// value occurs, including NUL, the terminal control bytes (EOF 0x04, XON/XOFF
// 0x11 and 0x13, CR, LF) and bytes that are not valid UTF-8. The value at an
// offset mixes two counters with different periods, so the pattern does not
// repeat within a payload and a chunk that is dropped, repeated or reordered
// on the way changes the content.
func binaryPayload(n int) []byte {
	b := make([]byte, n)
	for i := range b {
		b[i] = byte(i%251) ^ byte(i>>8)
	}
	return b
}

// TestFileTransfer covers the file upload and download endpoints one file at
// a time; files_test.go covers folders and files of several megabytes. File
// transfer is also the only way the BFF reaches the gateway's non-interactive
// exec.
//
// Upload is the likeliest path to break on a wire change: the SDK has no
// non-TTY exec with stdin, so pkg/clients/rawexec.go builds the exec request
// by hand from the generated proto types, workspace scope included, and
// streams the bytes into `dd` over the gateway's interactive exec RPC, asked
// for without a TTY. Download asks the sandbox what the path is through the
// SDK's Exec().Run and relays `cat` through Exec().Stream.
// Both run against a workspace other than "default".
func TestFileTransfer(t *testing.T) {
	ws, name := sharedSandbox(t)

	t.Run("binary round trip", func(t *testing.T) {
		// 256 KiB: many dd blocks, sent to the gateway as a single stdin
		// message. The last subtest sends a file that takes several.
		content := binaryPayload(256 << 10)
		filename := randName("bin") + ".dat"
		wantPath := "/sandbox/" + filename

		res := mustUpload(t, ws, name, "/sandbox", filename, content)
		if res.Path != wantPath || res.Size != len(content) || !res.Success || res.ExitCode != 0 {
			t.Errorf("upload result = %+v, want path %s, size %d, success, exit 0", res, wantPath, len(content))
		}

		got, header := mustDownload(t, ws, name, wantPath)
		if !bytes.Equal(got, content) {
			t.Errorf("downloaded %d bytes that differ from the %d uploaded — file transfer is not binary-safe on gateway %s",
				len(got), len(content), gatewayVersion)
		}
		if ct := header.Get("Content-Type"); ct != "application/octet-stream" {
			t.Errorf("Content-Type = %q, want application/octet-stream", ct)
		}
		if cd := header.Get("Content-Disposition"); !strings.Contains(cd, filename) {
			t.Errorf("Content-Disposition = %q, want an attachment named %q", cd, filename)
		}
	})

	t.Run("default destination is /sandbox", func(t *testing.T) {
		content := []byte("hello from the compat suite\n")
		filename := randName("txt") + ".txt"
		if res := mustUpload(t, ws, name, "", filename, content); res.Path != "/sandbox/"+filename {
			t.Errorf("upload without dest landed at %q, want /sandbox/%s", res.Path, filename)
		}
		if got, _ := mustDownload(t, ws, name, "/sandbox/"+filename); !bytes.Equal(got, content) {
			t.Errorf("downloaded %q, want %q", got, content)
		}
	})

	// The two refusals below are how the exit code of the command the gateway
	// ran reaches the browser. A change in how exit events are encoded would
	// turn them into a 200 or a 500.
	t.Run("downloading a missing file is a 404", func(t *testing.T) {
		status, _, raw, err := downloadFile(ws, name, "/sandbox/"+randName("missing"))
		if err != nil {
			t.Fatalf("download: %v", err)
		}
		checkError(t, "download of a missing file", status, raw, http.StatusNotFound, "file_not_found")
	})

	t.Run("a failed write is reported", func(t *testing.T) {
		// /usr is read-only under the base policy and owned by root, so dd
		// exits non-zero whichever of the two stops it.
		status, raw, err := uploadFile(ws, name, "/usr", randName("nope")+".txt", []byte("x"))
		if err != nil {
			t.Fatalf("upload: %v", err)
		}
		checkError(t, "upload into /usr", status, raw, http.StatusBadGateway, "upload_failed")
	})

	t.Run("unknown sandbox is a 404", func(t *testing.T) {
		status, raw, err := uploadFile(ws, "no-such-sandbox", "", "x.txt", []byte("x"))
		if err != nil {
			t.Fatalf("upload: %v", err)
		}
		checkError(t, "upload to an unknown sandbox", status, raw, http.StatusNotFound, "not_found")

		status, _, raw, err = downloadFile(ws, "no-such-sandbox", "/sandbox/x.txt")
		if err != nil {
			t.Fatalf("download: %v", err)
		}
		checkError(t, "download from an unknown sandbox", status, raw, http.StatusNotFound, "not_found")
	})

	// The gateway refuses any gRPC message over 1 MiB ("decoded message length
	// too large"), so a file that does not fit in one has to be streamed to it
	// in pieces. Two MiB crosses that limit and arrives in several messages;
	// it has to come back byte for byte.
	t.Run("upload larger than one gRPC message", func(t *testing.T) {
		content := binaryPayload(2 << 20)
		filename := randName("big") + ".dat"
		status, raw, err := uploadFile(ws, name, "", filename, content)
		if err != nil {
			t.Fatalf("upload: %v", err)
		}
		if status != http.StatusOK {
			t.Fatalf("upload %d bytes [gateway %s]: status = %d, want 200; body: %s",
				len(content), gatewayVersion, status, truncate(raw))
		}
		var res struct {
			Path string `json:"path"`
			Size int    `json:"size"`
		}
		mustDecode(t, raw, &res)
		if res.Size != len(content) {
			t.Errorf("upload reports %d bytes written to %s, want %d", res.Size, res.Path, len(content))
		}
		if got, _ := mustDownload(t, ws, name, "/sandbox/"+filename); !bytes.Equal(got, content) {
			t.Errorf("downloaded %d bytes that differ from the %d uploaded", len(got), len(content))
		}
	})
}

// terminal is a client for the BFF's terminal websocket, which relays the
// gateway's bidirectional ExecSandboxInteractive stream.
type terminal struct {
	t    *testing.T
	conn *websocket.Conn
	out  bytes.Buffer
}

func openTerminal(t *testing.T, workspace, sandboxName string) *terminal {
	t.Helper()
	// http -> ws and https -> wss.
	wsURL := "ws" + strings.TrimPrefix(bffURL, "http") + sandboxPath(workspace, sandboxName) + "/terminal?cols=100&rows=30"
	conn, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		status := 0
		if resp != nil {
			status = resp.StatusCode
		}
		t.Fatalf("open terminal %s [gateway %s]: %v (handshake status %d)", wsURL, gatewayVersion, err, status)
	}
	t.Cleanup(func() { conn.Close() })
	return &terminal{t: t, conn: conn}
}

func (tm *terminal) send(messageType int, data string) {
	tm.t.Helper()
	if err := tm.conn.WriteMessage(messageType, []byte(data)); err != nil {
		tm.t.Fatalf("write to terminal: %v", err)
	}
}

// run types a command line into the shell.
func (tm *terminal) run(command string) {
	tm.t.Helper()
	tm.send(websocket.BinaryMessage, command+"\n")
}

// waitFor reads until the output contains want. Callers build want from shell
// arithmetic ($((6*7))), so it can only come from the command's output and
// never from the terminal echoing the command line back.
func (tm *terminal) waitFor(want string) {
	tm.t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	for !strings.Contains(tm.out.String(), want) {
		_ = tm.conn.SetReadDeadline(deadline)
		_, data, err := tm.conn.ReadMessage()
		if err != nil {
			tm.t.Fatalf("terminal [gateway %s]: waiting for %q: %v; output so far: %q",
				gatewayVersion, want, err, truncate(tm.out.Bytes()))
		}
		tm.out.Write(data)
	}
}

// waitClose reads until the server closes the socket and returns the close
// frame.
func (tm *terminal) waitClose() *websocket.CloseError {
	tm.t.Helper()
	_ = tm.conn.SetReadDeadline(time.Now().Add(30 * time.Second))
	for {
		_, data, err := tm.conn.ReadMessage()
		if err == nil {
			tm.out.Write(data)
			continue
		}
		var closeErr *websocket.CloseError
		if !errors.As(err, &closeErr) {
			tm.t.Fatalf("terminal [gateway %s]: waiting for the close frame: %v; output so far: %q",
				gatewayVersion, err, truncate(tm.out.Bytes()))
		}
		return closeErr
	}
}

// TestTerminal covers the terminal websocket: the BFF relays keystrokes into
// the gateway's interactive exec stream, output and resizes back out, and the
// shell's exit code in the close frame.
func TestTerminal(t *testing.T) {
	ws, name := sharedSandbox(t)

	t.Run("session", func(t *testing.T) {
		tm := openTerminal(t, ws, name)

		tm.run("echo compat-$((6*7))")
		tm.waitFor("compat-42")

		// The sandbox was created with this variable, so seeing it in a shell
		// proves SandboxSpec.environment reached the workload.
		tm.run("echo env-$((1+1))-$" + sharedEnvKey)
		tm.waitFor("env-2-" + shared.runID)

		// A resize travels as a JSON text frame, not as terminal input.
		tm.send(websocket.TextMessage, `{"type":"resize","cols":132,"rows":43}`)
		tm.run("echo size-$((1+1))-$(stty size)")
		tm.waitFor("size-2-43 132")

		// Interactive and non-interactive exec must see the same filesystem,
		// and a download has to survive being split over many stream
		// messages. At about 2 MB this file cannot travel in one: the gateway
		// caps a gRPC message at 1 MiB.
		filename := randName("seq") + ".txt"
		tm.run("seq 1 300000 > /sandbox/" + filename + "; echo wrote-$((1+1))")
		tm.waitFor("wrote-2")
		var want bytes.Buffer
		for i := 1; i <= 300000; i++ {
			want.WriteString(strconv.Itoa(i))
			want.WriteByte('\n')
		}
		if got, _ := mustDownload(t, ws, name, "/sandbox/"+filename); !bytes.Equal(got, want.Bytes()) {
			t.Errorf("downloaded %d bytes, want the %d bytes `seq 1 300000` writes — a multi-message download is corrupted",
				len(got), want.Len())
		}

		tm.run("exit 3")
		closed := tm.waitClose()
		if closed.Code != websocket.CloseNormalClosure || closed.Text != "3" {
			t.Errorf("close frame after `exit 3` = code %d text %q, want 1000 with the exit code %q as text",
				closed.Code, closed.Text, "3")
		}
	})

	// The handshake is answered before the BFF opens the exec stream, so a
	// sandbox that does not exist surfaces as a close frame, which is what the
	// frontend's terminal shows as its error.
	t.Run("unknown sandbox closes with an error", func(t *testing.T) {
		tm := openTerminal(t, ws, "no-such-sandbox")
		if closed := tm.waitClose(); closed.Code != websocket.CloseInternalServerErr {
			t.Errorf("close frame for an unknown sandbox = code %d text %q, want 1011", closed.Code, closed.Text)
		}
	})
}
