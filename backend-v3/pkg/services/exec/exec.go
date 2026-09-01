// Package exec is the business-logic layer for running commands in a
// sandbox. Mirrors the SDK's ExecInterface (client.Exec()) --
// https://ro14nd.de/openshell-sdk-go/api/exec.html.
package exec

import (
	"context"

	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/clients/openshell"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/models"
)

// Service is the contract ExecHandler depends on.
type Service interface {
	// Run executes a command and waits for it to finish, collecting all
	// output.
	Run(ctx context.Context, workspace, sandboxName string, command []string) (*models.ExecResult, error)
	// Stream executes a command and returns an iterator over output chunks
	// as they're produced. Callers must Close the returned stream.
	Stream(ctx context.Context, workspace, sandboxName string, command []string) (openshell.ExecStream, error)
	// Interactive opens a bidirectional terminal session. Not yet wired to
	// an HTTP transport -- see openshell.Client.ExecInteractive.
	Interactive(ctx context.Context, workspace, sandboxName string, command []string, cols, rows uint32) (openshell.InteractiveSession, error)
}

type service struct {
	clients openshell.Factory
}

// NewService builds the default upstream implementation.
func NewService(clients openshell.Factory) Service {
	return &service{clients: clients}
}

func (s *service) Run(ctx context.Context, workspace, sandboxName string, command []string) (*models.ExecResult, error) {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return nil, err
	}
	return client.ExecRun(ctx, workspace, sandboxName, command)
}

func (s *service) Stream(ctx context.Context, workspace, sandboxName string, command []string) (openshell.ExecStream, error) {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return nil, err
	}
	return client.ExecStream(ctx, workspace, sandboxName, command)
}

func (s *service) Interactive(ctx context.Context, workspace, sandboxName string, command []string, cols, rows uint32) (openshell.InteractiveSession, error) {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return nil, err
	}
	return client.ExecInteractive(ctx, workspace, sandboxName, command, cols, rows)
}
