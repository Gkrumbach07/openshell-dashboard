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
ENTRYPOINT ["/usr/local/bin/openshell-dashboard"]
