.PHONY: start build build-all test vet clean

GO ?= go
GOOS ?= $(shell $(GO) env GOOS)
GOARCH ?= $(shell $(GO) env GOARCH)
CGO_ENABLED ?= 0
GOFLAGS ?=
LDFLAGS ?=
TAGS ?=
RUN_ARGS ?=
TEST_FLAGS ?=
TARGETS ?= linux/amd64 linux/arm64 darwin/amd64 darwin/arm64 windows/amd64

ifeq ($(GOOS),windows)
EXE := .exe
endif

BINARY ?= bin/openshell-dashboard-$(GOOS)-$(GOARCH)$(EXE)
BUILD_FLAGS := $(GOFLAGS) $(if $(TAGS),-tags "$(TAGS)") $(if $(LDFLAGS),-ldflags "$(LDFLAGS)")

start:
	$(GO) run $(GOFLAGS) ./cmd/server -- $(RUN_ARGS)

build:
	mkdir -p $(dir $(BINARY))
	CGO_ENABLED=$(CGO_ENABLED) GOOS=$(GOOS) GOARCH=$(GOARCH) $(GO) build $(BUILD_FLAGS) -o $(BINARY) ./cmd/server

build-all:
	@set -e; for target in $(TARGETS); do \
		os=$${target%/*}; arch=$${target#*/}; \
		$(MAKE) build GOOS=$$os GOARCH=$$arch; \
	done

test:
	$(GO) test $(GOFLAGS) $(TEST_FLAGS) ./...

vet:
	$(GO) vet $(GOFLAGS) ./...

clean:
	rm -rf bin
