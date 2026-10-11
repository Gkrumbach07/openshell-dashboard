package services

import "context"

// AllWorkspacesProviderCredentialKeyReader reads the keys of the credentials
// held by every provider on the gateway, across workspaces. It is the
// all-workspaces form of ProviderCredentialKeyReader.ListProviderCredentialKeys
// and exists for the same reason: the gateway reports the keys and the SDK
// drops them. Keys only: a credential's value is never read. Implemented by
// clients.RawExecClient.
//
// It is an interface of its own, not a method of ProviderCredentialKeyReader.
// With a reader that lacks it, which only unit tests have, the providers of
// the all-workspaces list keep whatever credential names the SDK carries.
type AllWorkspacesProviderCredentialKeyReader interface {
	// ListProviderCredentialKeysAllWorkspaces returns the keys each provider
	// holds, by workspace and then by provider name. A provider name is only
	// unique within its workspace.
	ListProviderCredentialKeysAllWorkspaces(ctx context.Context) (map[string]map[string][]string, error)
}
