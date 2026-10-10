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

### Where a pull request goes

**`main`, by default.** `main` is built on one released OpenShell gateway, and CI tests every pull request against it. If your change builds and passes there, it goes there.

**`next`, only if it cannot build or pass on `main`.** `next` is `main` moved to the upcoming gateway release: the Go SDK and the gateway CI runs are upstream's newest pre-release. Work that needs something only that release has (a new SDK method, an RPC the released gateway does not serve) cannot land on `main` yet, so it targets `next`, and reaches `main` when `next` merges on the day upstream releases. Branch from `next` for it. A workflow keeps `next` rebased onto `main` and force-pushes it, so rebase your branch after it has moved (`git fetch origin && git rebase --fork-point origin/next`). If there is no `next`, upstream has nothing ahead of `main`.

**`release/X.Y`**, for a critical or security fix to the release line before `main`'s. Nothing else is backported ([ADR 0009](docs/adrs/0009-console-release-policy.md)).

Do not move the pinned gateway or the SDK in a pull request of your own; see [The pinned OpenShell release](#the-pinned-openshell-release).

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

#### Merging does not release; the title still matters

Merging a pull request publishes nothing. A release is cut by a person, who starts the `Release` workflow on `main` and chooses patch, minor or major ([docs/releasing.md](docs/releasing.md)). The one exception is the pull request from `next`, the move to a new OpenShell release, which is released as a patch once it is merged.

The commit message still does two jobs, so write it as carefully as before. With a squash merge the pull request **title** is the commit message. It is what the release notes are written from, and it is what the person cutting the release is told the commits suggest:

| Commit | Release it suggests |
|--------|-----------------|
| `fix: …`, `perf: …` | patch |
| `feat: …` | minor |
| a `!` after the type or scope (`feat!: …`, `fix(bff)!: …`), or a `BREAKING CHANGE:` footer | major |
| `docs:`, `test:`, `chore:`, `build:`, `refactor:`, `style:` | none |
| anything whose type or scope is `ci` (`ci: …`, `fix(ci): …`, `feat(ci): …`), even when marked breaking | none |
| a `git revert` under the title git gives it, `Revert "…"`, **whatever it reverts** | patch |
| any other title that is not a Conventional Commit, such as `Add foo (#74)` | none |

**Workflow changes use the `ci:` type.** A change to `.github/workflows/`, or to the scripts CI and the release pipeline run, alters nothing in the image, so it does not belong in the release notes and must not make the commits look like they call for a release. When releases were automatic, `fix(ci):` and `feat(ci):` did worse than that: releases 1.0.1, 1.0.2, 1.0.3 and 1.1.0 were each published by a commit that changed nothing we ship. A `ci` scope is treated the same as the `ci` type, but write `ci:` so the title says what the change is.

A commit whose type or scope is `ci` is left out of the release notes and suggests no release, even when it is marked breaking.

**Reverting a CI change: title it `ci: revert …`.** The title `git revert` writes, `Revert "ci: pin the runners"`, has no type and no scope, so nothing can tell that the commit it undoes was about CI. Left as it is, the revert is listed in the next release's notes and counts as suggesting a patch. Retitle the commit, or the pull request if it is squash-merged:

```
ci: revert "pin the runners"
```

Use `fix:` or `feat:` only for something a user of the dashboard would notice. The rules live in [`release.config.cjs`](release.config.cjs); CI runs sample commits through them on every pull request (`scripts/release/check-release-config.mjs`), and [docs/releasing.md](docs/releasing.md) describes the rest of the pipeline.

#### The pinned OpenShell release

`deploy/ci/gateway-pins.json` names the one OpenShell release a branch is built on: the gateway and supervisor images CI runs, and the Go SDK in `backend/go.mod`. The three come from one upstream release tag and move together, in one commit ([ADR 0009](docs/adrs/0009-console-release-policy.md)).

You do not move it. The [Follow upstream](.github/workflows/follow-upstream.yml) workflow finds new releases from upstream's tags and makes the move on `next`, as the first commit after `main`; merging `next` is how `main` gets it ([`deploy/ci/upstream/README.md`](deploy/ci/upstream/README.md)). A pull request into `main` or `release/**` that pins a pre-release fails the `pins a stable release` check.

If you do have to change the pins by hand, these have to stay in step, and CI fails when they are not:

- The `sdk` field must equal the OpenShell SDK version in `backend/go.mod`, and the image tags must be the release (`python3 deploy/ci/upstream/follow.py validate-pins --go-mod backend/go.mod`).
- The gateway release line compiled into the BFF (`BuiltInGatewayReleaseLine` in `backend/pkg/models/gateway_release_line.go`) must be the major and minor number of the pinned release. A newer patch release changes nothing here. A new minor is a new release line, and the constant changes in the same commit (`node scripts/gateway-range.mjs --check`).
- The README restates the release and the SDK in one generated table: `node scripts/readme-gateway-range.mjs --write`.

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
