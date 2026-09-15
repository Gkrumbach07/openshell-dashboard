package services

import (
	openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"
)

type PolicyServiceInterface interface {
	openshell.PolicyInterface
}

type PolicyService struct {
	openshell.PolicyInterface
}

func NewPolicyService(client openshell.PolicyInterface) *PolicyService {
	return &PolicyService{PolicyInterface: client}
}

// sdk overrides or additions here. if needed can wrap the sdk into a custom client as well
