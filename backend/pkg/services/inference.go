package services

import openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"

type InferenceServiceInterface interface {
	openshell.InferenceInterface
}

type InferenceService struct {
	openshell.InferenceInterface
}

func NewInferenceService(client openshell.InferenceInterface) *InferenceService {
	return &InferenceService{InferenceInterface: client}
}
