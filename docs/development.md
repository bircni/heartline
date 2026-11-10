# Development

Requires Node 26 and pnpm 12.

```sh
pnpm install
pnpm dev          # API on :3000 (dev/status.yaml) + UI on :5173
pnpm test         # unit, integration, PGlite and (with Docker) Postgres tests
pnpm e2e          # Playwright against the built UI
pnpm check        # lint, format, typecheck, test and build across all projects
pnpm affected     # the same plus e2e, only for projects changed since main
```

Tasks run through [Nx](https://nx.dev) with local and Nx Cloud remote caching; CI runs only affected projects.

The dev admin is `admin@status.local` / `change-me-please`.

Layout: `apps/server` (Hono, better-auth, Kysely, MCP; `src/software` holds the version probes, the
product catalog, the OSV/NVD/endoflife/KEV clients and the urgency scoring), `apps/web` (React 19,
TanStack Router/Query, Tailwind 4, visx), `packages/shared` (types and zod schemas), `plugins/`,
`deploy/` (Kustomize, the container's default config).
The server runs its TypeScript directly on Node 26 (type stripping) without a build step.

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/); the changelog is
generated from them. `git config core.hooksPath .githooks` turns on a hook that checks each message.

## Releasing

Releases are cut locally from `main` and published by CI. You need [git-cliff](https://git-cliff.org/)
and the GitHub CLI.

```sh
pnpm release                  # patch: 0.1.0 → 0.1.1
pnpm release minor            # 0.1.0 → 0.2.0
pnpm release 1.0.0-beta.1     # an exact version; a "-" makes it a prerelease
pnpm release minor --dry-run  # shows every step and what would stop it, changes nothing
```

It stops unless you are on a clean `main` in sync with `origin`, the tag is free and CI passed on that
commit. Then it sets the version in every `package.json`, writes `CHANGELOG.md`, commits
`chore(release): vX.Y.Z`, tags `vX.Y.Z` and pushes `main` and the tag together.

The tag runs CI: a job checks that it matches the version in `package.json`, the multi-arch image is
pushed to `ghcr.io/bircni/heartline` as `X.Y.Z`, `X.Y` and `latest`, and a GitHub release is created
with that version's changelog section. Prereleases never become `latest`. A failed run can simply be
re-run; the release job updates the release it already created.
