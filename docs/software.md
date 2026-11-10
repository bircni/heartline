# Software versions and vulnerabilities

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
