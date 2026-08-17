package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"
)

type mockInteractiveSession struct {
	written []byte
	closed  bool
	exit    int
}

func (m *mockInteractiveSession) Read(_ []byte) (int, error) { return 0, io.EOF }
func (m *mockInteractiveSession) Write(p []byte) (int, error) {
	m.written = append(m.written, p...)
	return len(p), nil
}
func (m *mockInteractiveSession) Resize(_, _ uint32) error { return nil }
func (m *mockInteractiveSession) ExitCode() (int, error)   { return m.exit, nil }
func (m *mockInteractiveSession) Close() error {
	m.closed = true
	return nil
}

func TestValidateFilePath(t *testing.T) {
	tests := []struct {
		name string
		path string
		want bool
	}{
		{name: "valid absolute path", path: "/sandbox/file.txt", want: true},
		{name: "valid nested path", path: "/home/user/data.json", want: true},
		{name: "empty path", path: "", want: false},
		{name: "relative path", path: "relative/file.txt", want: false},
		{name: "traversal attack", path: "/sandbox/../etc/passwd", want: false},
		{name: "null byte", path: "/sandbox/file\x00.txt", want: false},
		{name: "dot only", path: ".", want: false},
		{name: "double dot", path: "..", want: false},
		{name: "root path", path: "/", want: true},
		{name: "path with spaces", path: "/sandbox/my file.txt", want: true},
		{name: "double slash cleaned", path: "//sandbox//file.txt", want: true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := validateFilePath(tc.path)
			if got != tc.want {
				t.Errorf("validateFilePath(%q) = %v, want %v", tc.path, got, tc.want)
			}
		})
	}
}

func TestUploadFile(t *testing.T) {
	session := &mockInteractiveSession{}
	sdk := &mockSDK{}
	sdk.exec.interactiveFn = func(_ context.Context, _, _ string, command []string, _, _ uint32, _ ...openshell.ExecOptions) (openshell.InteractiveSession, error) {
		if len(command) < 2 || command[0] != "dd" {
			t.Errorf("command = %v, want dd", command)
		}
		return session, nil
	}
	app := newTestAppWithSDK(sdk)
	r := chi.NewRouter()
	r.Post("/workspaces/{workspace}/sandboxes/{name}/files", app.UploadFile)

	body := &bytes.Buffer{}
	mw := multipart.NewWriter(body)
	part, err := mw.CreateFormFile("file", "hello.txt")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write([]byte("hello")); err != nil {
		t.Fatal(err)
	}
	if err := mw.Close(); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodPost, "/workspaces/default/sandboxes/sb/files", body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d; body: %s", w.Code, w.Body.String())
	}
	if string(session.written) != "hello" {
		t.Errorf("written = %q, want hello", session.written)
	}
	if !session.closed {
		t.Error("session not closed")
	}
	var resp map[string]any
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if resp["path"] != "/sandbox/hello.txt" || resp["success"] != true {
		t.Errorf("resp = %+v", resp)
	}
}

func TestDownloadFile(t *testing.T) {
	sdk := &mockSDK{}
	sdk.exec.runFn = func(_ context.Context, _, _ string, command []string, _ ...openshell.ExecOptions) (*openshell.ExecResult, error) {
		if len(command) != 2 || command[0] != "cat" || command[1] != "/sandbox/hello.txt" {
			t.Errorf("command = %v", command)
		}
		return &openshell.ExecResult{ExitCode: 0, Stdout: []byte("hello")}, nil
	}
	app := newTestAppWithSDK(sdk)
	r := chi.NewRouter()
	r.Get("/workspaces/{workspace}/sandboxes/{name}/files", app.DownloadFile)
	req := httptest.NewRequest(http.MethodGet, "/workspaces/default/sandboxes/sb/files?path=/sandbox/hello.txt", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d; body: %s", w.Code, w.Body.String())
	}
	if w.Body.String() != "hello" {
		t.Errorf("body = %q, want hello", w.Body.String())
	}
}

func TestDownloadFileNotFound(t *testing.T) {
	sdk := &mockSDK{}
	sdk.exec.runFn = func(_ context.Context, _, _ string, _ []string, _ ...openshell.ExecOptions) (*openshell.ExecResult, error) {
		return &openshell.ExecResult{ExitCode: 1, Stderr: []byte("cat: no such file")}, nil
	}
	app := newTestAppWithSDK(sdk)
	r := chi.NewRouter()
	r.Get("/workspaces/{workspace}/sandboxes/{name}/files", app.DownloadFile)
	req := httptest.NewRequest(http.MethodGet, "/workspaces/default/sandboxes/sb/files?path=/sandbox/missing.txt", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", w.Code)
	}
}
