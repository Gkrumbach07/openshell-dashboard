# Multi-stage build: frontend static assets + Go BFF in one image.
# The BFF serves the frontend from STATIC_DIR — one container, one process.

# --- Frontend build ---
FROM node:22-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# --- Backend build ---
FROM golang:1.25-alpine AS backend
WORKDIR /app/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 go build -o /out/server ./cmd/server

# --- Runtime ---
FROM alpine:3.20
RUN adduser -D -u 1001 dashboard
USER 1001
COPY --from=backend /out/server /usr/local/bin/openshell-dashboard
COPY --from=frontend /app/frontend/dist /srv/static
ENV PORT=8080 \
    STATIC_DIR=/srv/static
EXPOSE 8080

# Which OpenShell gateways this build supports (#66, ADR 0005).
#
# CI passes these from `node scripts/gateway-range.mjs`, which derives them from
# the required compat lanes in deploy/ci/gateway-pins.json — the same source as
# the release notes and the npm package, so the three cannot disagree. They are
# build args, not literals, so that nothing here needs editing when the range
# moves. A plain `docker build` without them still works and leaves all of them
# empty, which means "this build does not say", not "any gateway". Because empty
# is allowed, ci.yml's image-range job reads the pushed image back and fails if
# CI's own build came out empty.
#
# The two env vars are for the BFF, which can compare them with the version the
# gateway reports. The labels say the same thing to someone holding only an
# image reference:
#   skopeo inspect docker://<image> | jq .Labels
#
# Kept at the end of the stage so that moving the range rebuilds nothing above.
ARG GATEWAY_SUPPORTED_MIN=""
ARG GATEWAY_SUPPORTED_MAX=""
ARG OPENSHELL_SDK_VERSION=""
ENV GATEWAY_SUPPORTED_MIN=${GATEWAY_SUPPORTED_MIN} \
    GATEWAY_SUPPORTED_MAX=${GATEWAY_SUPPORTED_MAX}
LABEL io.github.gkrumbach07.openshell-dashboard.gateway.min="${GATEWAY_SUPPORTED_MIN}" \
      io.github.gkrumbach07.openshell-dashboard.gateway.max="${GATEWAY_SUPPORTED_MAX}" \
      io.github.gkrumbach07.openshell-dashboard.sdk="${OPENSHELL_SDK_VERSION}"

ENTRYPOINT ["/usr/local/bin/openshell-dashboard"]
