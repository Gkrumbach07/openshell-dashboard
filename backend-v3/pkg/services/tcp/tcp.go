// Package tcp is the business-logic layer for raw TCP forwarding into
// sandboxes. Mirrors (a subset of) the SDK's TCPInterface (client.TCP()) --
// https://ro14nd.de/openshell-sdk-go/api/tcp.html. The SDK's Listen() opens
// a *local* net.Listener for CLI-style port forwarding; there's no
// server-side BFF equivalent, so it's intentionally omitted here.
package tcp

import (
	"context"
	"io"

	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/clients/openshell"
)

// Service is the contract TCPHandler depends on.
type Service interface {
	// Forward returns a raw bidirectional stream to a sandbox port. Not
	// yet wired to an HTTP transport -- see openshell.Client.ForwardTCP.
	Forward(ctx context.Context, workspace, sandboxName string, port uint32) (io.ReadWriteCloser, error)
}

type service struct {
	clients openshell.Factory
}

// NewService builds the default upstream implementation.
func NewService(clients openshell.Factory) Service {
	return &service{clients: clients}
}

func (s *service) Forward(ctx context.Context, workspace, sandboxName string, port uint32) (io.ReadWriteCloser, error) {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return nil, err
	}
	return client.ForwardTCP(ctx, workspace, sandboxName, port)
}
