# HTTP API

The full description is served by the instance: `GET /api/v1/openapi.json` (OpenAPI 3.1) and
`/api/docs`. Timestamps are Unix milliseconds. Admin routes take the browser session or
`Authorization: Bearer hl_…` with an API token whose scopes are `read` ⊂ `write` ⊂ `admin`.

Public (or for any signed-in user when `site.public: false`):

- `GET /api/v1/site`, `GET /api/v1/me`, `GET /api/v1/version`
- `GET /api/v1/overview?days=90`, `GET /api/v1/services/:id?days=30`; add `&to=YYYY-MM-DD` to end the
  range on an earlier day (site time zone)
- `GET /api/v1/incidents?limit=50` with optional `state=open|resolved`, `q` (title text), `impact`, `service`;
  a full page sends `X-Next-Cursor`, pass it as `before` for the next one. `GET /api/v1/incidents/:id`,
  `GET /api/v1/maintenance`, `GET /api/v1/maintenance/:id`
- `GET /api/v1/report.csv?days=90`, `GET /api/v1/services/:id/report.csv` (both also take `to`)
- `GET /api/v1/badge/:id.svg` (`?kind=version` for a version badge), `GET /api/v1/incidents.rss`

Software inventory (`read` scope; anonymous visitors only with `site.showVersions`, and never the
vulnerabilities): `GET /api/v1/software`, `GET /api/v1/services/:id/software`,
`GET /api/v1/software/report.csv`.

Admin (`/api/v1/admin/…`):

| Route                                                                                                                              | Scope |
| ---------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `GET groups`; `POST groups`, `PUT groups/:id`, `DELETE groups/:id`, `PUT groups/order` need admin                                  | read  |
| `GET monitors`, `GET monitors/:id`, `GET plugins`, `GET notifiers`, `GET software/catalog`, `GET tokens`                           | read  |
| `POST monitors/:id/run`, `POST monitors/:id/pause`, `POST monitors/:id/software/refresh`, `POST software/refresh`                  | write |
| `POST incidents`, `PATCH incidents/:id`, `POST incidents/:id/updates`                                                              | write |
| `GET incidents/:id` (with draft postmortem), `PUT incidents/:id/postmortem`, `DELETE incidents/:id/postmortem`                     | write |
| `GET templates?kind=`, `POST templates`, `PUT templates/:id`, `DELETE templates/:id` (`GET` needs read)                            | write |
| `POST maintenance`, `PUT maintenance/:id`, `DELETE maintenance/:id`                                                                | write |
| `POST tokens`, `DELETE tokens/:id` (own; `GET tokens?all=true` needs admin)                                                        | read  |
| `POST monitors`, `PUT monitors/:id`, `DELETE monitors/:id`, `POST plugins/test`, `POST notifiers/:id/test`, `DELETE incidents/:id` | admin |
| `GET users`, `POST users`, `PATCH users/:id`, `DELETE users/:id`                                                                   | admin |
| `GET audit?limit&before&entityType&entityId&actor` (newest first; page with `before` = the last `at`)                              | admin |

Monitor bodies are `{ groupId, spec }` or `{ group, spec }`, where `group` is a group id or name and a new
name creates the group.

Validation errors answer `400` with `{ error, issues: [{ path, message }] }`, one issue per field. Anonymous
reads and sign-in attempts are rate limited and answer `429` with `Retry-After` (see `rateLimit` in the
[configuration](configuration.md#rate-limits)).

Health: `/healthz`, `/readyz`.
