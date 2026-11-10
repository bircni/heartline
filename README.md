# heartline

A self-hosted status page for the services you run yourself: GitHub/Claude-style availability bars,
uptime reports for any number of days, incidents and maintenance, Teams and e-mail alerts, Gitea
sign-in, API tokens and a built-in MCP server.

- **Pull-based checks**: HTTP, TCP, DNS, TLS certificate, ICMP, plus **exec plugins** for anything else
  (backup age, queue length, a scripted login). Your services are never modified.
- **Status page**: overview with 7/30/90-day bars, per-service response-time charts (average + p95),
  recent checks, incident timelines, RSS, CSV export and uptime badges.
- **Software inventory**: the running version of every service (read from the check response, a
  separate probe, a plugin or set by hand), the latest release and end-of-life date (endoflife.date),
  known vulnerabilities for that exact version (OSV.dev, NVD, CISA KEV) and an **update urgency**
  from none to critical, with notifications when something new turns up.
- **Admin area**: monitors (from `status.yaml` or created in the UI), incidents with public updates,
  recurring maintenance windows (RRULE), notification channels with test sends, API tokens, users.
- **Auth**: local accounts seeded from config, OAuth/OIDC (Gitea or any OIDC provider) with role mapping
  from groups, scoped API tokens (`read`, `write`, `admin`).
- **API**: everything the UI does is available over HTTP (OpenAPI 3.1 at `/api/v1/openapi.json`,
  human-readable at `/api/docs`).
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

Start from [`status.example.yaml`](status.example.yaml). Without a mounted file the image uses
[`deploy/docker/status.yaml`](deploy/docker/status.yaml), which only needs `ADMIN_PASSWORD` and monitors
itself. Open http://localhost:3000, then sign in at `/login` with the user from `auth.users`.

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
| `WEB_DIST`                | `../web/dist`; empty disables serving the UI                                     |
| `LOG_LEVEL`, `LOG_FORMAT` | `info`, text (`json` in the container)                                           |
| `NVD_API_KEY`             | unset; raises the NVD rate limit for vulnerability lookups                       |
| `GITHUB_TOKEN`            | unset; raises the GitHub rate limit for release lookups                          |
| `HEARTLINE_OFFLINE`       | unset; `1` never contacts the vulnerability and release data sources             |

`AUTH_SECRET` may also be given as `BETTER_AUTH_SECRET`; `site.baseUrl` in the config wins over `BASE_URL`.

## Software versions and vulnerabilities

Add a `software` block to any monitor and heartline keeps track of what is running, what is current
and whether an update is urgent:

```yaml
- id: gitea
  name: Gitea
  type: http
  url: https://git.example.com/api/healthz
  software: { product: gitea } # catalog product: version probe, CPE and OSV package are known

- id: grafana
  type: http
  url: https://grafana.example.com/api/health
  software: { product: grafana, version: { json: version } } # read inline from the check response

- id: ha
  type: http
  url: https://ha.example.com/
  software:
    product: home-assistant
    version: { headers: { Authorization: 'Bearer ${HA_TOKEN}' }, interval: 6h } # probe needs auth

- id: postgres
  type: tcp
  host: db.example.com
  port: 5432
  software: { product: postgresql, version: { static: '16.4' } } # or report "version" from a plugin

- id: thing
  type: http
  url: https://thing.example.com/
  software:
    product: thing # anything not in the catalog
    version: { url: https://thing.example.com/version, regex: 'v?(\d+\.\d+\.\d+)' }
    cpe: 'cpe:2.3:a:vendor:thing' # for NVD
    osv: { ecosystem: npm, name: thing } # for OSV.dev
    track: false # version and releases only, no vulnerability lookup
```

