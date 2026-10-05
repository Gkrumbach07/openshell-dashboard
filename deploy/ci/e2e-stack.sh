#!/usr/bin/env bash
# Brings the OpenShell gateway stack up or down for the compat suite
# (backend/test/compat). Used by CI's version matrix and usable locally.
#
#   OPENSHELL_VERSION=0.1.2 deploy/ci/e2e-stack.sh up
#   deploy/ci/e2e-stack.sh down
#
# OPENSHELL_VERSION picks the gateway AND supervisor tag — they are released
# together and must match. The community sandbox image publishes no semver
# tags, so it is pinned separately (COMPAT_SANDBOX_IMAGE, defaulting to
# sandbox_image in gateway-pins.json) and deliberately does NOT move with the
# gateway version.
#
# This script only ever changes the GATEWAY side. Which SDK the BFF is built
# against is whatever backend/go.mod says; the two are separate links and are
# tested separately (ADR 0006).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

# CI never relies on this default: every lane and every sweep leg passes
# OPENSHELL_GATEWAY_IMAGE / OPENSHELL_SUPERVISOR_IMAGE as tag@digest. `latest`
# is the newest upstream RELEASE (`dev` is upstream HEAD), which is a sensible
# thing to try locally but a moving tag, so not something to pin.
VERSION="${OPENSHELL_VERSION:-latest}"
export OPENSHELL_GATEWAY_IMAGE="${OPENSHELL_GATEWAY_IMAGE:-ghcr.io/nvidia/openshell/gateway:${VERSION}}"
export OPENSHELL_SUPERVISOR_IMAGE="${OPENSHELL_SUPERVISOR_IMAGE:-ghcr.io/nvidia/openshell/supervisor:${VERSION}}"
# The workload image is pinned by digest in gateway-pins.json. Fall back to the
# moving tag only when jq is not installed, so a local run still works.
if [ -z "${COMPAT_SANDBOX_IMAGE:-}" ] && command -v jq >/dev/null 2>&1; then
  COMPAT_SANDBOX_IMAGE="$(jq -er '.sandbox_image' gateway-pins.json 2>/dev/null || true)"
fi
export COMPAT_SANDBOX_IMAGE="${COMPAT_SANDBOX_IMAGE:-ghcr.io/nvidia/openshell-community/sandboxes/base:latest}"

# The gateway's own config file is versioned and the schemas are mutually
# exclusive: 0.1.0 and newer require v2, releases up to 0.0.116 require v1.
# Defaults to v2 because every gateway main supports (0.1.0 and newer) needs it.
#
# `auto` tries v2 and falls back to v1 when the gateway rejects the config
# version. The compat sweep's gateway axis needs this because it can cross a
# schema boundary and cannot know in advance which side a release sits on.
# Under GitHub Actions the schema the gateway accepted is written to the step
# output `config_schema`, so the sweep can record it in the lane it proposes.
OPENSHELL_CONFIG_SCHEMA="${OPENSHELL_CONFIG_SCHEMA:-v2}"

# Callback address the in-sandbox supervisor uses to reach the gateway.
# Sandbox containers are created by the gateway directly on the host daemon
# (docker-outside-of-docker), so they are siblings of the gateway container and
# do NOT inherit its compose `extra_hosts` aliases. Override this when the
# default alias is not resolvable from a sibling container.
OPENSHELL_GRPC_ENDPOINT="${OPENSHELL_GRPC_ENDPOINT:-http://host.openshell.internal:8080}"

STATE_DIR="${OPENSHELL_STATE_DIR:-/var/lib/openshell}"
export OPENSHELL_STATE_DIR="$STATE_DIR"
COMPOSE="docker compose -f docker-compose.e2e.yml"
RESOLVED_SCHEMA=""

# sudo only when we cannot already write the state dir (CI runners need it,
# a local docker-desktop user often does not).
as_root() {
  if [ -w "$(dirname "$STATE_DIR")" ] || [ -w "$STATE_DIR" ] 2>/dev/null; then
    "$@"
  else
    sudo "$@"
  fi
}

# wait_for POLLS a URL until it answers 200 or the budget runs out. Written in
# plain bash because `timeout` is GNU coreutils and is not installed on stock
# macOS, where this script is expected to work for local runs.
# wait_for_gateway waits for health, but gives up as soon as the gateway
# container has exited. A rejected config kills it in under a second, so
# without this the auto fallback would burn the full health budget before
# trying the other schema.
wait_for_gateway() {
  local budget="$1" waited=0
  while [ "$waited" -lt "$budget" ]; do
    if curl -sf http://localhost:50052/healthz >/dev/null 2>&1; then
      return 0
    fi
    if [ -z "$($COMPOSE ps -q --status running gateway 2>/dev/null)" ]; then
      echo "e2e-stack: gateway container is no longer running" >&2
      return 1
    fi
    sleep 2
    waited=$((waited + 2))
  done
  return 1
}

wait_for() {
  local url="$1" budget="$2" waited=0
  while [ "$waited" -lt "$budget" ]; do
    if curl -sf "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
    waited=$((waited + 2))
  done
  return 1
}

