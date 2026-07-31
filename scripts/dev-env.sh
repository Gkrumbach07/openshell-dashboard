#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PKI_DIR="$SCRIPT_DIR/.pki"
STATE_DIR="$SCRIPT_DIR/.state"
ENV_FILE="$SCRIPT_DIR/.env.dev"

resolve_openshell_dir() {
    if [ -n "${OPENSHELL_DIR:-}" ]; then
        return 0
    fi

    if [ -f "$ENV_FILE" ]; then
        local saved
        saved=$(grep '^OPENSHELL_DIR=' "$ENV_FILE" 2>/dev/null | cut -d= -f2-)
        if [ -n "$saved" ] && [ -d "$saved" ]; then
            OPENSHELL_DIR="$saved"
            return 0
        fi
    fi

    echo ""
    echo "OpenShell source directory not configured."
    echo ""
    echo "Where is your OpenShell checkout?"
    echo ""
    echo "  1) Enter a path"
    echo "  2) Clone from GitHub into ./openshell (next to this project)"
    echo ""
    printf "Choice [1/2]: "
    read -r choice

    case "$choice" in
        2)
            local clone_dir="$PROJECT_DIR/../openshell"
            if [ -d "$clone_dir" ] && [ -f "$clone_dir/Cargo.toml" ]; then
                echo "Found existing checkout at $clone_dir"
                OPENSHELL_DIR="$(cd "$clone_dir" && pwd)"
            else
                echo "Cloning NVIDIA/OpenShell..."
                git clone https://github.com/NVIDIA/OpenShell.git "$clone_dir" 2>&1
                OPENSHELL_DIR="$(cd "$clone_dir" && pwd)"
            fi
            ;;
        *)
            printf "Path to OpenShell source: "
            read -r user_path
            user_path="${user_path/#\~/$HOME}"
            if [ ! -d "$user_path" ] || [ ! -f "$user_path/Cargo.toml" ]; then
                error "Not a valid OpenShell checkout: $user_path"
                exit 1
            fi
            OPENSHELL_DIR="$(cd "$user_path" && pwd)"
            ;;
    esac

    echo "OPENSHELL_DIR=$OPENSHELL_DIR" >> "$ENV_FILE" 2>/dev/null || true
    export OPENSHELL_DIR
}

OPENSHELL_DIR="${OPENSHELL_DIR:-}"
KEYCLOAK_PORT="${KEYCLOAK_PORT:-8180}"
KEYCLOAK_CONTAINER="openshell-keycloak"
PODMAN_NETWORK="openshell-dev"
GATEWAY_GRPC_PORT=17670
GATEWAY_HTTP_PORT=17671
GATEWAY_PID_FILE="$STATE_DIR/gateway.pid"
GATEWAY_LOG_FILE="$STATE_DIR/gateway.log"
GATEWAY_CONFIG_FILE="$STATE_DIR/gateway.toml"
GATEWAY_DB_FILE="$STATE_DIR/gateway.db"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "  ${GREEN}✓${NC} $*"; }
warn()  { echo -e "  ${YELLOW}⚠${NC} $*"; }
error() { echo -e "  ${RED}✗${NC} $*" >&2; }
step()  { echo -e "\n$*..."; }

check_prerequisites() {
    step "Checking prerequisites"
    local failed=0

    if ! command -v podman &>/dev/null; then
        error "podman not found. Install Podman: https://podman.io/getting-started/installation"
        failed=1
    else
        if ! podman info &>/dev/null; then
            error "podman is installed but not running. On macOS, run: podman machine start"
            failed=1
        else
            info "podman available"
        fi
    fi

    if ! command -v cargo &>/dev/null; then
        error "cargo not found. Install Rust: https://rustup.rs"
        failed=1
    else
        info "cargo available"
    fi

    if ! command -v openssl &>/dev/null; then
        error "openssl not found. Install openssl via your package manager."
        failed=1
    else
        info "openssl available"
    fi

    if ! command -v curl &>/dev/null; then
        error "curl not found. Install curl via your package manager."
        failed=1
    else
        info "curl available"
    fi

    if [ ! -d "$OPENSHELL_DIR" ] || [ ! -f "$OPENSHELL_DIR/Cargo.toml" ]; then
        error "OpenShell source not found at $OPENSHELL_DIR"
        error "Clone it or set OPENSHELL_DIR to the correct path"
        failed=1
    else
        info "OpenShell source at $OPENSHELL_DIR"
    fi

    if [ "$failed" -eq 1 ]; then
        echo ""
        error "Prerequisites check failed. Fix the issues above and try again."
        exit 1
    fi
}

