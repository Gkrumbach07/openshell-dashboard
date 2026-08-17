package middleware

import "net/http"

func RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := r.Header.Get("Authorization")
		if token != "Bearer secret-token" { // Replace with actual JWT logic
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		// If authorized, pass execution to the next handler in the chain
		next.ServeHTTP(w, r)
	})
}