# render_config <schema>
render_config() {
  local schema="$1"
  mkdir -p .rendered
  local tmpl="gateway.e2e.${schema}.toml.tmpl"
  if [ ! -f "$tmpl" ]; then
    echo "e2e-stack: no config template for schema '${schema}' ($tmpl)" >&2
    exit 1
  fi
  echo "e2e-stack: config schema=${schema} ($tmpl)"
  echo "e2e-stack: supervisor callback=${OPENSHELL_GRPC_ENDPOINT}"
  # envsubst would be another dependency; restrict substitution to the two
  # image placeholders so nothing else in the TOML is touched.
  sed -e "s|\${OPENSHELL_SUPERVISOR_IMAGE}|${OPENSHELL_SUPERVISOR_IMAGE}|g" \
      -e "s|\${COMPAT_SANDBOX_IMAGE}|${COMPAT_SANDBOX_IMAGE}|g" \
      -e "s|\${OPENSHELL_GRPC_ENDPOINT}|${OPENSHELL_GRPC_ENDPOINT}|g" \
      "$tmpl" > .rendered/gateway.toml
  if grep -q '\${' .rendered/gateway.toml; then
    echo "e2e-stack: unsubstituted placeholder left in rendered config:" >&2
    grep -n '\${' .rendered/gateway.toml >&2
    exit 1
  fi
}

ensure_jwt_keys() {
  if [ -f "$STATE_DIR/jwt/signing.pem" ]; then
    return
  fi
  as_root mkdir -p "$STATE_DIR/jwt"
  as_root openssl genpkey -algorithm Ed25519 -out "$STATE_DIR/jwt/signing.pem" 2>/dev/null
  as_root openssl pkey -in "$STATE_DIR/jwt/signing.pem" -pubout -out "$STATE_DIR/jwt/public.pem" 2>/dev/null
  as_root openssl rand -hex 16 | as_root tee "$STATE_DIR/jwt/kid" > /dev/null
  as_root chmod -R 755 "$STATE_DIR/jwt"
}

up() {
  echo "e2e-stack: gateway=${OPENSHELL_GATEWAY_IMAGE}"
  echo "e2e-stack: supervisor=${OPENSHELL_SUPERVISOR_IMAGE}"
  echo "e2e-stack: sandbox=${COMPAT_SANDBOX_IMAGE}"

  as_root mkdir -p "$STATE_DIR"
  ensure_jwt_keys

  # try_schema prints the gateway's log itself when an attempt fails. By the
  # time it returns, the stack is down again and there is nothing left to ask.
  if [ "$OPENSHELL_CONFIG_SCHEMA" = "auto" ]; then
    try_schema v2 || try_schema v1 || {
      echo "e2e-stack: gateway did not start under either config schema (logs of both attempts above)" >&2
      exit 1
    }
  else
    try_schema "$OPENSHELL_CONFIG_SCHEMA" || {
      echo "e2e-stack: gateway did not become healthy (logs above)" >&2
      exit 1
    }
  fi
  echo "e2e-stack: gateway healthy (config schema ${RESOLVED_SCHEMA})"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    echo "config_schema=${RESOLVED_SCHEMA}" >> "$GITHUB_OUTPUT"
  fi
}

# try_schema renders the given schema, starts the stack, and returns non-zero
# if the gateway never reports healthy. Leaves the stack down on failure so the
# next attempt starts clean - and prints the gateway's log BEFORE doing so,
# because `docker compose logs` has nothing to show once the containers are
# gone. A sweep leg whose gateway never started used to end with two status
# lines and a report telling the reader to "read the stack log".
try_schema() {
  local schema="$1" logs
  render_config "$schema"
  $COMPOSE up -d

  echo "e2e-stack: waiting for gateway health (schema ${schema})..."
  if wait_for_gateway 300; then
    RESOLVED_SCHEMA="$schema"
    return 0
  fi

  # Read once, into a variable: it is searched and then printed.
  logs="$($COMPOSE logs 2>&1 || true)"

  # The two directions fail differently, so match both shapes:
  #   v1 config on a v2 build -> "unsupported gateway config version 1"
  #   v2 config on a v1 build -> "unknown field `compute_driver`" (TOML parse)
  # This only picks the log message; the fallback happens either way.
  if grep -qE "unsupported gateway config version|unknown field|failed to parse gateway config" <<<"$logs"; then
    echo "e2e-stack: gateway rejected config schema ${schema}" >&2
  else
    echo "e2e-stack: gateway unhealthy under schema ${schema} (not a config rejection)" >&2
  fi
  echo "e2e-stack: gateway logs under schema ${schema} (last 120 lines):" >&2
  tail -n 120 <<<"$logs" >&2
  $COMPOSE down -v >/dev/null 2>&1 || true
  return 1
}

down() {
  $COMPOSE down -v || true
  docker ps -aq --filter "name=openshell-e2e" | xargs -r docker rm -f || true
  rm -rf .rendered
}

# run is the one-shot local path: stack up, BFF up, compat suite, always clean
# up. CI drives up/down separately so it can attach its own steps in between.
run() {
  local repo bff_pid status=0
  repo="$(cd ../.. && pwd)"

  up
  trap down EXIT

  echo "e2e-stack: building BFF..."
  (cd "$repo/backend" && go build -o "$repo/bin/server" ./cmd/server)

  AUTH_DISABLED=true OPENSHELL_GATEWAY_URL=localhost:8080 PORT=9080 "$repo/bin/server" &
  bff_pid=$!
  # shellcheck disable=SC2064
  trap "kill $bff_pid 2>/dev/null || true; down" EXIT

  if ! wait_for http://localhost:9080/api/v1/healthz 60; then
    echo "e2e-stack: BFF did not become healthy" >&2
    exit 1
  fi
  echo "e2e-stack: BFF healthy — running compat suite"

  # -count=1: the suite talks to a live gateway, which Go's test cache cannot
  # see. Without it a second run against a DIFFERENT gateway replays the first
  # run's result as "ok (cached)".
  (cd "$repo/backend" && BFF_URL=http://localhost:9080 go test -tags compat -count=1 -v -timeout 20m ./test/compat/...) || status=$?
  return $status
}

case "${1:-}" in
  up)   up ;;
  down) down ;;
  run)  run ;;
  *)    echo "usage: $0 {up|down|run}" >&2; exit 2 ;;
esac
