package services

import (
	openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"
)

type HealthServiceInterface interface {
	openshell.HealthInterface
}

type HealthService struct {
	openshell.HealthInterface
}

func NewHealthService(client openshell.HealthInterface) *HealthService {
	return &HealthService{HealthInterface: client}
}

// sdk overrides or additions here. if needed can wrap the sdk into a custom client as well
