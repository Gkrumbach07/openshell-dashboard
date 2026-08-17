package main

import (
	"context"
	"fmt"
	"log"
	"net/http"

	// Downstream imports exported packages from Upstream

	upstreamHandlers "github.com/myorg/upstream-bff/pkg/handlers"
	upstreamServices "github.com/myorg/upstream-bff/pkg/services"
)

// DownstreamProviderDecorator intercepts upstream service calls
type DownStreamProviderService struct {
	upstreamServices.ProviderService
}

func NewDownstreamService(base upstreamServices.ProviderService) upstreamServices.ProviderService {
	return &DownStreamProviderService{
		ProviderService: base,
	}
}

// CreateProvider shadows the interface method to run custom downstream logic
func (d *DownStreamProviderService) CreateProvider(ctx context.Context, name string) (*upstreamServices.Provider, error) {
	log.Printf("[DOWNSTREAM] Running custom pre-checks for provider: %s", name)

	// Downstream side-effect: enforce custom validation
	if name == "forbidden" {
		return nil, fmt.Errorf("provider name '%s' is rejected by downstream policy", name)
	}

	// Delegate to the underlying upstream logic
	provider, err := d.ProviderService.CreateProvider(ctx, name)
	if err != nil {
		return nil, err
	}

	log.Printf("[DOWNSTREAM] Upstream created provider successfully with ID: %s", provider.ID)

	// Modify or return the result
	provider.Name = fmt.Sprintf("%s (Enriched by Downstream)", provider.Name)
	return provider, nil
}

// Calls to GetProvider will automatically pass through to the upstream service
// even if you don't write in a function for it downstream

func ArbitraryMain() {
	// 1. Instantiate the upstream base service
	var dummySDK upstreamServices.OpenshellClient = nil
	upstreamBase := upstreamServices.NewProviderService(dummySDK)

	// 2. Wrap it with the downstream decorator
	downstreamSvc := NewDownstreamService(upstreamBase)

	// 3. Bootstrapping: Inject the decorated service into the upstream server router
	server := upstreamHandlers.NewServer(
		upstreamHandlers.WithProviderService(downstreamSvc),
	)

	// 4. Downstream can also register its OWN custom routes directly onto the router
	server.Mux.HandleFunc("GET /api/v1/downstream/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"downstream healthy"}`))
	})

	// 5. Start the server
	log.Println("Starting Downstream BFF on :8081...")
	if err := http.ListenAndServe(":8081", server.Mux); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
