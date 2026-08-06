package api

import (
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/auth"
)

// refreshSkew renews sessions slightly before the bearer actually expires so
// in-flight requests don't race the deadline.
const refreshSkew = 30 * time.Second

// sessionManager implements auth.SessionAuthenticator: it opens the encrypted
// session cookie and, when the bearer inside is expired, refreshes it against
// the IdP server-side and re-sets the cookie. The browser never sees a token.
type sessionManager struct {
	codec *auth.SessionCodec
	app   *App
	// refreshMu serializes refreshes. IdPs may rotate refresh tokens on use
	// (single-use), so parallel requests refreshing the same session would
	// invalidate each other.
	refreshMu sync.Mutex
}

// TokenFromSession returns the session's bearer, refreshing first if expired.
// Returns "" when there is no session or the refresh fails — the caller then
// rejects the request with 401 and the frontend redirects to login.
func (sm *sessionManager) TokenFromSession(w http.ResponseWriter, r *http.Request) string {
	session, err := sm.codec.LoadSession(r)
	if err != nil {
		slog.Debug("session cookie rejected", "error", err)
		auth.ClearSession(w)
		return ""
	}
	if session == nil {
		return ""
	}
	if !session.Expired(refreshSkew) {
		return session.Token
	}
	if session.RefreshToken == "" {
		// Expired with no way to renew: let the gateway make the final call
		// (clock skew tolerance lives there, not here).
		return session.Token
	}

	sm.refreshMu.Lock()
	defer sm.refreshMu.Unlock()

	refreshed, err := sm.app.refreshSession(session.RefreshToken)
	if err != nil {
		slog.Warn("server-side session refresh failed", "error", err)
		auth.ClearSession(w)
		return ""
	}
	if err := sm.codec.SetSession(w, refreshed); err != nil {
		slog.Warn("failed to re-set session cookie after refresh", "error", err)
	}
	return refreshed.Token
}
