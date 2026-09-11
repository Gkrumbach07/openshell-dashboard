package services

import openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"

type SandboxServiceInterface interface {
	openshell.SandboxInterface
}

type SandboxService struct {
	openshell.SandboxInterface
}

func NewSandboxService(client openshell.SandboxInterface) SandboxServiceInterface {
	return &SandboxService{SandboxInterface: client}
}
