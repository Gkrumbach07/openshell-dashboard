package services

import (
	openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"
)

type ExecServiceInterface interface {
	openshell.ExecInterface
}

type ExecService struct {
	openshell.ExecInterface
}

func NewExecService(client openshell.ExecInterface) *ExecService {
	return &ExecService{ExecInterface: client}
}

// sdk overrides or additions here. if needed can wrap the sdk into a custom client as well
