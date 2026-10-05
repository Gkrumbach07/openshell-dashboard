#!/usr/bin/env bash
# Brings up the one real gateway this line is tested against, for the Cypress
# integration specs. Used by the e2e-integration job in ci.yml.
#
#   deploy/ci/e2e-stack.sh up | down | logs
#
# Gateway gRPC: localhost:8080    health: localhost:50052
#
# Every image comes from gateway-pins.json, pinned by digest. Nothing here
# falls back to a tag such as `latest`: the job this replaces loaded
# gateway:latest from a cache entry under a constant key, which is never
# rewritten once it exists, and so tested a gateway nobody could name.
#
# Gateway 0.0.116's Docker driver bind-mounts its supervisor binary and each
# sandbox's token into the sandbox containers BY HOST PATH, so the state
# directory must exist at /var/lib/openshell on the Docker host as well as
# inside the gateway container. On a Linux runner the Docker host is this
# machine. Where it is a VM, set OPENSHELL_HOST_EXEC to a command prefix that
# runs its arguments there — with colima on macOS:
#
#   OPENSHELL_HOST_EXEC="colima ssh --" deploy/ci/e2e-stack.sh up
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

PINS=gateway-pins.json
COMPOSE=(docker compose -f docker-compose.e2e.yml)
STATE_DIR=/var/lib/openshell
# Written into the state directory when this script creates it. /var/lib/openshell
# is also where a gateway installed on this host would keep its real data, so
# the script only ever deletes a directory that carries its own marker.
MARKER=$STATE_DIR/.e2e-stack
# Matches sandbox_namespace in gateway.e2e.toml.tmpl. The gateway labels every
# sandbox container with it, which is how leftovers are found.
SANDBOX_NAMESPACE=openshell-e2e

# This line supports exactly one gateway, so anything but one required lane is
# a mistake in the pins file rather than something to iterate over.
read_pins() {
  if [ "$(jq '[.lanes[] | select(.required == true)] | length' "$PINS")" != 1 ] ||
    [ "$(jq '.lanes | length' "$PINS")" != 1 ]; then
    echo "$PINS must hold exactly one lane, and it must be required" >&2
    exit 1
  fi
  OPENSHELL_GATEWAY_VERSION=$(jq -er '.lanes[0].version' "$PINS")
  OPENSHELL_GATEWAY_IMAGE=$(jq -er '.lanes[0].gateway_image' "$PINS")
  OPENSHELL_SUPERVISOR_IMAGE=$(jq -er '.lanes[0].supervisor_image' "$PINS")
  OPENSHELL_SANDBOX_IMAGE=$(jq -er '.sandbox_image' "$PINS")
  local image
  for image in "$OPENSHELL_GATEWAY_IMAGE" "$OPENSHELL_SUPERVISOR_IMAGE" "$OPENSHELL_SANDBOX_IMAGE"; do
    case "$image" in
      *@sha256:*) ;;
      *)
        echo "$image is not pinned by digest" >&2
        exit 1
        ;;
    esac
  done
  # docker-compose.e2e.yml refuses to run without it, for every subcommand.
  export OPENSHELL_GATEWAY_IMAGE
}

# Runs a shell snippet on the Docker host as root.
on_docker_host() {
  # shellcheck disable=SC2086 # OPENSHELL_HOST_EXEC is a command prefix, split on purpose
  ${OPENSHELL_HOST_EXEC:-} sudo sh -c "$1"
}

remove_sandboxes() {
  docker ps -aq --filter "label=openshell.ai/sandbox-namespace=$SANDBOX_NAMESPACE" | xargs -r docker rm -f >/dev/null
}

case "${1:-}" in
  up)
    read_pins
    echo "gateway    $OPENSHELL_GATEWAY_IMAGE"
    echo "supervisor $OPENSHELL_SUPERVISOR_IMAGE"
    echo "sandbox    $OPENSHELL_SANDBOX_IMAGE"

    # Pull everything up front, by digest. The gateway would pull the
    # supervisor and sandbox images itself on first use, but the sandbox image
    # is several gigabytes and that pull would land inside a spec's timeout.
    docker pull -q "$OPENSHELL_GATEWAY_IMAGE"
    docker pull -q "$OPENSHELL_SUPERVISOR_IMAGE"
    docker pull -q "$OPENSHELL_SANDBOX_IMAGE"

    # Start from empty state: a database left by an earlier run would carry
    # its workspaces and sandboxes into this one.
    "${COMPOSE[@]}" down -v >/dev/null 2>&1 || true
    remove_sandboxes
    on_docker_host "if [ -e $STATE_DIR ] && [ ! -e $MARKER ]; then echo '$STATE_DIR exists and was not created by e2e-stack.sh; refusing to replace it' >&2; exit 1; fi; rm -rf $STATE_DIR && mkdir -p $STATE_DIR/jwt && touch $MARKER && cd $STATE_DIR/jwt && openssl genpkey -algorithm Ed25519 -out signing.pem 2>/dev/null && openssl pkey -in signing.pem -pubout -out public.pem 2>/dev/null && openssl rand -hex 16 > kid && chmod -R 755 $STATE_DIR/jwt"

    mkdir -p .rendered
    sed \
      -e "s|\${OPENSHELL_SUPERVISOR_IMAGE}|$OPENSHELL_SUPERVISOR_IMAGE|g" \
      -e "s|\${OPENSHELL_SANDBOX_IMAGE}|$OPENSHELL_SANDBOX_IMAGE|g" \
      gateway.e2e.toml.tmpl >.rendered/gateway.toml

    "${COMPOSE[@]}" up -d
    echo "Waiting for the gateway to be healthy..."
    for _ in $(seq 1 100); do
      if curl -sf http://localhost:50052/healthz >/dev/null; then
        echo "Gateway $OPENSHELL_GATEWAY_VERSION is healthy (gRPC localhost:8080)"
        exit 0
      fi
      sleep 3
    done
    echo "Gateway failed to start — dumping logs:" >&2
    "${COMPOSE[@]}" logs --no-color --tail=100 >&2
    exit 1
    ;;
  down)
    read_pins
    "${COMPOSE[@]}" down -v || true
    remove_sandboxes || true
    on_docker_host "if [ -e $MARKER ]; then rm -rf $STATE_DIR; fi" || true
    rm -rf .rendered
    ;;
  logs)
    read_pins
    "${COMPOSE[@]}" logs --no-color "${@:2}"
    ;;
  *)
    echo "usage: $0 up|down|logs" >&2
    exit 2
    ;;
esac