check_port() {
    local port=$1
    local pid
    pid=$(lsof -ti :"$port" 2>/dev/null || true)
    if [ -n "$pid" ]; then
        local proc
        proc=$(ps -p "$pid" -o comm= 2>/dev/null || echo "unknown")
        error "Port $port is already in use by $proc (PID $pid)"
        return 1
    fi
    return 0
}

check_ports() {
    local failed=0
    for port in "$KEYCLOAK_PORT" "$GATEWAY_GRPC_PORT"; do
        if ! check_port "$port"; then
            failed=1
        fi
    done
    if [ "$failed" -eq 1 ]; then
        exit 1
    fi
}

generate_pki() {
    if [ -f "$PKI_DIR/ca.crt" ] && [ -f "$PKI_DIR/server/tls.crt" ] && [ -f "$PKI_DIR/client/tls.crt" ]; then
        info "TLS certificates already exist (${PKI_DIR})"
        return 0
    fi

    step "Generating TLS certificates"
    mkdir -p "$PKI_DIR/server" "$PKI_DIR/client"

    openssl genrsa -out "$PKI_DIR/ca.key" 4096 2>/dev/null
    openssl req -new -x509 -key "$PKI_DIR/ca.key" -out "$PKI_DIR/ca.crt" \
        -days 365 -subj "/CN=OpenShell Dev CA" 2>/dev/null
    info "CA certificate created ($PKI_DIR/ca.crt)"

    openssl genrsa -out "$PKI_DIR/server/tls.key" 4096 2>/dev/null
    openssl req -new -key "$PKI_DIR/server/tls.key" \
        -out "$PKI_DIR/server/tls.csr" \
        -subj "/CN=localhost" 2>/dev/null
    cat > "$PKI_DIR/server/san.cnf" <<EOF
[v3_req]
subjectAltName = DNS:localhost, IP:127.0.0.1
EOF
    openssl x509 -req -in "$PKI_DIR/server/tls.csr" \
        -CA "$PKI_DIR/ca.crt" -CAkey "$PKI_DIR/ca.key" -CAcreateserial \
        -out "$PKI_DIR/server/tls.crt" -days 365 \
        -extfile "$PKI_DIR/server/san.cnf" -extensions v3_req 2>/dev/null
    rm -f "$PKI_DIR/server/tls.csr" "$PKI_DIR/server/san.cnf" "$PKI_DIR/ca.srl"
    info "Server certificate created ($PKI_DIR/server/tls.crt)"

    openssl genrsa -out "$PKI_DIR/client/tls.key" 4096 2>/dev/null
    openssl req -new -key "$PKI_DIR/client/tls.key" \
        -out "$PKI_DIR/client/tls.csr" \
        -subj "/CN=openshell-client" 2>/dev/null
    openssl x509 -req -in "$PKI_DIR/client/tls.csr" \
        -CA "$PKI_DIR/ca.crt" -CAkey "$PKI_DIR/ca.key" -CAcreateserial \
        -out "$PKI_DIR/client/tls.crt" -days 365 2>/dev/null
    rm -f "$PKI_DIR/client/tls.csr" "$PKI_DIR/ca.srl"
    info "Client certificate created ($PKI_DIR/client/tls.crt)"
}

keycloak_is_running() {
    podman container inspect "$KEYCLOAK_CONTAINER" &>/dev/null 2>&1 && \
        [ "$(podman inspect -f '{{.State.Running}}' "$KEYCLOAK_CONTAINER" 2>/dev/null)" = "true" ]
}

