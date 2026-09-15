package services

import openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"

type ServiceServiceInterface interface {
	openshell.ServiceInterface
}

type ServiceService struct {
	openshell.ServiceInterface
}

func NewServiceService(client openshell.ServiceInterface) ServiceServiceInterface {
	return &ServiceService{ServiceInterface: client}
}
