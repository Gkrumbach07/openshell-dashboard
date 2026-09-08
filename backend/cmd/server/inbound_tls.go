package main

import (
	"errors"
	"fmt"
	"net/http"
	"os"
	"time"
)

const (
	serverReadTimeout       = 30 * time.Second
	serverReadHeaderTimeout = 10 * time.Second
	serverIdleTimeout       = 120 * time.Second
	serverShutdownTimeout   = 10 * time.Second
)

func inboundTLSConfigured(certFile, keyFile string) bool {
	return certFile != "" && keyFile != ""
}

func validateInboundTLS(certFile, keyFile string) error {
	if certFile == "" && keyFile == "" {
		return nil
	}
	if !inboundTLSConfigured(certFile, keyFile) {
		return errors.New("inbound TLS requires both TLS_CERT_FILE and TLS_KEY_FILE")
	}
	if err := statTLSFile(certFile, "TLS_CERT_FILE"); err != nil {
		return err
	}
	if err := statTLSFile(keyFile, "TLS_KEY_FILE"); err != nil {
		return err
	}
	return nil
}

func statTLSFile(path, envVar string) error {
	if _, err := os.Stat(path); err != nil {
		return fmt.Errorf("inbound TLS %s (%s): %w", envVar, path, err)
	}
	return nil
}

func inboundScheme(certFile, keyFile string) string {
	if inboundTLSConfigured(certFile, keyFile) {
		return "https"
	}
	return "http"
}

func newInboundServer(addr string, handler http.Handler) *http.Server {
	return &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: serverReadHeaderTimeout,
		ReadTimeout:       serverReadTimeout,
		// WriteTimeout is intentionally unset: terminal WebSockets and large
		// uploads can run longer than a fixed write deadline after the handshake.
		IdleTimeout: serverIdleTimeout,
	}
}

func serveInbound(server *http.Server, certFile, keyFile string) error {
	if inboundTLSConfigured(certFile, keyFile) {
		return server.ListenAndServeTLS(certFile, keyFile)
	}
	return server.ListenAndServe()
}
