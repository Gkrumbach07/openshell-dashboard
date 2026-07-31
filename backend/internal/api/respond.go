package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"regexp"

	openshell "github.com/rhuss/openshell-sdk-go/openshell/v1"
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

// writeSDKError maps an SDK/gRPC error onto a safe HTTP error response.
func writeSDKError(w http.ResponseWriter, err error) {
	msg := err.Error()

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
		slog.Warn("gateway error", "code", "Aborted", "message", msg)
		writeError(w, http.StatusConflict, "conflict", msg)
	case openshell.IsUnavailable(err):
		slog.Warn("gateway error", "code", "Unavailable", "message", msg)
		writeError(w, http.StatusBadGateway, "gateway_unavailable", "OpenShell gateway is unreachable")
	case openshell.IsDeadlineExceeded(err):
		slog.Warn("gateway error", "code", "DeadlineExceeded", "message", msg)
		writeError(w, http.StatusBadGateway, "gateway_unavailable", "OpenShell gateway is unreachable")
	default:
		// Fallback to gRPC status codes for edge cases (FailedPrecondition,
		// OutOfRange, ResourceExhausted) that may surface from raw gRPC errors.
		st, ok := status.FromError(err)
		if !ok {
			slog.Error("gateway call failed", "error", err)
			writeError(w, http.StatusInternalServerError, "internal", "internal error")
			return
		}
		slog.Warn("gateway error", "code", st.Code().String(), "message", st.Message())
		switch st.Code() {
		case codes.FailedPrecondition, codes.OutOfRange:
			writeError(w, http.StatusBadRequest, "invalid_argument", st.Message())
		case codes.ResourceExhausted:
			writeError(w, http.StatusTooManyRequests, "resource_exhausted", st.Message())
		default:
			writeError(w, http.StatusInternalServerError, "internal", "internal error")
		}
	}
}

func decodeBody(w http.ResponseWriter, r *http.Request, dst any) bool {
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "invalid request body: "+err.Error())
		return false
	}
	return true
}

var dns1123Label = regexp.MustCompile(`^[a-z0-9]([-a-z0-9]*[a-z0-9])?$`)

// validDNS1123 reports whether name is a valid DNS-1123 label (workspace and
// sandbox names).
func validDNS1123(name string) bool {
	return len(name) <= 63 && dns1123Label.MatchString(name)
}
