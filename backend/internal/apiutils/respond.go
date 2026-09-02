// Package http holds http helper functions
package apiutils

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"regexp"

	openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// setting response code "enum"
type ResponseCode int

const (
	NotReady ResponseCode = iota
	Internal
)

var responseCodeNames = map[ResponseCode]string{
	NotReady: "not_ready",
	Internal: "internal",
}

// implements fmt.Stringer interface
func (rc ResponseCode) String() string {
	return responseCodeNames[rc]
}

// ErrorResponse is the standard error envelope.
type ErrorResponse struct {
	Code    ResponseCode `json:"code"`
	Message string       `json:"message"`
}

func WriteJSON(w http.ResponseWriter, statusCode int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		slog.Error("encode response", "error", err)
	}
}

func WriteError(w http.ResponseWriter, statusCode int, code ResponseCode, message string) {
	WriteJSON(w, statusCode, ErrorResponse{Code: code, Message: message})
}

// writeSDKError maps an SDK StatusError onto a safe HTTP error response.
// Uses the SDK's typed error helpers for classification and extracts the
// clean message from StatusError.Message (no error chain prefix).
func WriteSDKError(w http.ResponseWriter, err error) {
	var se *openshell.StatusError
	var msg string
	if errors.As(err, &se) {
		msg = se.Message
	} else {
		msg = err.Error()
	}

	switch {
	case openshell.IsNotFound(err):
		slog.Warn("gateway error", "code", "NotFound", "message", msg)
		WriteError(w, http.StatusNotFound, "not_found", msg)
	case openshell.IsAlreadyExists(err):
		slog.Warn("gateway error", "code", "AlreadyExists", "message", msg)
		WriteError(w, http.StatusConflict, "already_exists", msg)
	case openshell.IsInvalidArgument(err):
		slog.Warn("gateway error", "code", "InvalidArgument", "message", msg)
		WriteError(w, http.StatusBadRequest, "invalid_argument", msg)
	case openshell.IsPermissionDenied(err):
		slog.Warn("gateway error", "code", "PermissionDenied", "message", msg)
		WriteError(w, http.StatusForbidden, "permission_denied", msg)
	case openshell.IsUnauthenticated(err):
		slog.Warn("gateway error", "code", "Unauthenticated", "message", msg)
		WriteError(w, http.StatusUnauthorized, "unauthenticated", msg)
	case openshell.IsConflict(err):
		slog.Warn("gateway error", "code", "Conflict", "message", msg)
		WriteError(w, http.StatusConflict, "conflict", msg)
	case openshell.IsUnavailable(err) || openshell.IsDeadlineExceeded(err):
		slog.Warn("gateway error", "code", "Unavailable", "message", msg)
		WriteError(w, http.StatusBadGateway, "gateway_unavailable", "OpenShell gateway is unreachable")
	default:
		// Fallback: check for raw gRPC status codes not covered by SDK helpers
		// (FailedPrecondition, OutOfRange, ResourceExhausted).
		st, ok := status.FromError(err)
		if ok {
			switch st.Code() {
			case codes.FailedPrecondition, codes.OutOfRange:
				slog.Warn("gateway error", "code", st.Code().String(), "message", st.Message())
				WriteError(w, http.StatusBadRequest, "invalid_argument", st.Message())
				return
			case codes.ResourceExhausted:
				slog.Warn("gateway error", "code", "ResourceExhausted", "message", st.Message())
				WriteError(w, http.StatusTooManyRequests, "resource_exhausted", st.Message())
				return
			}
		}
		slog.Error("gateway call failed", "error", err)
		WriteError(w, http.StatusInternalServerError, "internal", "internal error")
	}
}

const maxJSONBodyBytes int64 = 1 << 20 // 1 MB

func DecodeBody(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxJSONBodyBytes)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		slog.Debug("request body decode failed", "error", err)
		WriteError(w, http.StatusBadRequest, "invalid_body", "invalid request body")
		return false
	}
	return true
}

var dns1123Label = regexp.MustCompile(`^[a-z0-9]([-a-z0-9]*[a-z0-9])?$`)

const maxDNS1123LabelLength = 63

// validDNS1123 reports whether name is a valid DNS-1123 label (workspace and
// sandbox names).
func ValidDNS1123(name string) bool {
	return len(name) <= maxDNS1123LabelLength && dns1123Label.MatchString(name)
}
