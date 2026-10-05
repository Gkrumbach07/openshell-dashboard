# Contributing to OpenShell Dashboard

Thank you for your interest in contributing. This project is part of the [OpenShell](https://github.com/NVIDIA/OpenShell) ecosystem and follows similar contribution practices.

## Getting started

```bash
git clone https://github.com/Gkrumbach07/openshell-dashboard.git
cd openshell-dashboard
make setup
make dev        # starts frontend (:3000) + BFF (:8080)
```

You need a running OpenShell gateway. Either `openshell gateway start` (Podman) or set `OPENSHELL_GATEWAY_URL` to an existing one. For the full OIDC dev stack with Keycloak, use `make dev-full` (see README).

## Before you contribute

- **Read the ADRs.** Architecture decisions are documented in `docs/adrs/`. These are load-bearing — if your change conflicts with an ADR, open a discussion before coding.
- **Read `CLAUDE.md`.** It has the project rules, structure, and conventions.
- **Check existing issues.** If your change is non-trivial, open an issue first to discuss the approach.

## Contribution workflow

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Run the full check suite locally:
   ```bash
   make lint        # eslint + golangci-lint + prettier
   make typecheck   # tsc --noEmit
   make test        # jest + go test
   ```
4. Open a pull request against `main`

### Commit conventions

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add provider profile detail page
fix: handle empty workspace list in sidebar
docs: add ADR for polling strategy
refactor: extract common table columns
test: add sandbox create form tests
```

Feature and behavior PRs should link an accepted issue.

#### The commit type decides whether a merge cuts a release

After CI passes on `main`, `semantic-release` looks at the commits since the last release and, if they call for one, publishes the npm package, a GitHub release and the container image tags `X.Y.Z` and `X.Y`, all with one version. Nobody runs it by hand, so the commit message is the only input. With a squash merge the pull request title becomes that commit, so the title is what has to follow the convention.

| Commit | Release it cuts |
|--------|-----------------|
| `fix: …`, `perf: …` | patch |
| `feat: …` | minor |
| a `!` after the type or scope (`feat!: …`, `fix(bff)!: …`), or a `BREAKING CHANGE:` footer | major |
| `docs:`, `test:`, `chore:`, `build:`, `refactor:`, `style:` | none |
| anything whose type or scope is `ci` (`ci: …`, `fix(ci): …`, `feat(ci): …`), even when marked breaking | none |
| a title that is not a Conventional Commit, such as `Add foo (#74)` | none |

**Workflow changes use the `ci:` type.** A change to `.github/workflows/`, or to the scripts CI and the release pipeline run, alters nothing in the package or the image, so it must not publish a new version of them. `fix(ci):` and `feat(ci):` used to do exactly that: releases 1.0.1, 1.0.2, 1.0.3 and 1.1.0 were each cut by a commit that changed nothing we ship. The `ci` scope is now ignored as a safety net, but write `ci: …` so the history says what the change was.

Use `fix:` or `feat:` only for something a user of the dashboard or a consumer of the npm package would notice. The rules live in [`release.config.cjs`](release.config.cjs); CI runs sample commits through them on every pull request (`scripts/release/check-release-config.mjs`), and [docs/releasing.md](docs/releasing.md) describes the rest of the pipeline.

#### If you move the supported gateway range

The range of OpenShell gateways a release supports is derived from the required lanes in `deploy/ci/gateway-pins.json`, never written by hand. After changing that file, regenerate the one place that restates it and commit the result (CI fails if you forget):

```bash
node scripts/readme-gateway-range.mjs --write
```

The SDK pin in `backend/go.mod`, the gateway pins and the range move together in one pull request (ADR 0005).

### Developer Certificate of Origin (DCO)

All commits must include a `Signed-off-by` line certifying you have the right to submit the code under the project's license. Use `git commit -s` to add it automatically:

```
Signed-off-by: Your Name <your.email@example.com>
```

This is a legal requirement for Apache 2.0 licensed projects. CI will reject unsigned commits.

## Code standards

### Frontend (React + TypeScript)

- Functional components only; `type` for props (not `interface`)
- PatternFly 6 exclusively — no MUI, no custom design system, no inline styles with hardcoded values
- Data fetching via React Query (`@tanstack/react-query`)
- `data-testid` on interactive elements
- Pages must be self-contained and exportable (see ADR 0001)

### Backend (Go BFF)

- `go-chi/chi` for routing
- Table-driven tests
- Handler signature: `func (app *App) HandlerName(w http.ResponseWriter, r *http.Request)`
- Prefer the vendored OpenShell Go SDK; keep any adapter code thin and justified by a concrete SDK gap

### API rules

**The vendored OpenShell Go SDK is the source of truth** (see `.claude/rules/openshell-api.md`). Do not invent RPCs, fields, or lifecycle states. If a UI concept has no backing RPC, open an issue — do not fabricate an endpoint.

Common mistakes to avoid:
- Sandbox stop/start exists (v0.0.113+); still no suspend/restart (lifecycle is create → ready/error → stop ⇄ start → delete)
- No workspace-level policy CRUD (policy is per-sandbox or gateway-global)
- No events API (use GetSandboxLogs + polling)
- Provider credentials are write-only — never return secrets to the frontend

## AI-assisted contributions

AI-assisted code is welcome — this project was built agent-first. However:

- **You must understand every line you submit.** If you cannot explain a change during review, the PR will be closed.
- **AI-generated commit messages are fine** but must accurately describe the change.
- **Do not submit AI-generated code that fabricates API endpoints.** This is the most common AI failure mode in this project. The vendored Go SDK is the source of truth.

## Security

See [SECURITY.md](SECURITY.md) for reporting vulnerabilities. Do not open public issues for security bugs.

## License

By contributing, you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE).
