# heartline

A self-hosted status page for the services you run yourself: GitHub/Claude-style availability bars,
uptime reports for any number of days, incidents and maintenance, Teams and e-mail alerts, Gitea
sign-in, API tokens and a built-in MCP server.

- **Pull-based checks**: HTTP, TCP, DNS, TLS certificate, ICMP, plus **exec plugins** for anything else
  (backup age, queue length, a scripted login). Your services are never modified.
- **Status page**: overview with 7/30/90-day bars, per-service response-time charts (average + p95),
  recent checks, incident timelines, RSS, CSV export and uptime badges.
- **Admin area**: monitors (from `status.yaml` or created in the UI), incidents with public updates,
  recurring maintenance windows (RRULE), notification channels with test sends, API tokens, users.
- **Auth**: local accounts seeded from config, OAuth/OIDC (Gitea or any OIDC provider) with role mapping
  from groups, scoped API tokens (`read`, `write`, `admin`).
- **MCP**: `/mcp` speaks the 2026-07-28 spec (and 2025 clients). MCP clients sign in through the built-in
  OAuth 2.1 server (dynamic client registration, CIMD, PKCE), so they log in with Gitea or a local
  account. API tokens work for headless clients.
- **Storage**: SQLite (Node's built-in `node:sqlite`) or Postgres. With Postgres, run several replicas;
  one elected leader runs the checks.
- **Runs on** Node 26, ships as a container, a Helm chart and Kustomize manifests.

## Quick start (container)

```sh
docker run -d --name status -p 3000:3000 \
  -e BASE_URL=http://localhost:3000 \
  -e AUTH_SECRET="$(openssl rand -hex 24)" \
  -e ADMIN_PASSWORD=choose-a-long-password \
  -v "$PWD/status.yaml:/config/status.yaml:ro" \
  -v status-data:/data \
  ghcr.io/bircni/heartline:latest
```

Start from [`status.example.yaml`](status.example.yaml). Open http://localhost:3000, then sign in at
`/login` with the user from `auth.users`.

## Kubernetes

**Helm** (chart published to GHCR on releases):

```sh
helm install status oci://ghcr.io/bircni/charts/heartline \
  --set baseUrl=https://status.example.com \
  --set secret.values.ADMIN_PASSWORD=choose-a-long-password \
  --set-file config=status.yaml \
  --set ingress.enabled=true --set ingress.hosts[0].host=status.example.com --set ingress.hosts[0].paths[0].path=/ --set ingress.hosts[0].paths[0].pathType=Prefix
```

Key values (see [`values.yaml`](deploy/helm/heartline/values.yaml)):

| Value                                         | Meaning                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------ |
| `config` / `existingConfigMap`                | `status.yaml`; changes reload without a restart                          |
| `secret.values` / `existingSecret`            | `AUTH_SECRET` (generated if empty) and every `${VAR}` used in the config |
| `database.url` / `database.urlSecret`         | Postgres; empty means SQLite on a PVC                                    |
| `replicaCount`                                | >1 requires Postgres (the chart refuses otherwise)                       |
| `plugins.files` / `plugins.existingConfigMap` | your check plugins                                                       |
| `icmp.enabled`                                | allows ping checks as non-root (`net.ipv4.ping_group_range`)             |

**Kustomize**: `kubectl apply -k deploy/kustomize/overlays/sqlite` (one replica, PVC) or
`overlays/postgres` (two replicas, `DATABASE_URL` from the secret). Create the `heartline` Secret
first, see [`secret.example.yaml`](deploy/kustomize/base/secret.example.yaml).

The container runs as UID 1000 with a read-only root filesystem.

## Configuration

Everything lives in one `status.yaml`; `${VAR}` and `${VAR:-default}` are read from the environment.
Monitors defined there are read-only in the UI. The file reloads automatically, including ConfigMap updates.

```yaml
site: { title: Homelab status, timezone: Europe/Berlin, public: true }
retention: { rawDays: 30 } # raw results; daily rollups are kept forever

groups:
  - name: Code
    monitors:
      - id: gitea
        name: Gitea
        type: http # http | tcp | dns | tls | icmp | plugin
        url: https://git.example.com/api/healthz
        interval: 60s
        timeout: 10s
        failureThreshold: 2 # consecutive failures before it counts as down
        degradedAfter: 800ms # slower responses count as degraded
        expect: { status: [200], json: { status: pass } }
        notify: [teams] # empty = all channels
        autoIncident: true # open/resolve an incident automatically

notifiers:
  - { id: teams, type: teams, webhookUrl: '${TEAMS_WEBHOOK_URL}' }
  - id: email
    type: email
    from: status@example.com
    to: [ops@example.com]
    smtp: { host: smtp.example.com, port: 587, user: '${SMTP_USER}', password: '${SMTP_PASSWORD}' }
  - { id: hook, type: webhook, url: https://example.com/hook }

notifications: { recovery: true, incidents: true, reminderEvery: 1h }
```

Type-specific fields:

| Type     | Fields                                                                                                                                                                 |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `http`   | `url`, `method`, `headers`, `body`, `followRedirects`, `ignoreTls`, `expect.status`, `expect.bodyContains`, `expect.bodyRegex`, `expect.json` (`path.to.field: value`) |
| `tcp`    | `host`, `port`                                                                                                                                                         |
| `dns`    | `host`, `record` (A, AAAA, CNAME, MX, TXT, NS, SRV), `server`, `expect`                                                                                                |
| `tls`    | `host`, `port` (443), `servername`, `minDays` (degraded below)                                                                                                         |
| `icmp`   | `host`                                                                                                                                                                 |
| `plugin` | `plugin`, `args`                                                                                                                                                       |

**Microsoft Teams**: in the channel, open _Workflows_ and pick _Post to a channel when a webhook request
is received_. Use that URL as `webhookUrl`.

| Environment variable      | Default                                                                          |
| ------------------------- | -------------------------------------------------------------------------------- |
| `BASE_URL`                | `http://localhost:$PORT`. Public URL, used for links, OAuth and the MCP resource |
| `AUTH_SECRET`             | required in production                                                           |
| `DATABASE_URL`            | `sqlite:./data/status.db` or `postgres://…`                                      |
| `CONFIG_PATH`             | `status.yaml`                                                                    |
| `PLUGINS_DIR`             | `plugins`                                                                        |
| `PORT`, `HOST`            | `3000`, `0.0.0.0`                                                                |
| `LOG_LEVEL`, `LOG_FORMAT` | `info`, text (`json` in the container)                                           |

## Sign-in and roles

Roles: **viewer** (read), **editor** (incidents, maintenance, run and pause checks), **admin** (monitors, users,
notifier tests, plugin tests). Seeded users (`auth.users`) follow the config on every start.

```yaml
auth:
  local: true
  users:
    - { email: admin@example.com, name: Admin, password: '${ADMIN_PASSWORD}', role: admin }
  oidc:
    - id: gitea
      name: Gitea
      discoveryUrl: https://git.example.com/.well-known/openid-configuration
      clientId: ${GITEA_CLIENT_ID}
      clientSecret: ${GITEA_CLIENT_SECRET}
      scopes: [openid, profile, email, groups]
      roles: { 'homelab:owners': admin, 'homelab:ops': editor } # Gitea sends org and org:team
      defaultRole: none # none = deny everyone else
```

To set this up in Gitea, go to _Site administration → Applications_ (or a user or org) and create an
OAuth2 application with the redirect URI `https://status.example.com/api/auth/callback/gitea`.
Roles are re-evaluated on every sign-in, and role mappings follow config reloads. Adding or removing a provider needs a restart.

## MCP

```sh
claude mcp add --transport http status https://status.example.com/mcp
```

The client registers itself, opens the browser to sign in (Gitea or local), and asks for consent. Access
is the lower of your role and the granted scopes (`status:read`, `status:write`, `status:admin`).
Headless clients send `Authorization: Bearer hl_…` with an API token from the admin area.

| Tool                                                                                                               | Needs |
| ------------------------------------------------------------------------------------------------------------------ | ----- |
| `list_services`, `get_service`, `uptime_report`, `list_incidents`, `list_maintenance`; resource `status://summary` | read  |
| `create_incident`, `update_incident`, `schedule_maintenance`, `run_check`, `set_paused`                            | write |
| `create_monitor`, `test_plugin`                                                                                    | admin |

## Plugins

A plugin is a directory with a `plugin.yaml` and any executable. Exit code `0` means up, `1` down and
`2` degraded. An optional JSON last line (`{"status","latency_ms","message"}`) adds details. Args reach the
plugin as `STATUS_ARG_*`, and server secrets are never passed on. See [`plugins/README.md`](plugins/README.md)
and the two examples (`backup-age`, `http-json-field`).

## HTTP API

Public (or for any signed-in user when `site.public: false`):

- `GET /api/v1/overview?days=90`, `GET /api/v1/services/:id?days=30`
- `GET /api/v1/incidents`, `GET /api/v1/incidents/:id`, `GET /api/v1/maintenance`
- `GET /api/v1/report.csv?days=90`, `GET /api/v1/services/:id/report.csv`
- `GET /api/v1/badge/:id.svg`, `GET /api/v1/incidents.rss`

Admin (session or `Bearer hl_…`): `/api/v1/admin/{monitors,incidents,maintenance,notifiers,tokens,users,plugins}`.
Health: `/healthz`, `/readyz`.

## Development

Requires Node 26 and pnpm 12.

```sh
pnpm install
pnpm dev          # API on :3000 (dev/status.yaml) + UI on :5173
pnpm test         # unit, integration, PGlite and (with Docker) Postgres tests
pnpm --filter @heartline/web e2e   # Playwright against the built UI
pnpm lint && pnpm format:check && pnpm typecheck
```

The dev admin is `admin@status.local` / `change-me-please`.

Layout: `apps/server` (Hono, better-auth, Kysely, MCP), `apps/web` (React 19, TanStack Router/Query,
Tailwind 4, visx), `packages/shared` (types and zod schemas), `plugins/`, `deploy/` (Helm, Kustomize).
The server runs its TypeScript directly on Node 26 (type stripping) without a build step.

## License

MIT, see [LICENSE](LICENSE).
