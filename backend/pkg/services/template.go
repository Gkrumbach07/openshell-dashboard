package services

import (
	"context"

	openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"
)

type TemplateServiceInterface interface {
	openshell.SandboxTemplateInterface
	CreateSandboxFromTemplate(ctx context.Context, workspace, name, templateName string, spec *openshell.SandboxSpec, labels map[string]string, opts ...openshell.CreateOptions) (*openshell.Sandbox, error)
}

type TemplateService struct {
	client openshell.ClientInterface
	openshell.SandboxTemplateInterface
}

func NewTemplateService(client openshell.ClientInterface) TemplateServiceInterface {
	return &TemplateService{
		client:                   client,
		SandboxTemplateInterface: client.SandboxTemplates(),
	}
}

func (s *TemplateService) CreateSandboxFromTemplate(
	ctx context.Context,
	workspace, name, templateName string,
	spec *openshell.SandboxSpec,
	labels map[string]string,
	opts ...openshell.CreateOptions,
) (*openshell.Sandbox, error) {
	return s.client.CreateSandboxFromTemplate(ctx, workspace, name, templateName, spec, labels, opts...)
}
