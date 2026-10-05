package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestDecodeBody(t *testing.T) {
	tests := []struct {
		name    string
		body    string
		wantErr string
		wantOK  bool
	}{
		{name: "valid JSON", body: `{"name":"ok"}`, wantOK: true, wantErr: ""},
		{name: "invalid JSON", body: `{bad`, wantOK: false, wantErr: "invalid_body"},
		{name: "unknown field", body: `{"name":"ok","bogus":1}`, wantOK: false, wantErr: "invalid_body"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			r := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(tc.body))
			var dst struct {
				Name string `json:"name"`
			}
			ok := decodeBody(w, r, &dst)
			if ok != tc.wantOK {
				t.Errorf("decodeBody() = %v, want %v", ok, tc.wantOK)
			}
			if !ok && tc.wantErr != "" {
				var errResp ErrorResponse
				if err := json.NewDecoder(w.Body).Decode(&errResp); err != nil {
					t.Fatalf("decode: %v", err)
				}
				if errResp.Code != tc.wantErr {
					t.Errorf("code = %q, want %q", errResp.Code, tc.wantErr)
				}
			}
		})
	}
}

func TestWriteJSON(t *testing.T) {
	w := httptest.NewRecorder()
	writeJSON(w, http.StatusCreated, map[string]string{"key": "value"})

	if w.Code != http.StatusCreated {
		t.Errorf("status = %d, want 201", w.Code)
	}
	if ct := w.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}
	var body map[string]string
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["key"] != "value" {
		t.Errorf("body = %v, want {key:value}", body)
	}
}

func TestWriteError(t *testing.T) {
	w := httptest.NewRecorder()
	writeError(w, http.StatusBadRequest, "test_code", "test message")

	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", w.Code)
	}
	var body ErrorResponse
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Code != "test_code" {
		t.Errorf("code = %q, want test_code", body.Code)
	}
	if body.Message != "test message" {
		t.Errorf("message = %q, want test message", body.Message)
	}
}

