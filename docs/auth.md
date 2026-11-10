# Sign-in, roles and MCP

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
