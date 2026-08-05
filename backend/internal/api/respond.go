package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"regexp"

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
func writeGrpcError(w http.ResponseWriter, err error) {
	st, ok := status.FromError(err)
	if !ok {
		slog.Error("gateway call failed", "error", err)
		writeError(w, http.StatusInternalServerError, "internal", "internal error")
		return
	}
	slog.Warn("gateway error", "code", st.Code().String(), "message", st.Message())
	msg := sanitizeGrpcMessage(st.Message())
	switch st.Code() {
	case codes.NotFound:
		writeError(w, http.StatusNotFound, "not_found", msg)
	case codes.AlreadyExists:
		writeError(w, http.StatusConflict, "already_exists", msg)
	case codes.InvalidArgument, codes.FailedPrecondition, codes.OutOfRange:
		writeError(w, http.StatusBadRequest, "invalid_argument", msg)
	case codes.PermissionDenied:
		writeError(w, http.StatusForbidden, "permission_denied", msg)
	case codes.Unauthenticated:
		writeError(w, http.StatusUnauthorized, "unauthenticated", msg)
	case codes.Aborted:
		writeError(w, http.StatusConflict, "conflict", msg)
	case codes.ResourceExhausted:
		writeError(w, http.StatusTooManyRequests, "resource_exhausted", msg)
	case codes.Unavailable, codes.DeadlineExceeded:
		writeError(w, http.StatusBadGateway, "gateway_unavailable", "OpenShell gateway is unreachable")
	default:
		writeError(w, http.StatusInternalServerError, "internal", "internal error")
	}
}

// sanitizeGrpcMessage extracts the user-facing portion of a gRPC error message,
// stripping internal wrapper context (e.g. "create sandbox ... in workspace ...: ...")
// and "rpc error: code = ... desc = ..." prefixes.
var rpcDescRegexp = regexp.MustCompile(`(?:rpc error: code = \w+ desc = )(.+)$`)

func sanitizeGrpcMessage(msg string) string {
	if m := rpcDescRegexp.FindStringSubmatch(msg); len(m) == 2 {
		return m[1]
	}
	// If the message contains a colon-separated wrapper, take the last segment
	// which is typically the gateway's actual error description.
	if idx := lastMeaningfulSegment(msg); idx != "" {
		return idx
	}
	return msg
}

// lastMeaningfulSegment returns the final ": "-separated segment if the message
// has wrapper context (e.g. 'create sandbox "x" in workspace "y": actual error').
func lastMeaningfulSegment(msg string) string {
	for i := len(msg) - 1; i >= 0; i-- {
		if msg[i] == ':' && i+2 < len(msg) && msg[i+1] == ' ' {
			candidate := msg[i+2:]
			// Skip if it looks like another wrapper (contains quotes around names)
			if len(candidate) > 10 {
				return candidate
			}
		}
	}
	return ""
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
