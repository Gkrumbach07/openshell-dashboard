package gateway

import (
	"context"

	datamodelv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/datamodelv1"
	openshellv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/openshellv1"
)

// CreateProvider registers a provider in a workspace. Credentials are secret
// fields — callers must never echo them back to the browser.
func (c *Client) CreateProvider(ctx context.Context, workspace string, provider *datamodelv1.Provider) (*datamodelv1.Provider, error) {
	resp, err := c.openshell.CreateProvider(ctx, &openshellv1.CreateProviderRequest{
		Provider:  provider,
		Workspace: workspace,
	})
	if err != nil {
		return nil, err
	}
	return resp.Provider, nil
}

// GetProvider fetches a provider by name within a workspace.
func (c *Client) GetProvider(ctx context.Context, workspace, name string) (*datamodelv1.Provider, error) {
	resp, err := c.openshell.GetProvider(ctx, &openshellv1.GetProviderRequest{
		Name:      name,
		Workspace: workspace,
	})
	if err != nil {
		return nil, err
	}
	return resp.Provider, nil
}

// ListProviders lists providers in a workspace.
func (c *Client) ListProviders(ctx context.Context, workspace string, limit, offset uint32) ([]*datamodelv1.Provider, error) {
	resp, err := c.openshell.ListProviders(ctx, &openshellv1.ListProvidersRequest{
		Limit:     limit,
		Offset:    offset,
		Workspace: workspace,
	})
	if err != nil {
		return nil, err
	}
	return resp.Providers, nil
}

// DeleteProvider deletes a provider by name.
func (c *Client) DeleteProvider(ctx context.Context, workspace, name string) (bool, error) {
	resp, err := c.openshell.DeleteProvider(ctx, &openshellv1.DeleteProviderRequest{
		Name:      name,
		Workspace: workspace,
	})
	if err != nil {
		return false, err
	}
	return resp.Deleted, nil
}

// UpdateProvider updates a provider's credentials and config.
func (c *Client) UpdateProvider(ctx context.Context, workspace string, provider *datamodelv1.Provider, credentialExpiresAtMs map[string]int64) (*datamodelv1.Provider, error) {
	resp, err := c.openshell.UpdateProvider(ctx, &openshellv1.UpdateProviderRequest{
		Provider:             provider,
		CredentialExpiresAtMs: credentialExpiresAtMs,
		Workspace:            workspace,
	})
	if err != nil {
		return nil, err
	}
	return resp.Provider, nil
}

// GetProviderRefreshStatus returns credential refresh status for a provider.
func (c *Client) GetProviderRefreshStatus(ctx context.Context, workspace, provider, credentialKey string) (*openshellv1.GetProviderRefreshStatusResponse, error) {
	return c.openshell.GetProviderRefreshStatus(ctx, &openshellv1.GetProviderRefreshStatusRequest{
		Provider:      provider,
		CredentialKey: credentialKey,
		Workspace:     workspace,
	})
}

// ConfigureProviderRefresh sets up automatic credential refresh for a provider.
func (c *Client) ConfigureProviderRefresh(ctx context.Context, workspace, provider, credentialKey string, strategy openshellv1.ProviderCredentialRefreshStrategy, material map[string]string, secretMaterialKeys []string, expiresAtMs *int64) (*openshellv1.ConfigureProviderRefreshResponse, error) {
	req := &openshellv1.ConfigureProviderRefreshRequest{
		Provider:           provider,
		CredentialKey:      credentialKey,
		Strategy:           strategy,
		Material:           material,
		SecretMaterialKeys: secretMaterialKeys,
		Workspace:          workspace,
	}
	if expiresAtMs != nil {
		req.ExpiresAtMs = expiresAtMs
	}
	return c.openshell.ConfigureProviderRefresh(ctx, req)
}

// RotateProviderCredential triggers an immediate credential rotation.
func (c *Client) RotateProviderCredential(ctx context.Context, workspace, provider, credentialKey string) (*openshellv1.RotateProviderCredentialResponse, error) {
	return c.openshell.RotateProviderCredential(ctx, &openshellv1.RotateProviderCredentialRequest{
		Provider:      provider,
		CredentialKey: credentialKey,
		Workspace:     workspace,
	})
}

// DeleteProviderRefresh removes credential refresh configuration.
func (c *Client) DeleteProviderRefresh(ctx context.Context, workspace, provider, credentialKey string) (bool, error) {
	resp, err := c.openshell.DeleteProviderRefresh(ctx, &openshellv1.DeleteProviderRefreshRequest{
		Provider:      provider,
		CredentialKey: credentialKey,
		Workspace:     workspace,
	})
	if err != nil {
		return false, err
	}
	return resp.Deleted, nil
}

// ListProviderProfiles lists provider type profiles visible in a workspace
// (workspace-scoped + built-in when workspace is set; platform + built-in when
// empty). Profile ids are the valid Provider.type slugs.
func (c *Client) ListProviderProfiles(ctx context.Context, workspace string, limit, offset uint32) ([]*openshellv1.ProviderProfile, error) {
	resp, err := c.openshell.ListProviderProfiles(ctx, &openshellv1.ListProviderProfilesRequest{
		Limit:     limit,
		Offset:    offset,
		Workspace: workspace,
	})
	if err != nil {
		return nil, err
	}
	return resp.Profiles, nil
}

// GetProviderProfile fetches a single profile with two-tier resolution
// (workspace → platform → built-in).
func (c *Client) GetProviderProfile(ctx context.Context, id, workspace string) (*openshellv1.ProviderProfile, error) {
	resp, err := c.openshell.GetProviderProfile(ctx, &openshellv1.GetProviderProfileRequest{
		Id:        id,
		Workspace: workspace,
	})
	if err != nil {
		return nil, err
	}
	return resp.Profile, nil
}

// ImportProviderProfiles batch-imports custom profiles (admin only).
func (c *Client) ImportProviderProfiles(ctx context.Context, workspace string, profiles []*openshellv1.ProviderProfileImportItem) (*openshellv1.ImportProviderProfilesResponse, error) {
	return c.openshell.ImportProviderProfiles(ctx, &openshellv1.ImportProviderProfilesRequest{
		Profiles:  profiles,
		Workspace: workspace,
	})
}

// UpdateProviderProfile updates a single custom profile with optimistic concurrency.
func (c *Client) UpdateProviderProfile(ctx context.Context, workspace, id string, profile *openshellv1.ProviderProfileImportItem, expectedResourceVersion uint64) (*openshellv1.UpdateProviderProfilesResponse, error) {
	return c.openshell.UpdateProviderProfiles(ctx, &openshellv1.UpdateProviderProfilesRequest{
		Profile:                 profile,
		ExpectedResourceVersion: expectedResourceVersion,
		Id:                      id,
		Workspace:               workspace,
	})
}

// DeleteProviderProfile deletes a custom profile by id.
func (c *Client) DeleteProviderProfile(ctx context.Context, id, workspace string) (bool, error) {
	resp, err := c.openshell.DeleteProviderProfile(ctx, &openshellv1.DeleteProviderProfileRequest{
		Id:        id,
		Workspace: workspace,
	})
	if err != nil {
		return false, err
	}
	return resp.Deleted, nil
}

// LintProviderProfiles validates profiles without persisting.
func (c *Client) LintProviderProfiles(ctx context.Context, workspace string, profiles []*openshellv1.ProviderProfileImportItem) (*openshellv1.LintProviderProfilesResponse, error) {
	return c.openshell.LintProviderProfiles(ctx, &openshellv1.LintProviderProfilesRequest{
		Profiles:  profiles,
		Workspace: workspace,
	})
}
