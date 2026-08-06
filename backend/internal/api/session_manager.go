package api

import (
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/auth"
)

const (
	// refreshSkew renews sessions slightly before the bearer actually expires
	// so in-flight requests don't race the deadline.
	refreshSkew = 30 * time.Second
	// maxSessionLifetime caps how long a session may be renewed before the
	// user must re-authenticate, regardless of the IdP refresh token's own
	// lifetime. Bounds the blast radius of a captured cookie.
	maxSessionLifetime = 12 * time.Hour
	// refreshReuseWindow is how long a completed refresh answers for other
	// requests that arrived carrying the same (now-invalidated) refresh token.
	// A page load fires many parallel requests with the same expired cookie;
	// only the first may hit the IdP when refresh tokens are single-use. Kept
	// short: it must outlast a burst of concurrent requests but not linger as
	// a window where a replayed stale cookie is honored (which would blunt the
	// IdP's refresh-token replay detection).
	refreshReuseWindow = 10 * time.Second
)

// sessionManager implements auth.SessionAuthenticator: it opens the encrypted
// session cookie and, when the bearer inside is expired, refreshes it against
// the IdP server-side and re-sets the cookie. The browser never sees a token.
type sessionManager struct {
	codec *auth.SessionCodec
	app   *App

	// refreshMu serializes refreshes and guards the single-flight state
	// below. IdPs commonly rotate refresh tokens on use (Dex does by
	// default), so of N parallel requests carrying the same expired cookie,
	// only the first can redeem the refresh token — the rest must reuse its
	// result rather than fail against an already-invalidated token.
	refreshMu       sync.Mutex
	lastRefreshedRT string
	lastResult      *auth.Session
	lastRefreshedAt time.Time
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
	// Absolute lifetime cap: a session past its ceiling ends even if the IdP
	// would still refresh it. CreatedAt is preserved across refreshes.
	if session.CreatedAt > 0 && time.Since(time.Unix(session.CreatedAt, 0)) > maxSessionLifetime {
		auth.ClearSession(w)
		return ""
	}
	if !session.Expired(refreshSkew) {
		return session.Token
	}
	if session.RefreshToken == "" {
		// Expired with no way to renew: end the session. Passing the stale
		// token through would have the gateway 401 every request while the
		// session probe keeps reporting "logged in" — a redirect loop.
		auth.ClearSession(w)
		return ""
	}

	sm.refreshMu.Lock()
	defer sm.refreshMu.Unlock()

	refreshed := sm.recentRefreshLocked(session.RefreshToken)
	if refreshed == nil {
		refreshed, err = sm.app.refreshSession(session.RefreshToken)
		if err != nil {
			slog.Warn("server-side session refresh failed", "error", err)
			auth.ClearSession(w)
			return ""
		}
		// Preserve the original session start so the absolute lifetime cap
		// counts from first login, not from the latest refresh.
		refreshed.CreatedAt = session.CreatedAt
		sm.lastRefreshedRT = session.RefreshToken
		sm.lastResult = refreshed
		sm.lastRefreshedAt = time.Now()
	}

	if err := sm.codec.SetSession(w, refreshed); err != nil {
		slog.Warn("failed to re-set session cookie after refresh", "error", err)
	}
	return refreshed.Token
}

// recentRefreshLocked returns the result of a just-completed refresh of the
// same refresh token, or nil. Caller must hold refreshMu.
func (sm *sessionManager) recentRefreshLocked(refreshToken string) *auth.Session {
	if sm.lastResult == nil || sm.lastRefreshedRT != refreshToken {
		return nil
	}
	if time.Since(sm.lastRefreshedAt) > refreshReuseWindow {
		return nil
	}
	return sm.lastResult
}
