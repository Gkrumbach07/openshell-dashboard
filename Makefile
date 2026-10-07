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

# The gateway range this checkout supports, for the BFF's compatibility notice.
# It is DERIVED from the lanes CI requires in deploy/ci/gateway-pins.json —
# the lowest and the highest `version` among lanes with required=true — and
# never restated here, so a dev BFF claims exactly what the compat suite proves.
#
# $(call gateway_supported,.[0]) is the floor and $(call gateway_supported,.[-1])
# the ceiling. Both come out empty when jq is not installed or the pins cannot
# be read as plain x.y.z versions, and the BFF then reports compatibility as
# "unknown" rather than guessing a range.
GATEWAY_PINS := deploy/ci/gateway-pins.json
gateway_supported = $(shell jq -r '[.lanes[] | select(.required == true) | .version] | sort_by(split(".") | map(tonumber)) | $(1) // empty' $(GATEWAY_PINS) 2>/dev/null)

# Default auth-off for plain make dev. Override: AUTH_DISABLED=false make dev
# (or export AUTH_DISABLED=false). Ignores stale AUTH_DISABLED in scripts/.env.dev
# because that file is included as a make var but not exported to the shell.
#
# GATEWAY_SUPPORTED_MIN / GATEWAY_SUPPORTED_MAX default to the derived range.
# A value already in the environment wins, including an empty one, which turns
# the notice off: GATEWAY_SUPPORTED_MIN= GATEWAY_SUPPORTED_MAX= make dev
dev-backend:
	cd backend && AUTH_DISABLED=$${AUTH_DISABLED:-true} \
		GATEWAY_SUPPORTED_MIN=$${GATEWAY_SUPPORTED_MIN-$(call gateway_supported,.[0])} \
		GATEWAY_SUPPORTED_MAX=$${GATEWAY_SUPPORTED_MAX-$(call gateway_supported,.[-1])} \
		go run ./cmd/server

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
