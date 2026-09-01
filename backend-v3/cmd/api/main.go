package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/internal/config"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/clients/openshell"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/server"
	svcconfig "github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/services/config"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/services/endpoint"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/services/exec"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/services/file"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/services/gateway"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/services/inference"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/services/policy"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/services/profile"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/services/provider"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/services/refresh"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/services/sandbox"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/services/ssh"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/services/tcp"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/services/workspace"
)

func main() {
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, nil)))

	cfg := config.Load()
	clients := openshell.NewFactory(cfg.GatewayTarget)

	srv := server.NewServer(
		server.ServerConfig{
			Addr:         cfg.Addr,
			ReadTimeout:  cfg.ReadTimeout,
			WriteTimeout: cfg.WriteTimeout,
			IdleTimeout:  cfg.IdleTimeout,
		},
		server.Services{
			Gateway:   gateway.NewService(clients),
			Sandbox:   sandbox.NewService(clients),
			Exec:      exec.NewService(clients),
			Provider:  provider.NewService(clients),
			Profile:   profile.NewService(clients),
			Refresh:   refresh.NewService(clients),
			Endpoint:  endpoint.NewService(clients),
			File:      file.NewService(clients),
			SSH:       ssh.NewService(clients),
			TCP:       tcp.NewService(clients),
			Config:    svcconfig.NewService(clients),
			Policy:    policy.NewService(clients),
			Workspace: workspace.NewService(clients),
			Inference: inference.NewService(clients),
		},
	)

	errCh := make(chan error, 1)
	go func() {
		slog.Info("listening", "addr", cfg.Addr, "gateway", cfg.GatewayTarget)
		if err := srv.Start(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
			return
		}
		errCh <- nil
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	select {
	case err := <-errCh:
		if err != nil {
			slog.Error("server exited", "error", err)
			os.Exit(1)
		}
	case <-stop:
		slog.Info("shutdown signal received")

		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		if err := srv.Shutdown(ctx); err != nil {
			slog.Error("graceful shutdown failed", "error", err)
			os.Exit(1)
		}
		slog.Info("shutdown complete")
	}
}
