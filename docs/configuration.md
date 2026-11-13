# Configuration

Everything lives in one `status.yaml`; `${VAR}` and `${VAR:-default}` are read from the environment.
Monitors defined there are read-only in the UI. The file reloads automatically, including ConfigMap
updates. [`status.example.yaml`](../status.example.yaml) is a complete starting point.

## Site

```yaml
site:
  title: Homelab status
  description: Availability of self-hosted services
  timezone: Europe/Berlin # days, ranges, reports and every time shown on the page follow this zone
  # baseUrl: https://status.example.com   # defaults to BASE_URL
  # logoUrl: https://example.com/logo.svg
  public: true # false: the status page and public API need a signed-in user or a token
  showVersions: false # show running versions to anonymous visitors (vulnerabilities never are)
  theme: green # default colour: green, blue, violet, amber or rose; visitors can pick their own

retention:
  rawDays: 30 # raw check results; daily rollups are kept forever
  auditDays: 365 # audit log entries
```

## Monitors

```yaml
groups:
  - name: Code
    monitors:
      - id: gitea
        name: Gitea
        type: http # http | tcp | dns | tls | icmp | plugin | provider
        url: https://git.example.com/api/healthz
        interval: 60s
        timeout: 10s
        failureThreshold: 2 # consecutive failures before it counts as down
        degradedAfter: 800ms # slower responses count as degraded
        expect: { status: [200], json: { status: pass } }
        notify: [teams] # empty = all channels
        autoIncident: true # open/resolve an incident automatically
        dependsOn: [github] # their outages are shown and alerted as the likely cause
```

