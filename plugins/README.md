# Check plugins

A plugin checks something that has no HTTP/TCP/DNS endpoint: backup freshness, a queue length, a
script that logs in somewhere. The server runs it on the monitor's interval. Your services stay untouched.

## Layout

```
plugins/
  backup-age/
    plugin.yaml
    check.sh
```

## plugin.yaml

```yaml
name: backup-age # referenced by monitors as `plugin: backup-age`
description: Fails when the newest file in a directory is too old
command: ['sh', 'check.sh'] # run without a shell, working directory = plugin folder
timeout: 30s # hard limit; the process is killed afterwards
args:
  path: { type: string, required: true, description: Directory with backups }
  max_age_hours: { type: number, default: 26 }
```

Monitors pass args, which reach the plugin as environment variables `STATUS_ARG_<NAME>`:

```yaml
- id: backups
  name: Nightly backups
  type: plugin
  plugin: backup-age
  interval: 15m
  args: { path: /backups/restic, max_age_hours: 26 }
```

The environment is minimal (`PATH`, `HOME`, `LANG`, `STATUS_MONITOR_ID` and the args). Server secrets
are never passed on.

## Result

- Exit code `0` = up, `1` = down, `2` = degraded. Anything else (or a timeout) = down.
- Optionally print one JSON object as the **last line** of stdout to set details:

```json
{ "status": "degraded", "latency_ms": 120, "message": "newest backup is 20 h old" }
```

`status` in JSON overrides the exit code. Without JSON, the last stdout line becomes the message.
