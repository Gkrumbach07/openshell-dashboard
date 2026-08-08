# Architecture Decision Records

One decision per document. Statuses: **Accepted** (in force), **Open**
(documented, undecided), **Proposed** (decided pending conditions).

| ADR | Decision | Status |
|-----|----------|--------|
| [0001](0001-standalone-upstream-repo.md) | Standalone upstream repo, community-first (ai-openshell org target) | Accepted |
| [0002](0002-npm-package-consumption-model.md) | npm package for downstream consumption, not subtree sync | Accepted |
| [0003](0003-auth-relay-only-bff.md) | Auth: relay-only BFF behind a fronting proxy (oauth2-proxy / kube-auth-proxy) | Accepted |
| [0004](0004-bff-scope-boundary.md) | BFF scope: three jobs and a never-list | Accepted |
| [0005](0005-extension-surface.md) | Extension surface: five mechanisms, zero co-located CSS | Accepted |
| [0006](0006-proto-source-of-truth.md) | Proto files are the source of truth — no invented APIs | Accepted |
| [0007](0007-sandbox-centric-object-model.md) | Sandbox-centric object model — no Agent abstraction | Accepted |
| [0008](0008-polling-and-the-terminal.md) | Polling for data; WebSocket for the terminal only | Accepted |
| [0009](0009-federated-credential-bridge-gap.md) | Federated credential bridge (opaque tokens vs gateway JWTs) | **Open** |
| [0010](0010-gateway-client-sdk-vs-stubs.md) | Gateway client: openshell-sdk-go over generated stubs | **Proposed** |

Numbering was reset on 2026-08-07 while the project was pre-1.0 and this set
was unmerged; earlier drafts (three-mode auth, proxy-delegated pipe, cookie
sessions, self-contained pages as a separate ADR) were consolidated into
0003/0005, whose History/Context sections preserve the reasoning. From here
forward, ADRs are append-only: supersede, don't rewrite.
