# Auto-source dev environment config if available (written by scripts/dev-env.sh).
-include scripts/.env.dev
export OPENSHELL_DIR OPENSHELL_GATEWAY_URL GATEWAY_CA_CERT OIDC_ISSUER OIDC_CLIENT_ID

.PHONY: setup dev dev-full dev-backend dev-frontend build build-frontend build-backend test lint lint-go typecheck format format-check clean

setup: ## Install frontend deps and Go deps
	cd frontend && npm install
	cd backend && go mod download

dev-full: ## Start Keycloak + gateway, then frontend + BFF (one command)
	./scripts/dev-env.sh start
	@$(MAKE) dev

dev: ## Start frontend dev server (:3000) and Go BFF (:8080)
	@$(MAKE) -j2 dev-backend dev-frontend

# Default auth-off for plain make dev. Override: AUTH_DISABLED=false make dev
# (or export AUTH_DISABLED=false). Ignores stale AUTH_DISABLED in scripts/.env.dev
# because that file is included as a make var but not exported to the shell.
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

lint: ## eslint + golangci-lint + prettier check
	cd frontend && npm run lint
	cd frontend && npm run format:check
	$(MAKE) lint-go

lint-go: ## golangci-lint (requires golangci-lint installed)
	cd backend && golangci-lint run ./...

typecheck: ## tsc --noEmit
	cd frontend && npm run typecheck

format: ## Auto-format frontend code with Prettier
	cd frontend && npm run format

format-check: ## Check frontend formatting without writing
	cd frontend && npm run format:check

clean:
	rm -rf frontend/dist backend/bin
