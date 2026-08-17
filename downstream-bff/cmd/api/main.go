package api

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	upstreamServer "github.com/myorg/upstream-bff/pkg/server"
	upstreamServices "github.com/myorg/upstream-bff/pkg/services"
)

// Downstream Custom Handler for brand new endpoints
type DownstreamCustomHandler struct{}

func (h *DownstreamCustomHandler) RegisterRoutes(r chi.Router) {
	r.Get("/analytics", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"status": "analytics data"}`))
	})
}

func main() {
	// 1. Instantiate Upstream Services (or custom downstream overrides)
	baseGateway := upstreamServices.NewGatewayService()
	baseProvider := upstreamServices.NewProviderService()

	// Optional: Decorate or override a service
	customProvider := &DownstreamProviderService{Provider: baseProvider}

	svcs := upstreamServer.Services{
		Gateway:  baseGateway,
		Provider: customProvider, // Custom override
		Sandbox:  upstreamServices.NewSandboxService(),
	}

	// 2. Build the Base Upstream Chi Router
	router := upstreamServices.NewUpstreamRouter(svcs)

	// 3. EXTENSIBILITY: Downstream adds custom routes directly to the router!
	// Option A: Add a brand new top-level subroute group
	customHandler := &DownstreamCustomHandler{}
	router.Route("/api/custom", customHandler.RegisterRoutes)

	// Option B: Inject custom endpoints directly into an existing upstream route path
	router.Route("/api/gateway", customHandler.RegisterRoutes)

	// 4. Downstream configures and owns the http.Server instance
	httpServer := &http.Server{
		Addr:         ":8080",
		Handler:      router, // Passes the fully composed Chi router
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 10 * time.Second,
	}

	// can write goroutines here for soft termination or server close operations
	go func() {
		log.Println("Server starting on :8080...")
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("HTTP server failed unexpectedly: %v", err)
		}
	}()

	stopChan := make(chan os.Signal, 1)
	signal.Notify(stopChan, os.Interrupt, syscall.SIGTERM)

	sig := <-stopChan
	log.Printf("Received signal: %v. Initiating soft termination...\n", sig)

	// timeout for closing server
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// 5. Shutdown the HTTP server (stops accepting new connections, finishes active ones)
	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		log.Printf("HTTP server forced to shutdown: %v", err)
	} else {
		log.Println("HTTP server stopped gracefully.")
	}

	// 6. Perform extra downstream/upstream teardown tasks here
	performCustomTeardown()

	log.Println("Process exited cleanly.")
}
