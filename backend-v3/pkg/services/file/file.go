package file

import (
	"context"
	"io"

	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/clients/openshell"
)

// Service is the contract FileHandler depends on.
type Service interface {
	// Upload streams r to remotePath inside the sandbox.
	Upload(ctx context.Context, workspace, sandboxName, remotePath string, r io.Reader) error
	// Download streams the sandbox file at remotePath into w.
	Download(ctx context.Context, workspace, sandboxName, remotePath string, w io.Writer) error
}

type service struct {
	clients openshell.Factory
}

// NewService builds the default upstream implementation.
func NewService(clients openshell.Factory) Service {
	return &service{clients: clients}
}

func (s *service) Upload(ctx context.Context, workspace, sandboxName, remotePath string, r io.Reader) error {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return err
	}
	return client.UploadFile(ctx, workspace, sandboxName, remotePath, r)
}

func (s *service) Download(ctx context.Context, workspace, sandboxName, remotePath string, w io.Writer) error {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return err
	}
	return client.DownloadFile(ctx, workspace, sandboxName, remotePath, w)
}
