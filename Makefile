GO_MODULE := github.com/Gkrumbach07/openshell-dashboard/backend

# Auto-source dev environment config if available (written by scripts/dev-env.sh)
-include scripts/.env.dev
export

.PHONY: setup dev dev-full dev-backend dev-frontend build build-frontend build-backend test lint typecheck clean

setup: ## Install frontend deps and Go deps
	cd frontend && npm install
	cd backend && go mod download

dev-full: ## Start Keycloak + gateway, then frontend + BFF (one command)
	./scripts/dev-env.sh start
	@$(MAKE) dev

dev: ## Start frontend dev server (:3000) and Go BFF (:8080)
	@$(MAKE) -j2 dev-backend dev-frontend

dev-backend:
	cd backend && go run ./cmd/server

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
