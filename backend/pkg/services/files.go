package services

import "context"

// StdinExecer runs a command in a sandbox with piped stdin and no TTY — the
// binary-safe exec path the SDK does not expose. Used only for file upload.
// Implemented by sdkclient.RawExecClient.
type StdinExecer interface {
	ExecWithStdin(ctx context.Context, sandboxID string, command []string, stdin []byte) (string, int, error)
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
