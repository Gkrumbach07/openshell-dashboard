package services

import (
	openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"
)

type ProviderServiceInterface interface {
	openshell.ProviderInterface
}

type ProviderService struct {
	openshell.ProviderInterface
}

func NewProviderService(client openshell.ProviderInterface) *ProviderService {
	return &ProviderService{ProviderInterface: client}
}

// sdk overrides or additions here. if needed can wrap the sdk into a custom client as well
