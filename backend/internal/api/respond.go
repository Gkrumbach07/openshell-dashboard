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

// unimplementedMessage is what the browser is told when the gateway answers an
// RPC with gRPC UNIMPLEMENTED. The gateway sends that status with an empty
// message, so the BFF supplies one; it names no RPC because the same mapping
// serves every route.
const unimplementedMessage = "this OpenShell gateway does not support this operation"

// writeUnimplemented answers HTTP 501 with the "unimplemented" code for an RPC
// the gateway does not have.
//
// The gateway is reachable and healthy; it just lacks an RPC that the SDK this
// BFF is built against knows about. Gateway 0.0.116, for one, has no
// sandbox-template RPCs. That is a property of the gateway's version rather
// than a failure, so it gets its own code instead of falling through to 500
// "internal error", which reads as a broken dashboard. The frontend can then
// say "not supported by this gateway".
//
// original is the message that came with the status, and it is what gets
// logged; the browser gets the fixed text. They differ when it matters most:
// grpc-go also reports an HTTP 404 from the far end as UNIMPLEMENTED, so a
// gateway URL that points at the wrong service or port answers 501 on every
// route, and "unexpected HTTP status code received from server: 404" in the
// log is then the only record of the real cause. A gateway that simply lacks
// the RPC sends an empty message.
func writeUnimplemented(w http.ResponseWriter, original string) {
	slog.Warn("gateway error", "code", "Unimplemented", "message", original)
	writeError(w, http.StatusNotImplemented, "unimplemented", unimplementedMessage)
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
	case openshell.IsUnimplemented(err):
		writeUnimplemented(w, msg)
	default:
		// Fallback: check for raw gRPC status codes not covered by SDK helpers
		// (FailedPrecondition, OutOfRange, ResourceExhausted), and for
		// Unimplemented arriving unwrapped from the generated client that
		// internal/sdkclient/rawexec.go uses.
		st, ok := status.FromError(err)
		if ok {
			switch st.Code() {
			case codes.Unimplemented:
				writeUnimplemented(w, st.Message())
				return
			case codes.FailedPrecondition, codes.OutOfRange:
				slog.Warn("gateway error", "code", st.Code().String(), "message", st.Message())
				writeError(w, http.StatusBadRequest, "invalid_argument", st.Message())
				return
			case codes.ResourceExhausted:
				slog.Warn("gateway error", "code", "ResourceExhausted", "message", st.Message())
				writeError(w, http.StatusTooManyRequests, "resource_exhausted", st.Message())
				return
			}
		}
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
