// Package ssh is the business-logic layer for SSH sessions into sandboxes.
// Mirrors the SDK's SSHInterface (client.SSH()) --
// https://ro14nd.de/openshell-sdk-go/api/ssh.html.
package ssh

import (
	"context"
	"io"

	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/clients/openshell"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/models"
)

// Service is the contract SSHHandler depends on.
type Service interface {
	CreateSession(ctx context.Context, workspace, sandboxName string) (*models.SSHSession, error)
	RevokeSession(ctx context.Context, workspace, token string) (bool, error)
	// Tunnel returns a raw bidirectional stream to a sandbox port. Not yet
	// wired to an HTTP transport -- see openshell.Client.OpenSSHTunnel.
	Tunnel(ctx context.Context, workspace, sandboxName string, port uint32) (io.ReadWriteCloser, error)
}

type service struct {
	clients openshell.Factory
}

// NewService builds the default upstream implementation.
func NewService(clients openshell.Factory) Service {
	return &service{clients: clients}
}

func (s *service) CreateSession(ctx context.Context, workspace, sandboxName string) (*models.SSHSession, error) {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return nil, err
	}
	return client.CreateSSHSession(ctx, workspace, sandboxName)
}

func (s *service) RevokeSession(ctx context.Context, workspace, token string) (bool, error) {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return false, err
	}
	return client.RevokeSSHSession(ctx, workspace, token)
}

func (s *service) Tunnel(ctx context.Context, workspace, sandboxName string, port uint32) (io.ReadWriteCloser, error) {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return nil, err
	}
	return client.OpenSSHTunnel(ctx, workspace, sandboxName, port)
}
