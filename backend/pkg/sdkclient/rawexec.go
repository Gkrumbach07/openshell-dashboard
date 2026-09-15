package sdkclient

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"io"
	"os"
	"strings"

	pb "github.com/NVIDIA/OpenShell/sdk/go/proto/openshellv1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
)

// RawExecClient performs the gateway's non-TTY, stdin-carrying ExecSandbox RPC,
// which the OpenShell Go SDK does not expose (its Run has no stdin and its
// Interactive forces a PTY). It exists solely so binary file uploads run
// through a clean pipe — `dd` with Stdin bytes and Tty=false — instead of a
// PTY, whose line discipline (EOF/flow-control bytes, CR/LF translation, echo)
// silently corrupts binary content. It shares the same address, TLS, and
// per-request bearer forwarding as the main SDK client.
type RawExecClient struct {
	conn   *grpc.ClientConn
	client pb.OpenShellClient
}

// NewRawExecClient dials the gateway. address is host:port (no URL scheme).
// When useTLS is set, caFile (optional) verifies the server and clientCert +
// clientKey (optional, both required together) enable mTLS client auth — the
// same knobs the SDK client uses, so upload honors gateway mTLS too.
func NewRawExecClient(address, caFile, clientCert, clientKey string, useTLS bool) (*RawExecClient, error) {
	var creds credentials.TransportCredentials
	if useTLS {
		tlsCfg := &tls.Config{MinVersion: tls.VersionTLS12}
		if caFile != "" {
			pem, err := os.ReadFile(caFile)
			if err != nil {
				return nil, fmt.Errorf("read gateway CA cert: %w", err)
			}
			pool := x509.NewCertPool()
			if !pool.AppendCertsFromPEM(pem) {
				return nil, fmt.Errorf("no valid certificates in %s", caFile)
			}
			tlsCfg.RootCAs = pool
		}
		if clientCert != "" && clientKey != "" {
			cert, err := tls.LoadX509KeyPair(clientCert, clientKey)
			if err != nil {
				return nil, fmt.Errorf("load gateway client cert/key: %w", err)
			}
			tlsCfg.Certificates = []tls.Certificate{cert}
		}
		creds = credentials.NewTLS(tlsCfg)
	} else {
		creds = insecure.NewCredentials()
	}
	conn, err := grpc.NewClient(address,
		grpc.WithTransportCredentials(creds),
		grpc.WithPerRPCCredentials(ContextAuthProvider{RequireTLS: useTLS}),
	)
	if err != nil {
		return nil, err
	}
	return &RawExecClient{conn: conn, client: pb.NewOpenShellClient(conn)}, nil
}

// Close closes the underlying gRPC connection.
func (r *RawExecClient) Close() error { return r.conn.Close() }

// ExecWithStdin runs command in the sandbox (identified by UUID) with stdin
// piped in and no TTY, returning merged stdout+stderr and the process exit
// code. exitCode is -1 if the gateway sent no exit event.
func (r *RawExecClient) ExecWithStdin(ctx context.Context, sandboxID string, command []string, stdin []byte) (string, int, error) {
	stream, err := r.client.ExecSandbox(ctx, &pb.ExecSandboxRequest{
		SandboxId: sandboxID,
		Command:   command,
		Stdin:     stdin,
		Tty:       false,
	})
	if err != nil {
		return "", 0, err
	}
	var out strings.Builder
	exitCode := -1
	for {
		ev, recvErr := stream.Recv()
		if recvErr == io.EOF {
			break
		}
		if recvErr != nil {
			return out.String(), exitCode, recvErr
		}
		switch p := ev.Payload.(type) {
		case *pb.ExecSandboxEvent_Stdout:
			out.Write(p.Stdout.GetData())
		case *pb.ExecSandboxEvent_Stderr:
			out.Write(p.Stderr.GetData())
		case *pb.ExecSandboxEvent_Exit:
			exitCode = int(p.Exit.GetExitCode())
		}
	}
	return out.String(), exitCode, nil
}
