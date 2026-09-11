package services

import (
	openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"
)

type ConfigServiceInterface interface {
	openshell.ConfigInterface
}

type ConfigService struct {
	openshell.ConfigInterface
}

func NewConfig(client openshell.ConfigInterface) *ConfigService {
	return &ConfigService{ConfigInterface: client}
}

// sdk overrides or additions here. if needed can wrap the sdk into a custom client as well
