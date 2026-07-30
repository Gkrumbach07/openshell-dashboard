GO_MODULE := github.com/Gkrumbach07/openshell-dashboard/backend
PROTO_DIR := backend/proto
GEN_DIR := backend/gen
PROTO_FILES := options.proto datamodel.proto sandbox.proto inference.proto openshell.proto

# Map each proto file to its generated Go package import path.
PROTO_GO_OPTS := \
	--go_opt=Moptions.proto=$(GO_MODULE)/gen/optionsv1 \
	--go_opt=Mdatamodel.proto=$(GO_MODULE)/gen/datamodelv1 \
	--go_opt=Msandbox.proto=$(GO_MODULE)/gen/sandboxv1 \
	--go_opt=Minference.proto=$(GO_MODULE)/gen/inferencev1 \
	--go_opt=Mopenshell.proto=$(GO_MODULE)/gen/openshellv1
PROTO_GRPC_OPTS := \
	--go-grpc_opt=Moptions.proto=$(GO_MODULE)/gen/optionsv1 \
	--go-grpc_opt=Mdatamodel.proto=$(GO_MODULE)/gen/datamodelv1 \
	--go-grpc_opt=Msandbox.proto=$(GO_MODULE)/gen/sandboxv1 \
	--go-grpc_opt=Minference.proto=$(GO_MODULE)/gen/inferencev1 \
	--go-grpc_opt=Mopenshell.proto=$(GO_MODULE)/gen/openshellv1

.PHONY: setup proto dev dev-backend dev-frontend build build-frontend build-backend test lint typecheck clean

setup: ## Install frontend deps and Go deps
	cd frontend && npm install
	cd backend && go mod download

proto: ## Regenerate Go stubs from backend/proto/*.proto into backend/gen/
	rm -rf $(GEN_DIR)
	mkdir -p $(GEN_DIR)
	protoc -I $(PROTO_DIR) \
		--go_out=$(GEN_DIR) --go_opt=module=$(GO_MODULE)/gen $(PROTO_GO_OPTS) \
		--go-grpc_out=$(GEN_DIR) --go-grpc_opt=module=$(GO_MODULE)/gen $(PROTO_GRPC_OPTS) \
		$(addprefix $(PROTO_DIR)/,$(PROTO_FILES))
	cd backend && go mod tidy

dev: ## Start frontend dev server (:3000) and Go BFF (:8080)
	@$(MAKE) -j2 dev-backend dev-frontend

dev-backend:
	cd backend && AUTH_DISABLED=$${AUTH_DISABLED:-true} go run ./cmd/server

dev-frontend:
	cd frontend && npm start

build: ## Build the container image (BFF + static frontend)
	docker build -t openshell-dashboard:latest -f deploy/Dockerfile .

build-frontend:
	cd frontend && npm run build

build-backend:
	cd backend && go build -o bin/server ./cmd/server

test: ## Frontend unit tests + go tests
	cd frontend && npm test -- --passWithNoTests
	cd backend && go test ./...

lint: ## eslint + go vet (golangci-lint if installed)
	cd frontend && npm run lint
	cd backend && go vet ./... && { command -v golangci-lint >/dev/null && golangci-lint run ./... || true; }

typecheck: ## tsc --noEmit
	cd frontend && npm run typecheck

clean:
	rm -rf frontend/dist backend/bin