**Where the version comes from**: `version.static`; a separate request to `version.url` (or the
catalog's probe path relative to the monitor URL) read through `json` (dot path, `''` = whole body),
`header` or `regex` (capture groups are joined with dots); the check response itself for `http`
monitors with `json`/`header`/`regex` and no `url`; or the `"version"` field of a plugin's JSON line.
Catalog products (`GET /api/v1/admin/software/catalog`): Gitea, Forgejo, Nextcloud, Grafana,
Prometheus, Immich, Vaultwarden, Home Assistant, Jellyfin, Traefik, Keycloak, MinIO, Portainer,
Proxmox VE, Pi-hole, Paperless-ngx, Synapse, Mastodon, Gotify, Miniflux, authentik, Sonarr, Radarr,
Kubernetes, Docker, nginx, Caddy, Uptime Kuma, PostgreSQL, MariaDB, Redis, Valkey, Node.js, heartline.

**Where the latest release comes from**: endoflife.date for catalog products, the product's GitHub
releases when endoflife.date has no entry, or a `releases` block of your own, which always wins. That
is how self-built software gets a "latest" to compare against, for example from your Gitea instance:

```yaml
- id: my-app
  type: http
  url: https://app.example.com/healthz
  software:
    product: my-app
    version: { url: https://app.example.com/version, json: version }
    releases: { gitea: https://git.example.com, repo: nicolas/my-app } # or github: owner/repo
    # releases: { url: https://app.example.com/latest.json, json: tag_name }   # or regex: 'v(\d+\.\d+\.\d+)'
    # releases: { ..., headers: { Authorization: 'token ${GITEA_TOKEN}' }, prerelease: true }
    pinCycle: '1.4' # optional: stay on this cycle, newer cycles are not counted as updates
```

Gitea, Forgejo and GitHub are read through their releases API (drafts and, unless `prerelease: true`,
pre-releases are skipped; tags are the fallback). The release page is linked from the status page,
the admin area and the notifications. Software without an advisory source (private code) is scored
by releases behind and end-of-life only and says so in its reasons.

**Data sources** (all free, all optional, all cached in the database and refreshed every
`software.refreshEvery`, default 6h): [OSV.dev](https://osv.dev) for advisories by package and version,
[NVD](https://nvd.nist.gov) by CPE (enabled automatically when `NVD_API_KEY` is set, or `sources.nvd: true`),
[endoflife.date](https://endoflife.date) for the latest release, the running release cycle and its end
of life, [CISA KEV](https://www.cisa.gov/known-exploited-vulnerabilities-catalog) for vulnerabilities
that are exploited in the wild, and release pages (Gitea/Forgejo, GitHub with an optional
`GITHUB_TOKEN`, or any URL) for the latest version. A source that is down leaves the last known data in place; a service
with no data shows `unknown`. `HEARTLINE_OFFLINE=1` disables all lookups.

**Urgency** is a score from 0 to 100 and a level: vulnerabilities add points by CVSS (9+ → 40,
7+ → 25, 4+ → 12), +40 when listed in KEV, less when no fix exists yet; an end-of-life release cycle
adds 30; being behind adds 4 per patch release (max 20) and 10 when a newer cycle exists. Levels:
critical ≥ 70, high ≥ 45, medium ≥ 20, low > 0. Any exploited vulnerability is always critical, a
CVSS 9+ at least high, a CVSS 7+ or an end-of-life cycle at least medium. The reasons are shown next
to the level ("CVE-2025-1234 (CVSS 9.8, actively exploited) fixed in 1.24.5", "3 patch releases behind").

**Privacy**: versions, urgency and vulnerabilities are only shown to signed-in users (and tokens).
`site.showVersions: true` additionally shows versions and release information to anonymous visitors;
vulnerability details and urgency never leave the admin area. Notifications (`notifications.security`)
go out for new vulnerabilities, when urgency rises to high or critical, and when a version changes.

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

| Tool                                                                                                                                                                                                                                                     | Needs |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `list_services`, `get_service`, `uptime_report`, `list_incidents`, `get_incident`, `list_maintenance`, `list_monitors`, `list_plugins`, `list_notifiers`, `software_inventory`, `get_vulnerabilities`; resources `status://summary`, `status://software` | read  |
| `create_incident`, `update_incident`, `edit_incident`, `schedule_maintenance`, `update_maintenance`, `delete_maintenance`, `run_check`, `set_paused`, `refresh_software`                                                                                 | write |
| `create_monitor`, `update_monitor`, `delete_monitor`, `delete_incident`, `test_plugin`, `test_notifier`                                                                                                                                                  | admin |

## Plugins

A plugin is a directory with a `plugin.yaml` and any executable. Exit code `0` means up, `1` down and
`2` degraded. An optional JSON last line (`{"status","latency_ms","message","version"}`) adds details;
`version` feeds the software inventory. Args reach the
plugin as `STATUS_ARG_*`, and server secrets are never passed on. See [`plugins/README.md`](plugins/README.md)
and the two examples (`backup-age`, `http-json-field`).

## HTTP API

The full description is served by the instance: `GET /api/v1/openapi.json` (OpenAPI 3.1) and
`/api/docs`. Timestamps are Unix milliseconds. Admin routes take the browser session or
`Authorization: Bearer hl_…` with an API token whose scopes are `read` ⊂ `write` ⊂ `admin`.

Public (or for any signed-in user when `site.public: false`):

- `GET /api/v1/site`, `GET /api/v1/me`, `GET /api/v1/version`
- `GET /api/v1/overview?days=90`, `GET /api/v1/services/:id?days=30`
- `GET /api/v1/incidents?active=true&limit=50`, `GET /api/v1/incidents/:id`, `GET /api/v1/maintenance`, `GET /api/v1/maintenance/:id`
- `GET /api/v1/report.csv?days=90`, `GET /api/v1/services/:id/report.csv`
- `GET /api/v1/badge/:id.svg` (`?kind=version` for a version badge), `GET /api/v1/incidents.rss`

Software inventory (`read` scope; anonymous visitors only with `site.showVersions`, and never the
vulnerabilities): `GET /api/v1/software`, `GET /api/v1/services/:id/software`,
`GET /api/v1/software/report.csv`.

Admin (`/api/v1/admin/…`):

| Route                                                                                                                              | Scope |
| ---------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `GET monitors`, `GET monitors/:id`, `GET plugins`, `GET notifiers`, `GET software/catalog`, `GET tokens`                           | read  |
| `POST monitors/:id/run`, `POST monitors/:id/pause`, `POST monitors/:id/software/refresh`, `POST software/refresh`                  | write |
| `POST incidents`, `PATCH incidents/:id`, `POST incidents/:id/updates`                                                              | write |
| `POST maintenance`, `PUT maintenance/:id`, `DELETE maintenance/:id`                                                                | write |
| `POST tokens`, `DELETE tokens/:id` (own; `GET tokens?all=true` needs admin)                                                        | read  |
| `POST monitors`, `PUT monitors/:id`, `DELETE monitors/:id`, `POST plugins/test`, `POST notifiers/:id/test`, `DELETE incidents/:id` | admin |
| `GET users`, `POST users`, `PATCH users/:id`, `DELETE users/:id`                                                                   | admin |

Health: `/healthz`, `/readyz`.

## Development

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
`deploy/` (Helm, Kustomize, the container's default config).
The server runs its TypeScript directly on Node 26 (type stripping) without a build step.

## License

MIT, see [LICENSE](LICENSE).
