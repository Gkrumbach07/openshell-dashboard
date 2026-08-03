package models

import (
	"testing"

	datamodelv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/datamodelv1"
	openshellv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/openshellv1"
	sandboxv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/sandboxv1"
)

func TestFromWorkspacePhaseMapping(t *testing.T) {
	tests := []struct {
		phase datamodelv1.WorkspacePhase
		want  string
	}{
		{datamodelv1.WorkspacePhase_WORKSPACE_PHASE_ACTIVE, "ACTIVE"},
		{datamodelv1.WorkspacePhase_WORKSPACE_PHASE_TERMINATING, "TERMINATING"},
		{datamodelv1.WorkspacePhase_WORKSPACE_PHASE_UNSPECIFIED, "UNSPECIFIED"},
	}
	for _, tc := range tests {
		t.Run(tc.want, func(t *testing.T) {
			ws := &datamodelv1.Workspace{
				Metadata: &datamodelv1.ObjectMeta{Name: "test-ws"},
				Status:   &datamodelv1.WorkspaceStatus{Phase: tc.phase},
			}
			got := FromWorkspace(ws)
			if got.Phase != tc.want {
				t.Errorf("phase = %q, want %q", got.Phase, tc.want)
			}
			if got.Metadata.Name != "test-ws" {
				t.Errorf("name = %q, want test-ws", got.Metadata.Name)
			}
		})
	}
}

func TestFromWorkspaceNilStatus(t *testing.T) {
	ws := &datamodelv1.Workspace{
		Metadata: &datamodelv1.ObjectMeta{Name: "no-status"},
	}
	got := FromWorkspace(ws)
	if got.Phase != "UNSPECIFIED" {
		t.Errorf("phase = %q, want UNSPECIFIED", got.Phase)
	}
}

func TestFromWorkspaceMemberRoleMapping(t *testing.T) {
	tests := []struct {
		role openshellv1.WorkspaceRole
		want string
	}{
		{openshellv1.WorkspaceRole_WORKSPACE_ROLE_USER, "USER"},
		{openshellv1.WorkspaceRole_WORKSPACE_ROLE_ADMIN, "ADMIN"},
		{openshellv1.WorkspaceRole_WORKSPACE_ROLE_UNSPECIFIED, "UNSPECIFIED"},
	}
	for _, tc := range tests {
		t.Run(tc.want, func(t *testing.T) {
			member := &openshellv1.WorkspaceMember{
				Metadata:         &datamodelv1.ObjectMeta{Name: "m1"},
				PrincipalSubject: "user@example.com",
				Role:             tc.role,
			}
			got := FromWorkspaceMember(member)
			if got.Role != tc.want {
				t.Errorf("role = %q, want %q", got.Role, tc.want)
			}
			if got.PrincipalSubject != "user@example.com" {
				t.Errorf("subject = %q", got.PrincipalSubject)
			}
		})
	}
}

