package models

import (
	"encoding/json"
	"testing"

	openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"
)

func TestBuildSDKSandboxSpecBasic(t *testing.T) {
	req := CreateSandboxRequest{
		Name:  "test-sandbox",
		Image: "ubuntu:latest",
		Policy: json.RawMessage(`{"version":1,"filesystem":{"includeWorkdir":true}}`),
	}
	spec, err := BuildSDKSandboxSpec(req)
	if err != nil {
		t.Fatalf("BuildSDKSandboxSpec: %v", err)
	}
	if spec.Template == nil || spec.Template.Image != "ubuntu:latest" {
		t.Errorf("image = %v, want ubuntu:latest", spec.Template)
	}
	if spec.Policy == nil || spec.Policy.Version != 1 {
		t.Errorf("policy version = %v, want 1", spec.Policy)
	}
	if spec.Policy.Filesystem == nil || !spec.Policy.Filesystem.IncludeWorkdir {
		t.Error("expected filesystem.includeWorkdir = true")
	}
}

func TestBuildSDKSandboxSpecWithGPU(t *testing.T) {
	req := CreateSandboxRequest{
		Name:     "gpu-sandbox",
		Image:    "nvidia/cuda",
		GpuCount: 2,
		Policy:   json.RawMessage(`{"version":1}`),
	}
	spec, err := BuildSDKSandboxSpec(req)
	if err != nil {
		t.Fatalf("BuildSDKSandboxSpec: %v", err)
	}
	if spec.GPUCount == nil || *spec.GPUCount != 2 {
		t.Errorf("GPUCount = %v, want 2", spec.GPUCount)
	}
}

func TestBuildSDKSandboxSpecWithCPUMemory(t *testing.T) {
	req := CreateSandboxRequest{
		Name:   "resource-sandbox",
		Image:  "ubuntu:latest",
		CPU:    "4",
		Memory: "8Gi",
		Policy: json.RawMessage(`{"version":1}`),
	}
	spec, err := BuildSDKSandboxSpec(req)
	if err != nil {
		t.Fatalf("BuildSDKSandboxSpec: %v", err)
	}
	if spec.Template.Resources == nil {
		t.Fatal("expected Template.Resources to be set")
	}
	limits, ok := spec.Template.Resources["limits"]
	if !ok {
		t.Fatal("expected resources.limits to be set")
	}
	limitsMap, ok := limits.(map[string]any)
	if !ok {
		t.Fatalf("limits is %T, want map[string]any", limits)
	}
	if limitsMap["cpu"] != "4" {
		t.Errorf("cpu = %v, want 4", limitsMap["cpu"])
	}
	if limitsMap["memory"] != "8Gi" {
		t.Errorf("memory = %v, want 8Gi", limitsMap["memory"])
	}
}

func TestBuildSDKSandboxSpecInvalidPolicy(t *testing.T) {
	req := CreateSandboxRequest{
		Name:   "bad-policy",
		Image:  "ubuntu:latest",
		Policy: json.RawMessage(`{invalid json`),
	}
	_, err := BuildSDKSandboxSpec(req)
	if err == nil {
		t.Fatal("expected error for invalid policy JSON")
	}
}

func TestFromSDKSandboxPhaseMapping(t *testing.T) {
	cases := []struct {
		phase openshell.SandboxPhase
		want  string
	}{
		{openshell.SandboxProvisioning, "PROVISIONING"},
		{openshell.SandboxReady, "READY"},
		{openshell.SandboxError, "ERROR"},
		{openshell.SandboxDeleting, "DELETING"},
		{openshell.SandboxUnknown, "UNKNOWN"},
	}
	for _, tc := range cases {
		t.Run(string(tc.phase), func(t *testing.T) {
			sb := &openshell.Sandbox{
				Status: openshell.SandboxStatus{Phase: tc.phase},
			}
			result := FromSDKSandbox(sb)
			if result.Status.Phase != tc.want {
				t.Errorf("phase %q: got %q, want %q", tc.phase, result.Status.Phase, tc.want)
			}
		})
	}
}
