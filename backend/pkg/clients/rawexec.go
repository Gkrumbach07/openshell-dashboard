package clients

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

// RawExecClient calls the gateway through the SDK's generated proto client for
// the two things the OpenShell Go SDK's own client does not offer. It shares
// the same address, TLS, and per-request bearer forwarding as the main SDK
// client.
//
// The first, in this file, is running a command in a sandbox with stdin piped
// in and no TTY: the SDK's Run takes no stdin and its Interactive always asks
// for a PTY. Binary file uploads need it, so that they run through a clean
// pipe — `dd` with raw stdin bytes — instead of a PTY, whose line discipline
// (EOF/flow-control bytes, CR/LF translation, echo) silently corrupts binary
// content. It uses the gateway's ExecSandboxInteractive RPC with tty=false.
// The PTY is the SDK wrapper's choice, not the RPC's: the gateway allocates
// one only when the start message asks for it, relays every stdin frame as it
// arrives, and closes the command's stdin when the request stream ends. The
// unary ExecSandbox RPC also takes stdin, but as one field of one message, and
// the gateway refuses any gRPC message over 1 MiB.
//
// The second, in rawprovider.go, is reading which credentials a provider
// holds.
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

// stdinChunkSize is how much of the payload one stream message carries. The
// gateway refuses a gRPC message over 1 MiB (MAX_GRPC_DECODE_SIZE in upstream
// multiplex.rs), so a chunk stays well under that.
const stdinChunkSize = 256 << 10

// ExecWithStdin runs command in the named workspace sandbox with stdin piped
// in and no TTY, returning merged stdout+stderr and the process exit code.
// exitCode is -1 if the gateway sent no exit event.
//
// stdin is streamed in chunks, so its size is bounded by the caller and not by
// the gateway's per-message limit.
func (r *RawExecClient) ExecWithStdin(ctx context.Context, workspace, sandboxName string, command []string, stdin []byte) (string, int, error) {
	// Cancelling ends the send side when the receive side returns first, as it
	// does when the command exits without reading all of its stdin.
	ctx, cancel := context.WithCancel(ctx)
	stream, err := r.client.ExecSandboxInteractive(ctx)
	if err != nil {
		cancel()
		return "", 0, err
	}
	start := &pb.ExecSandboxRequest{
		WorkspaceScope: namedWorkspace(workspace),
		Sandbox:        sandboxName,
		Command:        command,
		Tty:            false,
	}
	sent := make(chan error, 1)
	go func() { sent <- sendStdin(stream, start, stdin) }()
	// The sender holds stdin, so it must not outlive this call.
	defer func() {
		cancel()
		<-sent
	}()

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

// sendStdin sends the start message, then stdin in chunks, then closes the
// send side, which is what tells the gateway to close the command's stdin.
//
// Its error is not reported: when the gateway ends the stream early, Send
// fails with io.EOF and the status that says why arrives through Recv, and a
// failure on this side cancels the stream, which Recv reports as well.
func sendStdin(stream grpc.BidiStreamingClient[pb.ExecSandboxInput, pb.ExecSandboxEvent], start *pb.ExecSandboxRequest, stdin []byte) error {
	if err := stream.Send(&pb.ExecSandboxInput{Payload: &pb.ExecSandboxInput_Start{Start: start}}); err != nil {
		return err
	}
	for len(stdin) > 0 {
		n := min(len(stdin), stdinChunkSize)
		if err := stream.Send(&pb.ExecSandboxInput{Payload: &pb.ExecSandboxInput_Stdin{Stdin: stdin[:n]}}); err != nil {
			return err
		}
		stdin = stdin[n:]
	}
	return stream.CloseSend()
}
