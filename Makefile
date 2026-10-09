# Auto-source dev environment config if available (written by scripts/dev-env.sh).
-include scripts/.env.dev
export OPENSHELL_DIR OPENSHELL_GATEWAY_URL GATEWAY_CA_CERT OIDC_ISSUER OIDC_CLIENT_ID

IMAGE_NAME ?= openshell-dashboard
TAG ?= latest
PLATFORMS ?= linux/amd64,linux/arm64

.PHONY: setup dev dev-full dev-backend dev-frontend build build-frontend build-backend test lint lint-go typecheck format format-check clean buildx

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
#
# Nothing is passed for the compatibility notice: the gateway release line the
# BFF is for is compiled in. To see the notice against a gateway of that line,
# start the BFF for another one: GATEWAY_RELEASE_LINE=9.9 make dev
dev-backend:
	cd backend && AUTH_DISABLED=$${AUTH_DISABLED:-true} go run ./cmd/server

dev-frontend:
	cd frontend && npm start

build: ## Build the container image (BFF + static frontend)
	docker build -t openshell-dashboard:latest -f deploy/Dockerfile .

buildx:
	docker buildx build \
		--platform ${PLATFORMS} \
		-t ${IMAGE_NAME}:${TAG} \
		-f deploy/Dockerfile \
		--load .

build-frontend:
	cd frontend && npm run build

build-backend:
	cd backend && go build -o bin/server ./cmd/server

.PHONY: test test-backend test-frontend
test: test-backend test-frontend ## Frontend unit tests + go tests

test-backend:
	cd backend && go test ./...

test-frontend:
	cd frontend && npm test -- --passWithNoTests

OPENSHELL_VERSION ?= latest
export OPENSHELL_VERSION

.PHONY: compat compat-up compat-down
compat: ## Gateway compat suite vs a real gateway (OPENSHELL_VERSION=0.1.2 make compat)
	deploy/ci/e2e-stack.sh run

compat-up: ## Bring up just the gateway stack (leaves it running)
	deploy/ci/e2e-stack.sh up

compat-down: ## Tear down the gateway stack
	deploy/ci/e2e-stack.sh down

.PHONY: helm-lint helm-test helm-docs
helm-lint: ## Lint and render Helm charts and their example values
	@set -eu; \
	for chart_file in deploy/helm/*/Chart.yaml; do \
		[ -f "$$chart_file" ] || continue; \
		chart=$${chart_file%/Chart.yaml}; \
		set --; \
		if [ "$$chart" = deploy/helm/openshell-dashboard ]; then \
			set -- --set-string oidc.issuer=https://idp.example.com/realms/openshell; \
		fi; \
		helm lint "$$chart" "$$@"; \
		helm template lint "$$chart" "$$@" >/dev/null; \
		for values in "$$chart"/ci/values-*.yaml; do \
			[ -f "$$values" ] || continue; \
			helm lint "$$chart" -f "$$values" "$$@"; \
			helm template lint "$$chart" -f "$$values" "$$@" >/dev/null; \
		done; \
	done

helm-test: ## Run unit tests for every Helm chart
	@set -eu; \
	for chart_file in deploy/helm/*/Chart.yaml; do \
		[ -f "$$chart_file" ] || continue; \
		helm unittest "$${chart_file%/Chart.yaml}"; \
	done

helm-docs: ## Generate documentation for every Helm chart via mise
	mise run helm:docs --chart-search-root deploy/helm

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
