package openshell

import "context"

// MockFactory is a Factory that always hands back the same Client. Use it in
// tests and local dev to run without a live gateway.
type mockFactory struct {
	Client Client
}

// NewMockFactory wraps client in a Factory.
func NewMockFactory(client Client) Factory {
	return &mockFactory{Client: client}
}

func (f *mockFactory) NewClient(_ context.Context) (Client, error) {
	return f.Client, nil
}