start_keycloak() {
    if keycloak_is_running; then
        info "Keycloak already running on port $KEYCLOAK_PORT"
        return 0
    fi

    step "Starting Keycloak"

    podman rm -f "$KEYCLOAK_CONTAINER" &>/dev/null || true

    local realm_file="$OPENSHELL_DIR/scripts/keycloak-realm.json"
    if [ ! -f "$realm_file" ]; then
        error "Keycloak realm file not found at $realm_file"
        exit 1
    fi

    podman run -d \
        --name "$KEYCLOAK_CONTAINER" \
        -p "${KEYCLOAK_PORT}:8080" \
        -e KEYCLOAK_ADMIN=admin \
        -e KEYCLOAK_ADMIN_PASSWORD=admin \
        -v "$realm_file:/opt/keycloak/data/import/realm-export.json:Z" \
        quay.io/keycloak/keycloak:24.0 \
        start-dev --import-realm >/dev/null

    info "Container $KEYCLOAK_CONTAINER started on port $KEYCLOAK_PORT"

    local timeout=60
    local elapsed=0
    while [ "$elapsed" -lt "$timeout" ]; do
        if curl -sf "http://localhost:${KEYCLOAK_PORT}/realms/openshell/.well-known/openid-configuration" >/dev/null 2>&1; then
            info "Keycloak healthy"
            return 0
        fi
        sleep 2
        elapsed=$((elapsed + 2))
    done

    error "Keycloak health check timed out after ${timeout}s"
    echo "  Last container logs:"
    podman logs --tail 20 "$KEYCLOAK_CONTAINER" 2>&1 | sed 's/^/    /'
    podman stop "$KEYCLOAK_CONTAINER" >/dev/null 2>&1 || true
    podman rm "$KEYCLOAK_CONTAINER" >/dev/null 2>&1 || true
    exit 1
}

