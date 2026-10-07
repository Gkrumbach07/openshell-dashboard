package services

import (
	"context"
	"io"
)

// StdinExecer runs a command in a sandbox with piped stdin and no TTY — the
// binary-safe exec path the SDK does not expose. Used only for file upload.
// Implemented by clients.RawExecClient.
type StdinExecer interface {
	ExecWithStdin(ctx context.Context, workspace, sandboxName string, command []string, stdin []byte) (string, int, error)
}

// StdinStreamExecer is StdinExecer with stdin read as it is sent, so an upload
// is never held whole in memory. A stdin that fails part way must come back as
// that error and must not reach the command as a shorter stdin. Implemented by
// clients.RawExecClient.
//
// It is a separate, optional interface so that an existing StdinExecer keeps
// working: ExecWithStdinStream reads stdin whole for one that cannot stream.
type StdinStreamExecer interface {
	ExecWithStdinStream(ctx context.Context, workspace, sandboxName string, command []string, stdin io.Reader) (string, int, error)
}

type FileServiceInterface interface {
	StdinExecer
}

type FileService struct {
	StdinExecer
}

func NewFileService(stdinExecer StdinExecer) *FileService {
	return &FileService{StdinExecer: stdinExecer}
}

// ExecWithStdinStream makes FileService a StdinStreamExecer whatever it wraps.
func (s *FileService) ExecWithStdinStream(ctx context.Context, workspace, sandboxName string, command []string, stdin io.Reader) (string, int, error) {
	return ExecWithStdinStream(ctx, s.StdinExecer, workspace, sandboxName, command, stdin)
}

// ExecWithStdinStream runs command through execer with stdin streamed when
// execer is a StdinStreamExecer, and read whole first when it is not.
func ExecWithStdinStream(ctx context.Context, execer StdinExecer, workspace, sandboxName string, command []string, stdin io.Reader) (string, int, error) {
	if streamer, ok := execer.(StdinStreamExecer); ok {
		return streamer.ExecWithStdinStream(ctx, workspace, sandboxName, command, stdin)
	}
	data, err := io.ReadAll(stdin)
	if err != nil {
		return "", -1, err
	}
	return execer.ExecWithStdin(ctx, workspace, sandboxName, command, data)
}
