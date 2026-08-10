package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestWriteGrpcError(t *testing.T) {
	tests := []struct {
		wantErrCode string
		wantHTTP    int
		grpcCode    codes.Code
	}{
		{wantErrCode: "not_found", wantHTTP: http.StatusNotFound, grpcCode: codes.NotFound},
		{wantErrCode: "already_exists", wantHTTP: http.StatusConflict, grpcCode: codes.AlreadyExists},
		{wantErrCode: "invalid_argument", wantHTTP: http.StatusBadRequest, grpcCode: codes.InvalidArgument},
		{wantErrCode: "invalid_argument", wantHTTP: http.StatusBadRequest, grpcCode: codes.FailedPrecondition},
		{wantErrCode: "invalid_argument", wantHTTP: http.StatusBadRequest, grpcCode: codes.OutOfRange},
		{wantErrCode: "permission_denied", wantHTTP: http.StatusForbidden, grpcCode: codes.PermissionDenied},
		{wantErrCode: "unauthenticated", wantHTTP: http.StatusUnauthorized, grpcCode: codes.Unauthenticated},
		{wantErrCode: "conflict", wantHTTP: http.StatusConflict, grpcCode: codes.Aborted},
		{wantErrCode: "resource_exhausted", wantHTTP: http.StatusTooManyRequests, grpcCode: codes.ResourceExhausted},
		{wantErrCode: "gateway_unavailable", wantHTTP: http.StatusBadGateway, grpcCode: codes.Unavailable},
		{wantErrCode: "gateway_unavailable", wantHTTP: http.StatusBadGateway, grpcCode: codes.DeadlineExceeded},
		{wantErrCode: "internal", wantHTTP: http.StatusInternalServerError, grpcCode: codes.Internal},
		{wantErrCode: "internal", wantHTTP: http.StatusInternalServerError, grpcCode: codes.DataLoss},
		{wantErrCode: "internal", wantHTTP: http.StatusInternalServerError, grpcCode: codes.Unknown},
	}
	for _, tc := range tests {
		t.Run(tc.grpcCode.String(), func(t *testing.T) {
			w := httptest.NewRecorder()
			writeGrpcError(w, status.Error(tc.grpcCode, "test message"))

			if w.Code != tc.wantHTTP {
				t.Errorf("HTTP status = %d, want %d", w.Code, tc.wantHTTP)
			}
			var body ErrorResponse
			if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
				t.Fatalf("decode: %v", err)
			}
			if body.Code != tc.wantErrCode {
				t.Errorf("error code = %q, want %q", body.Code, tc.wantErrCode)
			}
		})
	}
}

func TestWriteGrpcErrorNonGRPC(t *testing.T) {
	w := httptest.NewRecorder()
	writeGrpcError(w, fmt.Errorf("plain error, not gRPC"))

	if w.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500", w.Code)
	}
	var body ErrorResponse
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Code != "internal" {
		t.Errorf("code = %q, want internal", body.Code)
	}
	if strings.Contains(body.Message, "plain error") {
		t.Error("raw internal error leaked to the response")
	}
}

func TestWriteGrpcErrorWrapped(t *testing.T) {
	// Simulate the real scenario: gateway layer wraps gRPC errors with fmt.Errorf.
	// The GRPCStatus() interface should still extract the clean original message.
	tests := []struct {
		name        string
		err         error
		wantCode    string
		wantMessage string
		wantHTTP    int
	}{
		{
			name:        "wrapped AlreadyExists",
			err:         fmt.Errorf("create sandbox %q in workspace %q: %w", "prueba", "default", status.Error(codes.AlreadyExists, "sandbox 'prueba' already exists")),
			wantHTTP:    http.StatusConflict,
			wantCode:    "already_exists",
			wantMessage: "sandbox 'prueba' already exists",
		},
		{
			name:        "wrapped NotFound short message",
			err:         fmt.Errorf("get sandbox %q in workspace %q: %w", "x", "prod", status.Error(codes.NotFound, "not found")),
			wantHTTP:    http.StatusNotFound,
			wantCode:    "not_found",
			wantMessage: "not found",
		},
		{
			name:        "wrapped InvalidArgument",
			err:         fmt.Errorf("create sandbox %q: %w", "bad/name", status.Error(codes.InvalidArgument, "sandbox name must be a valid DNS-1123 label")),
			wantHTTP:    http.StatusBadRequest,
			wantCode:    "invalid_argument",
			wantMessage: "sandbox name must be a valid DNS-1123 label",
		},
		{
			name:        "wrapped PermissionDenied short",
			err:         fmt.Errorf("delete sandbox %q: %w", "x", status.Error(codes.PermissionDenied, "denied")),
			wantHTTP:    http.StatusForbidden,
			wantCode:    "permission_denied",
			wantMessage: "denied",
		},
		{
			name:        "double-wrapped error preserves original message",
			err:         fmt.Errorf("handler: %w", fmt.Errorf("gateway call: %w", status.Error(codes.NotFound, "workspace not found"))),
			wantHTTP:    http.StatusNotFound,
			wantCode:    "not_found",
			wantMessage: "workspace not found",
		},
		{
			name:        "wrapped Unavailable returns generic message",
			err:         fmt.Errorf("list sandboxes in workspace %q: %w", "default", status.Error(codes.Unavailable, "connection refused")),
			wantHTTP:    http.StatusBadGateway,
			wantCode:    "gateway_unavailable",
			wantMessage: "OpenShell gateway is unreachable",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			writeGrpcError(w, tc.err)

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