register_dashboard_client() {
    step "Registering dashboard OIDC client"

    local token_url="http://localhost:${KEYCLOAK_PORT}/realms/master/protocol/openid-connect/token"
    local admin_token
    admin_token=$(curl -sf -X POST "$token_url" \
        -d "grant_type=client_credentials&client_id=admin-cli&client_secret=admin" \
        2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))" 2>/dev/null || true)

    if [ -z "$admin_token" ]; then
        admin_token=$(curl -sf -X POST "$token_url" \
            -d "grant_type=password&client_id=admin-cli&username=admin&password=admin" \
            2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))" 2>/dev/null || true)
    fi

    if [ -z "$admin_token" ]; then
        error "Failed to obtain Keycloak admin token"
        exit 1
    fi

    local clients_url="http://localhost:${KEYCLOAK_PORT}/admin/realms/openshell/clients"
    local existing
    existing=$(curl -sf -H "Authorization: Bearer $admin_token" \
        "${clients_url}?clientId=openshell-dashboard" 2>/dev/null || echo "[]")

    local count
    count=$(echo "$existing" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")

    if [ "$count" -gt 0 ]; then
        info "Dashboard OIDC client already registered"
        return 0
    fi

    local client_payload
    client_payload=$(cat <<'CLIENTJSON'
{
  "clientId": "openshell-dashboard",
  "name": "OpenShell Dashboard",
  "enabled": true,
  "publicClient": true,
  "directAccessGrantsEnabled": true,
  "standardFlowEnabled": true,
  "redirectUris": ["http://localhost:3000/*"],
  "webOrigins": ["http://localhost:3000"],
  "defaultClientScopes": ["openid", "profile", "email"],
  "attributes": {
    "post.logout.redirect.uris": "http://localhost:3000",
    "pkce.code.challenge.method": "S256"
  }
}
CLIENTJSON
    )

    local http_code
    http_code=$(curl -sf -o /dev/null -w "%{http_code}" -X POST "$clients_url" \
        -H "Authorization: Bearer $admin_token" \
        -H "Content-Type: application/json" \
        -d "$client_payload" 2>/dev/null || echo "000")

    if [ "$http_code" = "201" ] || [ "$http_code" = "204" ] || [ "$http_code" = "409" ]; then
        info "Dashboard OIDC client registered"
    else
        error "Failed to register dashboard client (HTTP $http_code)"
        exit 1
    fi

    local client_uuid
    client_uuid=$(curl -sf -H "Authorization: Bearer $admin_token" \
        "${clients_url}?clientId=openshell-dashboard" 2>/dev/null | jq -r '.[0].id // empty')

    if [ -n "$client_uuid" ]; then
        local mappers_url="${clients_url}/${client_uuid}/protocol-mappers/models"
        local existing_mapper
        existing_mapper=$(curl -sf -H "Authorization: Bearer $admin_token" \
            "${clients_url}/${client_uuid}/protocol-mappers/models" 2>/dev/null | jq -r '[.[] | select(.name == "audience-dashboard")] | length')

        if [ "${existing_mapper:-0}" = "0" ]; then
            curl -sf -X POST "$mappers_url" \
                -H "Authorization: Bearer $admin_token" \
                -H "Content-Type: application/json" \
                -d '{
                    "name": "audience-dashboard",
                    "protocol": "openid-connect",
                    "protocolMapper": "oidc-audience-mapper",
                    "config": {
                        "included.client.audience": "openshell-dashboard",
                        "id.token.claim": "true",
                        "access.token.claim": "true",
                        "included.custom.audience": "",
                        "userinfo.token.claim": "false"
                    }
                }' -o /dev/null 2>/dev/null
            curl -sf -X POST "$mappers_url" \
                -H "Authorization: Bearer $admin_token" \
                -H "Content-Type: application/json" \
                -d '{
                    "name": "audience-cli",
                    "protocol": "openid-connect",
                    "protocolMapper": "oidc-audience-mapper",
                    "config": {
                        "included.client.audience": "openshell-cli",
                        "id.token.claim": "false",
                        "access.token.claim": "true",
                        "included.custom.audience": "",
                        "userinfo.token.claim": "false"
                    }
                }' -o /dev/null 2>/dev/null
            curl -sf -X POST "$mappers_url" \
                -H "Authorization: Bearer $admin_token" \
                -H "Content-Type: application/json" \
                -d '{
                    "name": "realm-roles",
                    "protocol": "openid-connect",
                    "protocolMapper": "oidc-usermodel-realm-role-mapper",
                    "config": {
                        "multivalued": "true",
                        "claim.name": "realm_access.roles",
                        "jsonType.label": "String",
                        "id.token.claim": "true",
                        "access.token.claim": "true",
                        "userinfo.token.claim": "false"
                    }
                }' -o /dev/null 2>/dev/null
            info "Protocol mappers added (audience + roles)"
        fi
    fi
}

detect_podman_socket() {
    local socket_path

    socket_path=$(podman info --format '{{.Host.RemoteSocket.Path}}' 2>/dev/null || true)
    if [ -n "$socket_path" ] && [ -S "$socket_path" ]; then
        echo "$socket_path"
        return 0
    fi

    if [ "$(uname)" = "Darwin" ]; then
        for candidate in \
            "$HOME/.local/share/containers/podman/machine/podman.sock" \
            "$HOME/.local/share/containers/podman/machine/qemu/podman.sock" \
            "/var/run/podman/podman.sock"; do
            if [ -S "$candidate" ]; then
                echo "$candidate"
                return 0
            fi
        done

        local machine_socket
        machine_socket=$(podman machine inspect --format '{{.ConnectionInfo.PodmanSocket.Path}}' 2>/dev/null || true)
        if [ -n "$machine_socket" ] && [ -S "$machine_socket" ]; then
            echo "$machine_socket"
            return 0
        fi
    else
        for candidate in \
            "/run/podman/podman.sock" \
            "/run/user/$(id -u)/podman/podman.sock" \
            "/var/run/podman/podman.sock"; do
            if [ -S "$candidate" ]; then
                echo "$candidate"
                return 0
            fi
        done
    fi

    error "Podman socket not found. On macOS, run: podman machine start"
    exit 1
}

