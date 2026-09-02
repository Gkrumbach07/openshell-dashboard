package sdkclient

import (
	"context"
	"net"
	"testing"

	pb "github.com/NVIDIA/OpenShell/sdk/go/proto/openshellv1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/test/bufconn"
)

// fakeExecServer captures the ExecSandbox request and replays a fixed event
// sequence (stdout, stderr, exit).
type fakeExecServer struct {
	pb.UnimplementedOpenShellServer
	gotReq   *pb.ExecSandboxRequest
	exitCode int32
}

func (f *fakeExecServer) ExecSandbox(req *pb.ExecSandboxRequest, stream grpc.ServerStreamingServer[pb.ExecSandboxEvent]) error {
	f.gotReq = req
	if err := stream.Send(&pb.ExecSandboxEvent{Payload: &pb.ExecSandboxEvent_Stdout{Stdout: &pb.ExecSandboxStdout{Data: []byte("out")}}}); err != nil {
		return err
	}
	if err := stream.Send(&pb.ExecSandboxEvent{Payload: &pb.ExecSandboxEvent_Stderr{Stderr: &pb.ExecSandboxStderr{Data: []byte("err")}}}); err != nil {
		return err
	}
	return stream.Send(&pb.ExecSandboxEvent{Payload: &pb.ExecSandboxEvent_Exit{Exit: &pb.ExecSandboxExit{ExitCode: f.exitCode}}})
}

func newTestRawExec(t *testing.T, fake *fakeExecServer) *RawExecClient {
	t.Helper()
	lis := bufconn.Listen(1 << 20)
	srv := grpc.NewServer()
	pb.RegisterOpenShellServer(srv, fake)
	go func() { _ = srv.Serve(lis) }()

	conn, err := grpc.NewClient("passthrough:///bufnet",
		grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) { return lis.DialContext(ctx) }),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	t.Cleanup(func() {
		_ = conn.Close()
		srv.Stop()
	})
	return &RawExecClient{conn: conn, client: pb.NewOpenShellClient(conn)}
}

func TestExecWithStdinForwardsRawBytesNoTTY(t *testing.T) {
	fake := &fakeExecServer{exitCode: 0}
	rc := newTestRawExec(t, fake)

	// Binary payload with control bytes a PTY would corrupt.
	payload := []byte("bin\x00\x04\x03\x11\x13data")
	stdout, code, err := rc.ExecWithStdin(context.Background(), "sb-uuid", []string{"dd", "of=/x"}, payload)
	if err != nil {
		t.Fatalf("ExecWithStdin: %v", err)
	}
	if code != 0 {
		t.Errorf("exit code = %d, want 0", code)
	}
	if stdout != "outerr" {
		t.Errorf("stdout = %q, want %q (stdout+stderr merged)", stdout, "outerr")
	}
	if fake.gotReq.GetTty() {
		t.Error("Tty = true, want false (non-TTY exec required for binary fidelity)")
	}
	if string(fake.gotReq.GetStdin()) != string(payload) {
		t.Errorf("stdin = %q, want %q (exact bytes, unmangled)", fake.gotReq.GetStdin(), payload)
	}
	if fake.gotReq.GetSandboxId() != "sb-uuid" {
		t.Errorf("sandboxId = %q, want sb-uuid", fake.gotReq.GetSandboxId())
	}
	if got := fake.gotReq.GetCommand(); len(got) != 2 || got[0] != "dd" || got[1] != "of=/x" {
		t.Errorf("command = %v", got)
	}
}

func TestExecWithStdinNonZeroExit(t *testing.T) {
	rc := newTestRawExec(t, &fakeExecServer{exitCode: 1})
	_, code, err := rc.ExecWithStdin(context.Background(), "sb", []string{"dd"}, []byte("x"))
	if err != nil {
		t.Fatalf("ExecWithStdin: %v", err)
	}
	if code != 1 {
		t.Errorf("exit code = %d, want 1", code)
	}
}
