package server

import "github.com/go-chi/chi/v5"

// Extension adds or overrides authenticated BFF routes.
//
// Extensions run after the built-in routes under /api/v1. A route with the
// same method and pattern replaces the built-in handler; later extensions win.
// cmd/server passes none.
type Extension func(chi.Router)
