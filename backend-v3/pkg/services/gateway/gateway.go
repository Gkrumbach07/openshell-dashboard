package services

import "context"

// or package gateway

type GatewayService interface {
	GetGatewayInfo(ctx context.Context) any
	GetUserInfo(ctx context.Context) any
	// etc...
}

type gatewayService struct {
	// fields...
}

// default implementation
func NewDefaultGatewayService(parameters []string) GatewayService {
	return &gatewayService{
		// ...
	}
}

func (g *gatewayService) GetGatewayInfo(ctx context.Context) any { return nil }

func (g *gatewayService) GetUserInfo(ctx context.Context) any { return nil }
