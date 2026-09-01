package openshell

import (
	"context"
	"os"

	ops "github.com/rhuss/openshell-sdk-go/openshell/v1"
)

type realClientFactory struct {
	target string
}

func NewFactory(target string) Factory {
	return &realClientFactory{target: target}
}

func (f *realClientFactory) NewClient(_ context.Context, config ClientConfig) (ops.ClientInterface, error) {
	// TODO: dial f.target (with TLS as configured), attach the caller's
	// bearer token from ctx, and return a Client backed by the generated
	// gRPC stubs (datamodelv1/openshellv1/sandboxv1/inferencev1).

	client, err := ops.NewClient(ops.Config{
		Address: config.Address,
		Auth:    ops.StaticToken(os.Getenv("OPENSHELL_TOKEN")),
	})
	if err != nil {
		return nil, err
	}

	return client, nil
}
