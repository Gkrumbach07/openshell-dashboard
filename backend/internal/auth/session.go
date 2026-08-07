// Encrypted cookie sessions for standalone OIDC mode.
//
// The BFF keeps the user's OIDC tokens out of the browser entirely: after the
// PKCE code exchange, tokens are sealed into an AES-256-GCM encrypted cookie
// (the oauth2-proxy client-side session pattern). The cookie is HttpOnly,
// Secure, SameSite=Strict, and __Host- prefixed, so JavaScript can never read
// it and it rides along on every same-origin request — including WebSocket
// upgrade handshakes, which cannot carry an Authorization header.
//
// Sessions larger than one cookie (e.g. Keycloak JWTs with many groups) are
// split across numbered chunk cookies and reassembled on read.
package auth

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// SessionCookieName is the base name of the encrypted session cookie. Chunk
// overflow cookies append "-1", "-2", … to this name.
const SessionCookieName = "__Host-openshell-session"

const (
	// maxCookieValueLen keeps each chunk under the 4KB per-cookie limit with
	// headroom for the name and attributes (matches oauth2-proxy's budget).
	maxCookieValueLen = 3800
	// maxSessionChunks caps reassembly so a hostile client cannot make the
	// server concatenate unbounded cookie data.
	maxSessionChunks = 8
)

// Session is the server-managed state sealed inside the cookie. Field names
// are compressed to keep the encrypted payload small.
type Session struct {
	// Token is the bearer forwarded to the gateway (ID token, or access
	// token when the IdP issued no ID token).
	Token string `json:"t"`
	// RefreshToken lets the BFF renew the session server-side.
	RefreshToken string `json:"r,omitempty"`
	// ExpiresAt is the bearer's expiry as unix seconds; 0 means unknown.
	ExpiresAt int64 `json:"e,omitempty"`
	// CreatedAt is when the session first began (unix seconds). Preserved
	// across refreshes so an absolute lifetime cap can be enforced —
	// refreshing renews the bearer but never resets this.
	CreatedAt int64 `json:"c,omitempty"`
}

// Expired reports whether the session's bearer is past (or within skew of)
// its expiry. Sessions with unknown expiry never report expired — the
// gateway remains the authority and will reject a stale token.
func (s *Session) Expired(skew time.Duration) bool {
	if s.ExpiresAt == 0 {
		return false
	}
	return time.Now().Add(skew).Unix() >= s.ExpiresAt
}

// SessionCodec seals and opens session cookies with AES-256-GCM.
type SessionCodec struct {
	aead cipher.AEAD
}

// NewSessionCodec derives a 256-bit key from secret (any length) via SHA-256.
func NewSessionCodec(secret []byte) (*SessionCodec, error) {
	if len(secret) == 0 {
		return nil, fmt.Errorf("session secret must not be empty")
	}
	key := sha256.Sum256(secret)
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &SessionCodec{aead: aead}, nil
}

func (c *SessionCodec) seal(s *Session) (string, error) {
	// G117 flags marshaling a struct with a secret-named field, but this
	// plaintext is immediately sealed with AES-256-GCM below and never leaves
	// the process unencrypted — that is the whole point of this function.
	plaintext, err := json.Marshal(s) //nolint:gosec // G117: sealed before use
	if err != nil {
		return "", err
	}
	nonce := make([]byte, c.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	sealed := c.aead.Seal(nonce, nonce, plaintext, nil)
	return base64.RawURLEncoding.EncodeToString(sealed), nil
}

func (c *SessionCodec) open(value string) (*Session, error) {
	sealed, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return nil, fmt.Errorf("malformed session cookie: %w", err)
	}
	if len(sealed) < c.aead.NonceSize() {
		return nil, fmt.Errorf("malformed session cookie: too short")
	}
	nonce, ciphertext := sealed[:c.aead.NonceSize()], sealed[c.aead.NonceSize():]
	plaintext, err := c.aead.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return nil, fmt.Errorf("session cookie failed decryption: %w", err)
	}
	var s Session
	if err := json.Unmarshal(plaintext, &s); err != nil {
		return nil, fmt.Errorf("malformed session payload: %w", err)
	}
	return &s, nil
}

func chunkName(i int) string {
	if i == 0 {
		return SessionCookieName
	}
	return fmt.Sprintf("%s-%d", SessionCookieName, i)
}

func newSessionCookie(name, value string, maxAge int) *http.Cookie {
	cookie := &http.Cookie{
		Name:     name,
		Value:    value,
		Path:     "/",
		Secure:   true,
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
	}
	if maxAge < 0 {
		cookie.MaxAge = -1
		cookie.Expires = time.Unix(1, 0)
	}
	return cookie
}

// SetSession seals the session into the response cookies, chunking when the
// payload exceeds a single cookie. Stale higher-numbered chunks from a
// previous, larger session are expired so reads never mix generations.
func (c *SessionCodec) SetSession(w http.ResponseWriter, s *Session) error {
	value, err := c.seal(s)
	if err != nil {
		return err
	}
	chunks := (len(value) + maxCookieValueLen - 1) / maxCookieValueLen
	if chunks > maxSessionChunks {
		return fmt.Errorf("session too large: %d bytes across %d chunks (max %d)", len(value), chunks, maxSessionChunks)
	}
	for i := 0; i < chunks; i++ {
		end := min((i+1)*maxCookieValueLen, len(value))
		http.SetCookie(w, newSessionCookie(chunkName(i), value[i*maxCookieValueLen:end], 0))
	}
	for i := chunks; i < maxSessionChunks; i++ {
		http.SetCookie(w, newSessionCookie(chunkName(i), "", -1))
	}
	return nil
}

// LoadSession reassembles and opens the session cookie from the request.
// Returns nil (no error) when no session cookie is present.
func (c *SessionCodec) LoadSession(r *http.Request) (*Session, error) {
	base, err := r.Cookie(SessionCookieName)
	if err != nil {
		return nil, nil //nolint:nilnil // absence of a session is not an error
	}
	value := base.Value
	for i := 1; i < maxSessionChunks; i++ {
		chunk, err := r.Cookie(chunkName(i))
		if err != nil {
			break
		}
		value += chunk.Value
	}
	return c.open(value)
}

// ClearSession expires the session cookie and all possible chunks.
func ClearSession(w http.ResponseWriter) {
	for i := 0; i < maxSessionChunks; i++ {
		http.SetCookie(w, newSessionCookie(chunkName(i), "", -1))
	}
}