func TestWriteSDKError(t *testing.T) {
	tests := []struct {
		err         error
		name        string
		wantCode    string
		wantMessage string
		wantHTTP    int
	}{
		{
			name:        "NotFound",
			err:         &openshell.StatusError{Code: openshell.ErrorNotFound, Message: "sandbox not found"},
			wantHTTP:    http.StatusNotFound,
			wantCode:    "not_found",
			wantMessage: "sandbox not found",
		},
		{
			name:        "AlreadyExists",
			err:         &openshell.StatusError{Code: openshell.ErrorAlreadyExists, Message: "already exists"},
			wantHTTP:    http.StatusConflict,
			wantCode:    "already_exists",
			wantMessage: "already exists",
		},
		{
			name:        "InvalidArgument",
			err:         &openshell.StatusError{Code: openshell.ErrorInvalidArgument, Message: "bad input"},
			wantHTTP:    http.StatusBadRequest,
			wantCode:    "invalid_argument",
			wantMessage: "bad input",
		},
		{
			name:        "PermissionDenied",
			err:         &openshell.StatusError{Code: openshell.ErrorPermissionDenied, Message: "denied"},
			wantHTTP:    http.StatusForbidden,
			wantCode:    "permission_denied",
			wantMessage: "denied",
		},
		{
			name:        "Unauthenticated",
			err:         &openshell.StatusError{Code: openshell.ErrorUnauthenticated, Message: "no token"},
			wantHTTP:    http.StatusUnauthorized,
			wantCode:    "unauthenticated",
			wantMessage: "no token",
		},
		{
			name:        "Unavailable uses generic message",
			err:         &openshell.StatusError{Code: openshell.ErrorUnavailable, Message: "connection refused"},
			wantHTTP:    http.StatusBadGateway,
			wantCode:    "gateway_unavailable",
			wantMessage: "OpenShell gateway is unreachable",
		},
		{
			name:        "Conflict",
			err:         &openshell.StatusError{Code: openshell.ErrorConflict, Message: "version mismatch"},
			wantHTTP:    http.StatusConflict,
			wantCode:    "conflict",
			wantMessage: "version mismatch",
		},
		{
			// The gateway sends UNIMPLEMENTED with an empty message, which is
			// what the SDK hands over; the BFF supplies the text.
			name:        "Unimplemented maps to 501 with a fixed message",
			err:         &openshell.StatusError{Code: openshell.ErrorUnimplemented, Message: ""},
			wantHTTP:    http.StatusNotImplemented,
			wantCode:    "unimplemented",
			wantMessage: "this OpenShell gateway does not support this operation",
		},
		{
			name:        "wrapped Unimplemented maps to 501",
			err:         fmt.Errorf("list templates: %w", &openshell.StatusError{Code: openshell.ErrorUnimplemented}),
			wantHTTP:    http.StatusNotImplemented,
			wantCode:    "unimplemented",
			wantMessage: "this OpenShell gateway does not support this operation",
		},
		{
			// The raw-exec escape hatch bypasses the SDK's error wrapping, so
			// a bare gRPC status has to map the same way. The gateway's own
			// text is not relayed.
			name:        "fallback Unimplemented via raw gRPC",
			err:         status.Error(codes.Unimplemented, "unknown method ExecSandbox"),
			wantHTTP:    http.StatusNotImplemented,
			wantCode:    "unimplemented",
			wantMessage: "this OpenShell gateway does not support this operation",
		},
		{
			name:        "fallback FailedPrecondition via raw gRPC",
			err:         status.Error(codes.FailedPrecondition, "sandbox not ready"),
			wantHTTP:    http.StatusBadRequest,
			wantCode:    "invalid_argument",
			wantMessage: "sandbox not ready",
		},
		{
			name:        "fallback ResourceExhausted via raw gRPC",
			err:         status.Error(codes.ResourceExhausted, "rate limited"),
			wantHTTP:    http.StatusTooManyRequests,
			wantCode:    "resource_exhausted",
			wantMessage: "rate limited",
		},
		{
			name:        "unknown error returns 500",
			err:         fmt.Errorf("something unexpected"),
			wantHTTP:    http.StatusInternalServerError,
			wantCode:    "internal",
			wantMessage: "internal error",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			writeSDKError(w, tc.err)

			if w.Code != tc.wantHTTP {
				t.Errorf("HTTP status = %d, want %d", w.Code, tc.wantHTTP)
			}
			var body ErrorResponse
			if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
				t.Fatalf("decode: %v", err)
			}
			if body.Code != tc.wantCode {
				t.Errorf("error code = %q, want %q", body.Code, tc.wantCode)
			}
			if body.Message != tc.wantMessage {
				t.Errorf("message = %q, want %q", body.Message, tc.wantMessage)
			}
		})
	}
}

// The browser always gets the same fixed sentence for UNIMPLEMENTED, but the
// BFF log has to keep what the gateway, or the transport, actually said.
// grpc-go reports an HTTP 404 from the far end as codes.Unimplemented, so a
// gateway URL that points at the wrong service shows up as "this gateway does
// not support this operation" on every route; the log line is then the only
// place the real cause ("unexpected HTTP status code ... 404") is recorded.
func TestWriteSDKErrorLogsTheOriginalUnimplementedMessage(t *testing.T) {
	const transportMessage = "unexpected HTTP status code received from server: 404 (Not Found)"
	tests := []struct {
		name string
		err  error
	}{
		{
			name: "SDK StatusError",
			err:  &openshell.StatusError{Code: openshell.ErrorUnimplemented, Message: transportMessage},
		},
		{
			name: "raw gRPC status",
			err:  status.Error(codes.Unimplemented, transportMessage),
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var logged bytes.Buffer
			previous := slog.Default()
			slog.SetDefault(slog.New(slog.NewTextHandler(&logged, nil)))
			t.Cleanup(func() { slog.SetDefault(previous) })

			w := httptest.NewRecorder()
			writeSDKError(w, tc.err)

			if w.Code != http.StatusNotImplemented {
				t.Fatalf("HTTP status = %d, want 501", w.Code)
			}
			var body ErrorResponse
			if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
				t.Fatalf("decode: %v", err)
			}
			if body.Message != unimplementedMessage {
				t.Errorf("browser message = %q, want the fixed text %q", body.Message, unimplementedMessage)
			}
			if !strings.Contains(logged.String(), transportMessage) {
				t.Errorf("log does not carry the original message %q; logged: %s", transportMessage, logged.String())
			}
		})
	}
}
