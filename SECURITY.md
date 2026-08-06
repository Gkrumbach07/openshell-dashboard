# Security Policy

## Reporting a vulnerability

If you discover a security vulnerability in the OpenShell Dashboard, please report it responsibly. **Do not open a public GitHub issue.**

Email **gkrumbac@redhat.com** with:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if you have one)

You should receive an acknowledgment within 48 hours. We will work with you to understand and address the issue before any public disclosure.

## Scope

This policy covers the OpenShell Dashboard codebase:

- **Go BFF** (`backend/`) — REST handlers, auth middleware, gRPC client
- **React frontend** (`frontend/`) — UI components, API hooks, OIDC flow
- **Container image** — Dockerfile, build pipeline
- **CI/CD** — GitHub Actions workflows

For vulnerabilities in the OpenShell gateway itself, report to the [NVIDIA OpenShell project](https://github.com/NVIDIA/OpenShell) via NVIDIA PSIRT.

## Security design

The dashboard follows these security principles (see `CLAUDE.md` and `.claude/rules/security.md`):

- **OIDC tokens in HTTP-only secure cookies**, never in localStorage
- **Provider credentials are write-only** — never returned to the frontend
- **Secret fields** (annotated `[(openshell.options.v1.secret) = true]` in proto) are stripped by the BFF before browser serialization
- **No inline credentials** — gateway URL, OIDC config from env vars only
- **CORS configured explicitly** — no wildcard origins in production
- **Input validation at the BFF layer** — DNS-1123 names, policy YAML structure