build_gateway() {
    step "Building gateway"
    if ! (cd "$OPENSHELL_DIR" && cargo build -p openshell-server --bin openshell-gateway 2>&1); then
        error "Gateway build failed (see compiler output above)"
        exit 1
    fi
    info "openshell-gateway built"
}

ensure_podman_network() {
    if podman network inspect "$PODMAN_NETWORK" >/dev/null 2>&1; then
        return 0
    fi
    podman network create --driver bridge "$PODMAN_NETWORK" >/dev/null 2>&1
    info "Podman network '$PODMAN_NETWORK' created"
}

generate_gateway_config() {
    mkdir -p "$STATE_DIR"
    local podman_socket
    podman_socket=$(detect_podman_socket)

    ensure_podman_network

    cat > "$GATEWAY_CONFIG_FILE" <<EOF
[openshell]
version = 1

[openshell.gateway]
bind_address = "0.0.0.0:${GATEWAY_GRPC_PORT}"
compute_drivers = ["podman"]

[openshell.drivers.podman]
socket_path = "$podman_socket"
network_name = "$PODMAN_NETWORK"
gateway_port = ${GATEWAY_GRPC_PORT}
guest_tls_ca = "$PKI_DIR/ca.crt"
guest_tls_cert = "$PKI_DIR/client/tls.crt"
guest_tls_key = "$PKI_DIR/client/tls.key"
EOF
    info "Gateway config generated ($GATEWAY_CONFIG_FILE)"
}

