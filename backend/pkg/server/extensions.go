package server

import "github.com/go-chi/chi/v5"

// Extension adds or overrides authenticated BFF routes.
//
// Extensions run after upstream routes under /api/v1. A route with the same
// method and pattern replaces the upstream handler; later extensions win.
type Extension func(chi.Router)
