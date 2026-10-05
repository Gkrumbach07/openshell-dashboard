package services

import (
	"context"
	"testing"

	openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"
	"github.com/NVIDIA/OpenShell/sdk/go/openshell/v1/fake"
	"github.com/NVIDIA/OpenShell/sdk/go/proto/openshellv1"
	"github.com/NVIDIA/OpenShell/sdk/go/proto/optionsv1"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
)

// The default service is what gives every signed-in user a verdict, so it must
// keep offering the role-free version source.
var _ GatewayVersionReader = (*GatewayService)(nil)

// authorizationRule returns the authorization the gateway's proto declares for
// one OpenShell RPC, as compiled into the vendored SDK. It is the same
// descriptor option the gateway builds its own authorization table from.
func authorizationRule(t *testing.T, method string) *optionsv1.AuthorizationRule {
	t.Helper()
	service := openshellv1.File_openshell_proto.Services().ByName("OpenShell")
	if service == nil {
		t.Fatal("the SDK's proto has no OpenShell service")
	}
	descriptor := service.Methods().ByName(protoreflect.Name(method))
	if descriptor == nil {
		t.Fatalf("the SDK's proto has no OpenShell.%s RPC", method)
	}
	rule, ok := proto.GetExtension(descriptor.Options(), optionsv1.E_Authorization).(*optionsv1.AuthorizationRule)
	if !ok || rule == nil {
		t.Fatalf("OpenShell.%s declares no authorization rule", method)
	}
	return rule
}

// GET /gateway/compatibility is served to every signed-in user on the strength
// of two facts about the gateway's API, both read here from the SDK this
// build is pinned to rather than taken on trust:
//
//  1. the health check asks for no token and no role, and
//  2. its response carries the gateway's version.
//
// If an SDK bump changes either, this fails and the route's data source has to
// be rethought — before users without the admin role silently lose the notice.
func TestGatewayVersionSourceNeedsNoRole(t *testing.T) {
	health := authorizationRule(t, "Health")
	if health.GetAuthMode() != "unauthenticated" || health.GetGlobalRole() != "" || health.GetWorkspaceRole() != "" {
		t.Errorf("OpenShell.Health authorization = {auth_mode: %q, global_role: %q, workspace_role: %q}, want unauthenticated with no role",
			health.GetAuthMode(), health.GetGlobalRole(), health.GetWorkspaceRole())
	}

	response := (&openshellv1.HealthResponse{}).ProtoReflect().Descriptor()
	version := response.Fields().ByName("version")
	if version == nil || version.Kind() != protoreflect.StringKind {
		t.Errorf("HealthResponse has no string field named version: %v", version)
	}

	// Why the verdict cannot simply ride on GET /gateway: that RPC is for
	// platform admins. Logged rather than asserted — upstream relaxing it
	// would make the separate route unnecessary, not wrong.
	info := authorizationRule(t, "GetGatewayInfo")
	t.Logf("OpenShell.Health: auth_mode=%q; OpenShell.GetGatewayInfo: auth_mode=%q global_role=%q scope=%q",
		health.GetAuthMode(), info.GetAuthMode(), info.GetGlobalRole(), info.GetScope())
}

func TestGetGatewayVersion(t *testing.T) {
	sdk := fake.NewClient(fake.WithHealthResult(&openshell.HealthResult{
		Healthy: true,
		Version: "0.1.3-dev.84+ge7fdd6bee",
	}))
	service := NewGatewayService(sdk)

	// Exactly as reported: comparing it is the handler's job.
	version, err := service.GetGatewayVersion(context.Background())
	if err != nil {
		t.Fatalf("GetGatewayVersion: %v", err)
	}
	if version != "0.1.3-dev.84+ge7fdd6bee" {
		t.Errorf("version = %q, want the health check's version unchanged", version)
	}

	// A failed health check is an error, never an empty version that would
	// read as "the gateway reported nothing".
	if err := sdk.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	if version, err := service.GetGatewayVersion(context.Background()); err == nil {
		t.Errorf("GetGatewayVersion on an unreachable gateway = %q, want an error", version)
	}
}
