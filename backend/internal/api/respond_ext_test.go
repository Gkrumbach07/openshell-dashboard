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
		grpcCode   codes.Code
		wantHTTP   int
		wantErrCode string
	}{
		{codes.NotFound, http.StatusNotFound, "not_found"},
		{codes.AlreadyExists, http.StatusConflict, "already_exists"},
		{codes.InvalidArgument, http.StatusBadRequest, "invalid_argument"},
		{codes.FailedPrecondition, http.StatusBadRequest, "invalid_argument"},
		{codes.OutOfRange, http.StatusBadRequest, "invalid_argument"},
		{codes.PermissionDenied, http.StatusForbidden, "permission_denied"},
		{codes.Unauthenticated, http.StatusUnauthorized, "unauthenticated"},
		{codes.Aborted, http.StatusConflict, "conflict"},
		{codes.ResourceExhausted, http.StatusTooManyRequests, "resource_exhausted"},
		{codes.Unavailable, http.StatusBadGateway, "gateway_unavailable"},
		{codes.DeadlineExceeded, http.StatusBadGateway, "gateway_unavailable"},
		{codes.Internal, http.StatusInternalServerError, "internal"},
		{codes.DataLoss, http.StatusInternalServerError, "internal"},
		{codes.Unknown, http.StatusInternalServerError, "internal"},
	}
	for _, tc := range tests {
		t.Run(tc.grpcCode.String(), func(t *testing.T) {
			w := httptest.NewRecorder()
			writeGrpcError(w, status.Error(tc.grpcCode, "test message"))

			if w.Code != tc.wantHTTP {
				t.Errorf("HTTP status = %d, want %d", w.Code, tc.wantHTTP)
			}
			var body ErrorResponse
			json.NewDecoder(w.Body).Decode(&body)
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
	json.NewDecoder(w.Body).Decode(&body)
	if body.Code != "internal" {
		t.Errorf("code = %q, want internal", body.Code)
	}
	if strings.Contains(body.Message, "plain error") {
		t.Error("raw internal error leaked to the response")
	}
}

func TestDecodeBody(t *testing.T) {
	tests := []struct {
		name    string
		body    string
		wantOK  bool
		wantErr string
	}{
		{"valid JSON", `{"name":"ok"}`, true, ""},
		{"invalid JSON", `{bad`, false, "invalid_body"},
		{"unknown field", `{"name":"ok","bogus":1}`, false, "invalid_body"},
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
				json.NewDecoder(w.Body).Decode(&errResp)
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
	json.NewDecoder(w.Body).Decode(&body)
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
	json.NewDecoder(w.Body).Decode(&body)
	if body.Code != "test_code" {
		t.Errorf("code = %q, want test_code", body.Code)
	}
	if body.Message != "test message" {
		t.Errorf("message = %q, want test message", body.Message)
	}
}