| Type       | Fields                                                                                                                                                                 |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `http`     | `url`, `method`, `headers`, `body`, `followRedirects`, `ignoreTls`, `expect.status`, `expect.bodyContains`, `expect.bodyRegex`, `expect.json` (`path.to.field: value`) |
| `tcp`      | `host`, `port`                                                                                                                                                         |
| `dns`      | `host`, `record` (A, AAAA, CNAME, MX, TXT, NS, SRV), `server`, `expect`                                                                                                |
| `tls`      | `host`, `port` (443), `servername`, `minDays` (degraded below)                                                                                                         |
| `icmp`     | `host`                                                                                                                                                                 |
| `plugin`   | `plugin`, `args`, see [plugins](../plugins/README.md)                                                                                                                  |
| `provider` | `provider`, `url`, `components`, `window`, `m365`, see [third-party services](#third-party-services)                                                                   |

Add a `software` block to track the running version and its vulnerabilities, see
[software.md](software.md).

## Third-party services

`provider` monitors follow the status the provider itself publishes: Atlassian, GitHub,
Google Workspace, Slack, the Microsoft 365 health of your own tenant, and so on. They show up in
their own _Third-party services_ section and never change your overall status or headline.

```yaml
groups:
  - name: Third-party
    monitors:
      - { id: jira, name: Jira, type: provider, provider: atlassian-jira }
      - { id: github, name: GitHub, type: provider, provider: github, components: [Actions, Git Operations] }
      - {
          id: workspace,
          name: Google Workspace,
          type: provider,
          provider: google-workspace,
          components: [Gmail],
        }
      - { id: vendor, name: Vendor, type: provider, provider: statuspage, url: https://status.vendor.com }
      - id: m365
        name: Microsoft 365
        type: provider
        provider: m365
        components: [Exchange Online, Microsoft Teams]
        m365:
          tenantId: ${M365_TENANT_ID}
          clientId: ${M365_CLIENT_ID}
          clientSecret: ${M365_CLIENT_SECRET}
```

| Provider                                                                                                                                                    | Source                                        | `components` filters on |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ----------------------- |
| `atlassian`, `atlassian-jira`, `atlassian-jira-service-management`, `atlassian-confluence`, `atlassian-bitbucket`, `atlassian-trello`, `atlassian-opsgenie` | Atlassian Statuspage                          | components or groups    |
| `github`, `cloudflare`, `digitalocean`, `discord`, `dropbox`, `netlify`, `npm`, `sentry`, `twilio`, `vercel`, `zoom`                                        | Atlassian Statuspage                          | components or groups    |
| `statuspage` + `url`                                                                                                                                        | any Atlassian Statuspage                      | components or groups    |
| `google-workspace`, `google-cloud`                                                                                                                          | Google status dashboard                       | products                |
| `slack`                                                                                                                                                     | Slack status API                              | services                |
| `m365` + `m365`                                                                                                                                             | Microsoft Graph service health of your tenant | services                |
| `azure`                                                                                                                                                     | Azure status feed                             | words in the title      |
| `feed` + `url`                                                                                                                                              | any RSS or Atom feed                          | words in the title      |

- Component states map to operational, degraded (degraded performance, partial outage), down
  (major outage) and maintenance. The message names the affected parts and links the open incident.
- When the status source cannot be read, the check reports **unknown**: no alert, and the check
  does not count for or against uptime. Returning to the last known state does not alert again.
- Defaults differ from your own monitors: `interval: 5m`, `failureThreshold: 1`.
- Feeds have no severity, so open entries count as degraded. Entries newer than `window` (6h; every
  entry for Azure) count as open, unless the title says resolved, completed, mitigated or restored.
- Microsoft 365 needs an app registration with the application permission
  `ServiceHealth.Read.All` (admin consent). The admin API never returns the client secret.

Add `dependsOn` to your own monitors to connect them: when GitHub is down, your CI row shows
"via GitHub", and its alerts say `Likely cause: GitHub is down.`

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

## Audit log

Admins find every change under _Audit log_ (`GET /api/v1/admin/audit`, MCP `list_audit_log`): who created,
edited or deleted monitors, incidents, maintenance, users and tokens, from the web, an API token or MCP.
Automatic incidents and `status.yaml` reloads are recorded as _automatic_. Secrets in the recorded values
(passwords, tokens, client secrets, auth headers) are replaced by `[redacted]`.

## Rate limits

```yaml
rateLimit:
  enabled: true
  public: { max: 300, window: 1m } # anonymous API, feed and badge reads per IP and replica
  auth: { max: 10, window: 1m } # sign-in and OAuth client registration per IP, all replicas together
  trustProxy: false # true behind a reverse proxy or ingress: the client IP comes from X-Forwarded-For
```

Signed-in users and API tokens are not limited on reads. Over the limit, the API answers `429` with
`Retry-After`. Behind an ingress, set `trustProxy: true`, or every visitor shares the proxy's address.
Only enable it when the proxy sets `X-Forwarded-For`, because clients can otherwise send their own.

## Environment

| Variable                    | Default                                                                                        |
| --------------------------- | ---------------------------------------------------------------------------------------------- |
| `BASE_URL`                  | `http://localhost:$PORT`. Public URL, used for links, OAuth and the MCP resource               |
| `AUTH_SECRET`               | required in production                                                                         |
| `DATABASE_URL`              | `sqlite:./data/status.db` or `postgres://…`                                                    |
| `CONFIG_PATH`               | `status.yaml`                                                                                  |
| `PLUGINS_DIR`               | `plugins`                                                                                      |
| `PORT`, `HOST`              | `3000`, `0.0.0.0`                                                                              |
| `WEB_DIST`                  | `../web/dist`; empty disables serving the UI                                                   |
| `LOG_LEVEL`, `LOG_FORMAT`   | `info`, text (`json` in the container)                                                         |
| `NVD_API_KEY`               | unset; raises the NVD rate limit for vulnerability lookups                                     |
| `GITHUB_TOKEN`              | unset; raises the GitHub rate limit for release lookups                                        |
| `HEARTLINE_OFFLINE`         | unset; `1` never contacts the vulnerability and release data sources                           |
| `HTTPS_PROXY`, `HTTP_PROXY` | unset; proxy for outbound requests (checks, provider status, software sources, notifiers)      |
| `NO_PROXY`                  | unset; comma-separated hosts that bypass the proxy (`localhost`, `127.0.0.1`, `::1` always do) |

`AUTH_SECRET` may also be given as `BETTER_AUTH_SECRET`; `site.baseUrl` in the config wins over `BASE_URL`.
Proxy variables are read in either case; `NODE_USE_ENV_PROXY` is not needed. `ignoreTls` checks go through the proxy too, without verifying the target's certificate.