gateway_is_running() {
    if [ -f "$GATEWAY_PID_FILE" ]; then
        local pid
        pid=$(cat "$GATEWAY_PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            return 0
        fi
        rm -f "$GATEWAY_PID_FILE"
    fi
    return 1
}

start_gateway() {
    if gateway_is_running; then
        local pid
        pid=$(cat "$GATEWAY_PID_FILE")
        info "Gateway already running (PID $pid) on port $GATEWAY_GRPC_PORT"
        return 0
    fi

    step "Starting gateway"
    mkdir -p "$STATE_DIR"

    local gateway_bin="$OPENSHELL_DIR/target/debug/openshell-gateway"
    if [ ! -x "$gateway_bin" ]; then
        error "Gateway binary not found at $gateway_bin. Run build first."
        exit 1
    fi

    generate_gateway_config

    "$gateway_bin" \
        --config "$GATEWAY_CONFIG_FILE" \
        --port "$GATEWAY_GRPC_PORT" \
        --health-port "$GATEWAY_HTTP_PORT" \
        --tls-cert "$PKI_DIR/server/tls.crt" \
        --tls-key "$PKI_DIR/server/tls.key" \
        --oidc-issuer "http://localhost:${KEYCLOAK_PORT}/realms/openshell" \
        --oidc-audience "openshell-cli" \
        --db-url "sqlite:${GATEWAY_DB_FILE}?mode=rwc" \
        --log-level info \
        > "$GATEWAY_LOG_FILE" 2>&1 &
    local pid=$!
    echo "$pid" > "$GATEWAY_PID_FILE"

    info "Gateway started (PID $pid) on port $GATEWAY_GRPC_PORT"

    local timeout=120
    local elapsed=0
    while [ "$elapsed" -lt "$timeout" ]; do
        if curl -sf "http://127.0.0.1:${GATEWAY_HTTP_PORT}/healthz" >/dev/null 2>&1; then
            info "Gateway healthy"
            return 0
        fi
        if ! kill -0 "$pid" 2>/dev/null; then
            error "Gateway process exited unexpectedly"
            echo "  Last log lines:"
            tail -20 "$GATEWAY_LOG_FILE" 2>/dev/null | sed 's/^/    /'
            rm -f "$GATEWAY_PID_FILE"
            exit 1
        fi
        sleep 2
        elapsed=$((elapsed + 2))
    done

    error "Gateway health check timed out after ${timeout}s"
    echo "  Last log lines:"
    tail -20 "$GATEWAY_LOG_FILE" 2>/dev/null | sed 's/^/    /'
    kill "$pid" 2>/dev/null || true
    rm -f "$GATEWAY_PID_FILE"
    exit 1
}

create_default_workspace() {
    step "Creating default workspace"

    local token_url="http://localhost:${KEYCLOAK_PORT}/realms/openshell/protocol/openid-connect/token"
    local admin_token
    admin_token=$(curl -sf -X POST "$token_url" \
        -d "grant_type=password&client_id=openshell-cli&username=admin@test&password=admin" \
        2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))" 2>/dev/null || true)

    if [ -z "$admin_token" ]; then
        warn "Could not obtain admin token for workspace creation. Workspace RBAC support may be missing."
        warn "Ensure the OpenShell repo includes workspace RBAC (PR #2445)."
        return 0
    fi

    if command -v grpcurl &>/dev/null; then
        local result
        local proto_import="$OPENSHELL_DIR/proto"
        result=$(grpcurl -H "Authorization: Bearer $admin_token" \
            -cacert "$PKI_DIR/ca.crt" \
            -import-path "$proto_import" -proto openshell.proto \
            -d '{"name": "default"}' \
            "localhost:${GATEWAY_GRPC_PORT}" \
            openshell.v1.OpenShell/CreateWorkspace 2>&1 || true)
        if echo "$result" | grep -qiE '"name"|already.exists|AlreadyExists'; then
            info "Default workspace created"
        else
            warn "Workspace creation response: $result"
            warn "Gateway may not support CreateWorkspace yet"
        fi
    else
        local gateway_http_url="http://127.0.0.1:${GATEWAY_HTTP_PORT}"
        local http_code
        http_code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${gateway_http_url}/api/v1/workspaces" \
            -H "Authorization: Bearer $admin_token" \
            -H "Content-Type: application/json" \
            -d '{"name": "default"}' 2>/dev/null || echo "000")
        if [ "$http_code" = "200" ] || [ "$http_code" = "201" ] || [ "$http_code" = "409" ]; then
            info "Default workspace created"
        else
            warn "Could not create default workspace via HTTP API (HTTP $http_code). Create it manually after login."
        fi
    fi
}

write_env_file() {
    cat > "$ENV_FILE" <<EOF
# Generated by dev-env.sh — do not edit manually
OPENSHELL_DIR=${OPENSHELL_DIR}
OPENSHELL_GATEWAY_URL=localhost:${GATEWAY_GRPC_PORT}
OIDC_ISSUER=http://localhost:${KEYCLOAK_PORT}/realms/openshell
OIDC_CLIENT_ID=openshell-dashboard
GATEWAY_CA_CERT=${PKI_DIR}/ca.crt
AUTH_DISABLED=false
EOF
}

print_env_vars() {
    write_env_file
    echo ""
    echo "Ready! Run the dashboard with:"
    echo ""
    echo "  make setup   # first time only"
    echo "  make dev     # auto-reads scripts/.env.dev"
    echo ""
    echo "Or for the full stack in one command:"
    echo ""
    echo "  make dev-full"
    echo ""
    echo "Then open http://localhost:3000 and log in with admin@test / admin"
    echo ""
}

cmd_start() {
    resolve_openshell_dir
    check_prerequisites

    local port_failed=0
    if ! keycloak_is_running; then
        if ! check_port "$KEYCLOAK_PORT"; then port_failed=1; fi
    fi
    if ! gateway_is_running; then
        if ! check_port "$GATEWAY_GRPC_PORT"; then port_failed=1; fi
    fi
    if [ "$port_failed" -eq 1 ]; then
        exit 1
    fi

    generate_pki
    start_keycloak
    register_dashboard_client
    if ! gateway_is_running; then
        build_gateway
    fi
    start_gateway
    create_default_workspace
    print_env_vars
}

