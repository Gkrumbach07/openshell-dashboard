package api

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

// ErrorResponse is the standard error envelope.
type ErrorResponse struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func writeJSON(w http.ResponseWriter, statusCode int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		slog.Error("encode response", "error", err)
	}
}

func writeError(w http.ResponseWriter, statusCode int, code, message string) {
	writeJSON(w, statusCode, ErrorResponse{Code: code, Message: message})
}

// writeGrpcError maps a gateway gRPC error onto a safe HTTP error response.
// It extracts the original gRPC status via the GRPCStatus() interface to get
// the clean gateway message, bypassing status.FromError's behavior of replacing
// the message with the full error chain (grpc-go v1.82+).
func writeGrpcError(w http.ResponseWriter, err error) {
	var gs interface{ GRPCStatus() *status.Status }
	if !errors.As(err, &gs) {
		slog.Error("gateway call failed (non-gRPC)", "error", err)
		writeError(w, http.StatusInternalServerError, "internal", "internal error")
		return
	}
	st := gs.GRPCStatus()
	if st == nil {
		slog.Error("gateway call failed (nil gRPC status)", "error", err)
		writeError(w, http.StatusInternalServerError, "internal", "internal error")
		return
	}
	slog.Warn("gateway error", "code", st.Code().String(), "message", st.Message(), "full_error", err.Error())
	switch st.Code() {
	case codes.NotFound:
		writeError(w, http.StatusNotFound, "not_found", st.Message())
	case codes.AlreadyExists:
		writeError(w, http.StatusConflict, "already_exists", st.Message())
	case codes.InvalidArgument, codes.FailedPrecondition, codes.OutOfRange:
		writeError(w, http.StatusBadRequest, "invalid_argument", st.Message())
	case codes.PermissionDenied:
		writeError(w, http.StatusForbidden, "permission_denied", st.Message())
	case codes.Unauthenticated:
		writeError(w, http.StatusUnauthorized, "unauthenticated", st.Message())
	case codes.Aborted:
		writeError(w, http.StatusConflict, "conflict", st.Message())
	case codes.ResourceExhausted:
		writeError(w, http.StatusTooManyRequests, "resource_exhausted", st.Message())
	case codes.Unavailable, codes.DeadlineExceeded:
		writeError(w, http.StatusBadGateway, "gateway_unavailable", "OpenShell gateway is unreachable")
	default:
		writeError(w, http.StatusInternalServerError, "internal", "internal error")
	}
}

// writeSDKError maps an SDK StatusError onto a safe HTTP error response.
// Uses the SDK's typed error helpers for classification and extracts the
// clean message from StatusError.Message (no error chain prefix).
func writeSDKError(w http.ResponseWriter, err error) {
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
		writeError(w, http.StatusNotFound, "not_found", msg)
	case openshell.IsAlreadyExists(err):
		slog.Warn("gateway error", "code", "AlreadyExists", "message", msg)
		writeError(w, http.StatusConflict, "already_exists", msg)
	case openshell.IsInvalidArgument(err):
		slog.Warn("gateway error", "code", "InvalidArgument", "message", msg)
		writeError(w, http.StatusBadRequest, "invalid_argument", msg)
	case openshell.IsPermissionDenied(err):
		slog.Warn("gateway error", "code", "PermissionDenied", "message", msg)
		writeError(w, http.StatusForbidden, "permission_denied", msg)
	case openshell.IsUnauthenticated(err):
		slog.Warn("gateway error", "code", "Unauthenticated", "message", msg)
		writeError(w, http.StatusUnauthorized, "unauthenticated", msg)
	case openshell.IsConflict(err):
		slog.Warn("gateway error", "code", "Conflict", "message", msg)
		writeError(w, http.StatusConflict, "conflict", msg)
	case openshell.IsUnavailable(err) || openshell.IsDeadlineExceeded(err):
		slog.Warn("gateway error", "code", "Unavailable", "message", msg)
		writeError(w, http.StatusBadGateway, "gateway_unavailable", "OpenShell gateway is unreachable")
	default:
		slog.Error("gateway call failed", "error", err)
		writeError(w, http.StatusInternalServerError, "internal", "internal error")
	}
}

const maxJSONBodyBytes int64 = 1 << 20 // 1 MB

func decodeBody(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxJSONBodyBytes)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		slog.Debug("request body decode failed", "error", err)
		writeError(w, http.StatusBadRequest, "invalid_body", "invalid request body")
		return false
	}
	return true
}

var dns1123Label = regexp.MustCompile(`^[a-z0-9]([-a-z0-9]*[a-z0-9])?$`)

const maxDNS1123LabelLength = 63

// validDNS1123 reports whether name is a valid DNS-1123 label (workspace and
// sandbox names).
func validDNS1123(name string) bool {
	return len(name) <= maxDNS1123LabelLength && dns1123Label.MatchString(name)
}
