# Configuration

Everything lives in one `status.yaml`; `${VAR}` and `${VAR:-default}` are read from the environment.
Monitors defined there are read-only in the UI. The file reloads automatically, including ConfigMap
updates. [`status.example.yaml`](../status.example.yaml) is a complete starting point.

## Site

```yaml
site:
  title: Homelab status
  description: Availability of self-hosted services
  timezone: Europe/Berlin # days, ranges and reports follow this zone
  # baseUrl: https://status.example.com   # defaults to BASE_URL
  # logoUrl: https://example.com/logo.svg
  public: true # false: the status page and public API need a signed-in user or a token
  showVersions: false # show running versions to anonymous visitors (vulnerabilities never are)
  theme: green # default colour: green, blue, violet, amber or rose; visitors can pick their own

retention: { rawDays: 30 } # raw check results; daily rollups are kept forever
```

## Monitors

```yaml
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
```

| Type     | Fields                                                                                                                                                                 |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `http`   | `url`, `method`, `headers`, `body`, `followRedirects`, `ignoreTls`, `expect.status`, `expect.bodyContains`, `expect.bodyRegex`, `expect.json` (`path.to.field: value`) |
| `tcp`    | `host`, `port`                                                                                                                                                         |
| `dns`    | `host`, `record` (A, AAAA, CNAME, MX, TXT, NS, SRV), `server`, `expect`                                                                                                |
| `tls`    | `host`, `port` (443), `servername`, `minDays` (degraded below)                                                                                                         |
| `icmp`   | `host`                                                                                                                                                                 |
| `plugin` | `plugin`, `args`, see [plugins](../plugins/README.md)                                                                                                                  |

Add a `software` block to track the running version and its vulnerabilities, see
[software.md](software.md).

## Notifications

```yaml
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

**Microsoft Teams**: in the channel, open _Workflows_ and pick _Post to a channel when a webhook request
is received_. Use that URL as `webhookUrl`.

## Environment

| Variable                  | Default                                                                          |
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