cmd_stop() {
    step "Stopping dev environment"

    # Gateway: try PID file first, then scan for orphaned processes
    if [ -f "$GATEWAY_PID_FILE" ]; then
        local pid
        pid=$(cat "$GATEWAY_PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            kill "$pid" 2>/dev/null || true
            local waited=0
            while kill -0 "$pid" 2>/dev/null && [ "$waited" -lt 10 ]; do
                sleep 1
                waited=$((waited + 1))
            done
            if kill -0 "$pid" 2>/dev/null; then
                kill -9 "$pid" 2>/dev/null || true
                warn "Gateway killed forcefully (PID $pid)"
            else
                info "Gateway stopped (PID $pid)"
            fi
        else
            info "Gateway PID $pid already gone (stale PID file)"
        fi
        rm -f "$GATEWAY_PID_FILE"
    fi

    # Check for orphaned gateway processes on the expected port
    local orphan_pid
    orphan_pid=$(lsof -ti :"$GATEWAY_GRPC_PORT" 2>/dev/null || true)
    if [ -n "$orphan_pid" ]; then
        kill "$orphan_pid" 2>/dev/null || true
        warn "Killed orphaned process on port $GATEWAY_GRPC_PORT (PID $orphan_pid)"
    fi

    # Keycloak: force remove regardless of state (handles stopped, running, or broken containers)
    if podman container exists "$KEYCLOAK_CONTAINER" 2>/dev/null; then
        podman stop "$KEYCLOAK_CONTAINER" 2>/dev/null || true
        podman rm -f "$KEYCLOAK_CONTAINER" 2>/dev/null || true
        info "Keycloak stopped and removed"
    else
        info "Keycloak not running"
    fi

    # Clean up stale state files (preserve PKI, DB, and env config)
    rm -f "$GATEWAY_PID_FILE" "$GATEWAY_LOG_FILE" "$GATEWAY_CONFIG_FILE"
    info "State files cleaned"

    echo ""
}

cmd_status() {
    echo ""
    echo "Dev Environment Status"
    echo "======================"

    if keycloak_is_running; then
        info "Keycloak: running on port $KEYCLOAK_PORT"
    else
        error "Keycloak: stopped"
    fi

    if gateway_is_running; then
        local pid
        pid=$(cat "$GATEWAY_PID_FILE")
        info "Gateway:  running (PID $pid) on port $GATEWAY_GRPC_PORT"
    else
        error "Gateway:  stopped"
    fi

    if keycloak_is_running && gateway_is_running; then
        print_env_vars
    else
        echo ""
        warn "Stack is not fully running. Use './scripts/dev-env.sh start' to start."
        echo ""
    fi
}

cmd_rebuild_gateway() {
    resolve_openshell_dir
    step "Rebuilding gateway"

    if gateway_is_running; then
        local pid
        pid=$(cat "$GATEWAY_PID_FILE")
        kill "$pid" 2>/dev/null || true
        rm -f "$GATEWAY_PID_FILE"
        info "Gateway stopped (PID $pid)"
    fi

    build_gateway
    start_gateway

    echo ""
    info "Gateway rebuilt and restarted"
    echo ""
}

usage() {
    echo "Usage: $0 {start|stop|status|rebuild-gateway}"
    echo ""
    echo "Commands:"
    echo "  start             Start Keycloak, build and start the gateway"
    echo "  stop              Stop all components"
    echo "  status            Show component status"
    echo "  rebuild-gateway   Rebuild and restart the gateway"
    echo ""
    echo "Environment variables:"
    echo "  OPENSHELL_DIR     Path to OpenShell source (default: ~/Work/projects/openshell)"
    echo "  KEYCLOAK_PORT     Keycloak port (default: 8180)"
}

case "${1:-}" in
    start)            cmd_start ;;
    stop)             cmd_stop ;;
    status)           cmd_status ;;
    rebuild-gateway)  cmd_rebuild_gateway ;;
    -h|--help|help)   usage ;;
    *)
        usage
        exit 1
        ;;
esac