func TestWorkspaceRoleFromString(t *testing.T) {
	tests := []struct {
		input string
		want  openshellv1.WorkspaceRole
		ok    bool
	}{
		{"USER", openshellv1.WorkspaceRole_WORKSPACE_ROLE_USER, true},
		{"ADMIN", openshellv1.WorkspaceRole_WORKSPACE_ROLE_ADMIN, true},
		{"user", openshellv1.WorkspaceRole_WORKSPACE_ROLE_UNSPECIFIED, false},
		{"SUPERADMIN", openshellv1.WorkspaceRole_WORKSPACE_ROLE_UNSPECIFIED, false},
		{"", openshellv1.WorkspaceRole_WORKSPACE_ROLE_UNSPECIFIED, false},
	}
	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			got, ok := WorkspaceRoleFromString(tc.input)
			if ok != tc.ok {
				t.Errorf("ok = %v, want %v", ok, tc.ok)
			}
			if got != tc.want {
				t.Errorf("role = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestFromProviderProfile(t *testing.T) {
	profile := &openshellv1.ProviderProfile{
		Id:               "claude",
		DisplayName:      "Claude",
		Description:      "Anthropic Claude",
		Category:         openshellv1.ProviderProfileCategory_PROVIDER_PROFILE_CATEGORY_INFERENCE,
		InferenceCapable: true,
		Credentials: []*openshellv1.ProviderProfileCredential{
			{Name: "api_key", Description: "API key", Required: true, EnvVars: []string{"ANTHROPIC_API_KEY"}},
			{Name: "org_id", Description: "Organization ID", Required: false},
		},
		Endpoints: []*sandboxv1.NetworkEndpoint{
			{Host: "api.anthropic.com", Port: 443},
			{Host: "multi.example.com", Ports: []uint32{443, 8443}},
			{Host: "no-port.example.com"},
		},
	}

	got := FromProviderProfile(profile)

	if got.ID != "claude" {
		t.Errorf("ID = %q, want claude", got.ID)
	}
	if got.Category != "INFERENCE" {
		t.Errorf("category = %q, want INFERENCE", got.Category)
	}
	if !got.InferenceCapable {
		t.Error("inferenceCapable should be true")
	}
	if len(got.Credentials) != 2 {
		t.Fatalf("got %d credentials, want 2", len(got.Credentials))
	}
	if !got.Credentials[0].Required {
		t.Error("first credential should be required")
	}
	if got.Credentials[0].EnvVars[0] != "ANTHROPIC_API_KEY" {
		t.Errorf("envVars = %v", got.Credentials[0].EnvVars)
	}

	// Endpoints: api.anthropic.com:443, multi.example.com:443, multi.example.com:8443, no-port.example.com
	if len(got.Endpoints) != 4 {
		t.Fatalf("got %d endpoints, want 4; endpoints: %v", len(got.Endpoints), got.Endpoints)
	}
	if got.Endpoints[0] != "api.anthropic.com:443" {
		t.Errorf("endpoint[0] = %q", got.Endpoints[0])
	}
	if got.Endpoints[3] != "no-port.example.com" {
		t.Errorf("endpoint[3] = %q, want no-port.example.com", got.Endpoints[3])
	}
}

func TestFromProviderProfileCategoryMapping(t *testing.T) {
	tests := []struct {
		category openshellv1.ProviderProfileCategory
		want     string
	}{
		{openshellv1.ProviderProfileCategory_PROVIDER_PROFILE_CATEGORY_OTHER, "OTHER"},
		{openshellv1.ProviderProfileCategory_PROVIDER_PROFILE_CATEGORY_INFERENCE, "INFERENCE"},
		{openshellv1.ProviderProfileCategory_PROVIDER_PROFILE_CATEGORY_AGENT, "AGENT"},
		{openshellv1.ProviderProfileCategory_PROVIDER_PROFILE_CATEGORY_SOURCE_CONTROL, "SOURCE_CONTROL"},
		{openshellv1.ProviderProfileCategory_PROVIDER_PROFILE_CATEGORY_MESSAGING, "MESSAGING"},
		{openshellv1.ProviderProfileCategory_PROVIDER_PROFILE_CATEGORY_DATA, "DATA"},
		{openshellv1.ProviderProfileCategory_PROVIDER_PROFILE_CATEGORY_KNOWLEDGE, "KNOWLEDGE"},
		{openshellv1.ProviderProfileCategory_PROVIDER_PROFILE_CATEGORY_UNSPECIFIED, "UNSPECIFIED"},
	}
	for _, tc := range tests {
		t.Run(tc.want, func(t *testing.T) {
			got := profileCategoryString(tc.category)
			if got != tc.want {
				t.Errorf("got %q, want %q", got, tc.want)
			}
		})
	}
}

func TestFromGatewayInfo(t *testing.T) {
	tests := []struct {
		status openshellv1.ServiceStatus
		want   string
	}{
		{openshellv1.ServiceStatus_SERVICE_STATUS_HEALTHY, "HEALTHY"},
		{openshellv1.ServiceStatus_SERVICE_STATUS_DEGRADED, "DEGRADED"},
		{openshellv1.ServiceStatus_SERVICE_STATUS_UNHEALTHY, "UNHEALTHY"},
		{openshellv1.ServiceStatus_SERVICE_STATUS_UNSPECIFIED, "UNSPECIFIED"},
	}
	for _, tc := range tests {
		t.Run(tc.want, func(t *testing.T) {
			info := &openshellv1.GetGatewayInfoResponse{
				Status:         tc.status,
				GatewayVersion: "1.0",
				ComputeDrivers: []*openshellv1.ComputeDriverInfo{
					{
						Name: "podman",
						Capabilities: &openshellv1.ComputeDriverCapabilities{
							DriverName:    "podman",
							DriverVersion: "5.0",
						},
					},
				},
			}
			got := FromGatewayInfo(info)
			if got.Status != tc.want {
				t.Errorf("status = %q, want %q", got.Status, tc.want)
			}
			if got.GatewayVersion != "1.0" {
				t.Errorf("version = %q", got.GatewayVersion)
			}
			if len(got.ComputeDrivers) != 1 {
				t.Fatalf("got %d drivers, want 1", len(got.ComputeDrivers))
			}
			if got.ComputeDrivers[0].DriverVersion != "5.0" {
				t.Errorf("driver version = %q", got.ComputeDrivers[0].DriverVersion)
			}
		})
	}
}

func TestFromGatewayInfoEmptyDrivers(t *testing.T) {
	info := &openshellv1.GetGatewayInfoResponse{
		Status:         openshellv1.ServiceStatus_SERVICE_STATUS_HEALTHY,
		GatewayVersion: "0.1",
	}
	got := FromGatewayInfo(info)
	if len(got.ComputeDrivers) != 0 {
		t.Errorf("expected empty drivers, got %d", len(got.ComputeDrivers))
	}
}

func TestFromCredentialRefreshStatus(t *testing.T) {
	tests := []struct {
		strategy openshellv1.ProviderCredentialRefreshStrategy
		want     string
	}{
		{openshellv1.ProviderCredentialRefreshStrategy_PROVIDER_CREDENTIAL_REFRESH_STRATEGY_STATIC, "STATIC"},
		{openshellv1.ProviderCredentialRefreshStrategy_PROVIDER_CREDENTIAL_REFRESH_STRATEGY_EXTERNAL, "EXTERNAL"},
		{openshellv1.ProviderCredentialRefreshStrategy_PROVIDER_CREDENTIAL_REFRESH_STRATEGY_OAUTH2_REFRESH_TOKEN, "OAUTH2_REFRESH_TOKEN"},
		{openshellv1.ProviderCredentialRefreshStrategy_PROVIDER_CREDENTIAL_REFRESH_STRATEGY_OAUTH2_CLIENT_CREDENTIALS, "OAUTH2_CLIENT_CREDENTIALS"},
		{openshellv1.ProviderCredentialRefreshStrategy_PROVIDER_CREDENTIAL_REFRESH_STRATEGY_GOOGLE_SERVICE_ACCOUNT_JWT, "GOOGLE_SERVICE_ACCOUNT_JWT"},
		{openshellv1.ProviderCredentialRefreshStrategy_PROVIDER_CREDENTIAL_REFRESH_STRATEGY_AWS_STS_ASSUME_ROLE, "AWS_STS_ASSUME_ROLE"},
		{openshellv1.ProviderCredentialRefreshStrategy_PROVIDER_CREDENTIAL_REFRESH_STRATEGY_UNSPECIFIED, "UNSPECIFIED"},
	}
	for _, tc := range tests {
		t.Run(tc.want, func(t *testing.T) {
			status := &openshellv1.ProviderCredentialRefreshStatus{
				CredentialKey:   "api_key",
				Strategy:        tc.strategy,
				Status:          "active",
				ExpiresAtMs:     1000,
				NextRefreshAtMs: 2000,
				LastRefreshAtMs: 500,
				LastError:       "",
			}
			got := FromCredentialRefreshStatus(status)
			if got.Strategy != tc.want {
				t.Errorf("strategy = %q, want %q", got.Strategy, tc.want)
			}
			if got.CredentialKey != "api_key" {
				t.Errorf("credentialKey = %q", got.CredentialKey)
			}
			if got.ExpiresAtMs != 1000 {
				t.Errorf("expiresAtMs = %d", got.ExpiresAtMs)
			}
		})
	}
}

func TestFromObjectMetaNil(t *testing.T) {
	got := FromObjectMeta(nil)
	if got.Name != "" || got.ID != "" {
		t.Errorf("expected empty ObjectMeta, got %+v", got)
	}
}

func TestFromObjectMetaFields(t *testing.T) {
	meta := &datamodelv1.ObjectMeta{
		Id:                  "uuid-123",
		Name:                "test-name",
		Workspace:           "ws1",
		Labels:              map[string]string{"env": "prod"},
		Annotations:         map[string]string{"note": "important"},
		CreatedAtMs:         1234567890,
		ResourceVersion:     5,
		DeletionTimestampMs: 9999999999,
	}
	got := FromObjectMeta(meta)
	if got.ID != "uuid-123" {
		t.Errorf("ID = %q", got.ID)
	}
	if got.Name != "test-name" {
		t.Errorf("Name = %q", got.Name)
	}
	if got.Workspace != "ws1" {
		t.Errorf("Workspace = %q", got.Workspace)
	}
	if got.Labels["env"] != "prod" {
		t.Errorf("Labels = %v", got.Labels)
	}
	if got.ResourceVersion != 5 {
		t.Errorf("ResourceVersion = %d", got.ResourceVersion)
	}
	if got.DeletionTimestampMs != 9999999999 {
		t.Errorf("DeletionTimestampMs = %d", got.DeletionTimestampMs)
	}
}

func TestFromCurrentUser(t *testing.T) {
	resp := &openshellv1.GetCurrentUserResponse{
		Subject:          "sub-123",
		DisplayName:      "Test User",
		Roles:            []string{"openshell-admin", "openshell-user"},
		Scopes:           []string{"openid", "profile"},
		IdentityProvider: "keycloak",
	}
	got := FromCurrentUser(resp)
	if got.Subject != "sub-123" {
		t.Errorf("subject = %q", got.Subject)
	}
	if got.DisplayName != "Test User" {
		t.Errorf("displayName = %q", got.DisplayName)
	}
	if len(got.Roles) != 2 {
		t.Errorf("roles = %v", got.Roles)
	}
	if got.IdentityProvider != "keycloak" {
		t.Errorf("idp = %q", got.IdentityProvider)
	}
}
