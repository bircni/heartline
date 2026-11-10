import { formatDuration, monitorSpecSchema, parseDuration } from '@heartline/shared';
import { describe, expect, it } from 'vitest';
import { effectiveScope, roleFromGroups } from '../src/auth/roles.ts';
import { evaluateResponse } from '../src/checks/http.ts';
import { parsePingOutput } from '../src/checks/network.ts';
import { interpretPluginOutput } from '../src/checks/plugins.ts';
import { ConfigError, interpolateEnv, parseConfig } from '../src/config/load.ts';
import { oidcProviderSchema } from '../src/config/schema.ts';
import { render, teamsPayload } from '../src/notify/index.ts';
import { occurrence } from '../src/services/maintenance.ts';
import { dayState, uptimeOf } from '../src/services/queries.ts';
import { nextState, p95 } from '../src/status/engine.ts';
import { dayKey } from '@heartline/shared';
import { dayRange, lastDays } from '../src/util/time.ts';

const rollup = (
  o: Partial<{ checks: number; up: number; degraded: number; down: number; maintenance: number }>,
) => ({
  day: '2026-11-01',
  checks: 0,
  up: 0,
  degraded: 0,
  down: 0,
  maintenance: 0,
  latency_sum: 0,
  latency_count: 0,
  latency_max: 0,
  latency_p95: null,
  ...o,
});

describe('durations', () => {
  it('parses compound durations', () => {
    expect(parseDuration('800ms')).toBe(800);
    expect(parseDuration('1h30m')).toBe(5_400_000);
    expect(parseDuration(15)).toBe(15);
    expect(formatDuration(60_000)).toBe('1m');
  });
  it('rejects garbage', () => {
    expect(() => parseDuration('10 parsecs')).toThrow('Invalid duration');
    expect(() => parseDuration('5x')).toThrow('Invalid duration');
  });
});

describe('config', () => {
  it('interpolates env vars with defaults and fails on missing ones', () => {
    expect(interpolateEnv({ a: '${X}', b: ['${Y:-fallback}'] }, { X: 'one' })).toEqual({
      a: 'one',
      b: ['fallback'],
    });
    expect(() => interpolateEnv({ secret: '${MISSING}' }, {})).toThrow(/MISSING/);
  });

  it('applies defaults to a minimal config', () => {
    const cfg = parseConfig(
      'groups:\n  - name: Web\n    monitors:\n      - { id: a, name: A, type: http, url: "https://a.example" }\n',
    );
    const m = cfg.groups[0]?.monitors[0];
    expect(m).toMatchObject({ interval: 60_000, timeout: 10_000, failureThreshold: 2, method: 'GET' });
    expect(cfg.site.timezone).toBe('UTC');
    expect(cfg.retention.rawDays).toBe(30);
  });

  it('reports duplicate ids and unknown notifiers', () => {
    const yaml = `groups:
  - name: Web
    monitors:
      - { id: a, name: A, type: tcp, host: x, port: 1, notify: [nope] }
      - { id: a, name: B, type: tcp, host: y, port: 2 }`;
    expect(() => parseConfig(yaml)).toThrow(ConfigError);
    expect(() => parseConfig(yaml)).toThrow(/duplicate monitor id "a"[\s\S]*|unknown notifier "nope"/);
  });

  it('rejects invalid monitor ids', () => {
    expect(monitorSpecSchema.safeParse({ id: 'Bad Id', name: 'x', type: 'icmp', host: 'h' }).success).toBe(
      false,
    );
  });
});

describe('state machine', () => {
  it('only reports failures after the threshold', () => {
    let s = { status: 'operational' as const, failures: 0 } as { status: string; failures: number };
    s = nextState(s as never, 'down', 3, false);
    expect(s).toEqual({ status: 'operational', failures: 1 });
    s = nextState(s as never, 'down', 3, false);
    s = nextState(s as never, 'down', 3, false);
    expect(s).toEqual({ status: 'down', failures: 3 });
    expect(nextState(s as never, 'up', 3, false)).toEqual({ status: 'operational', failures: 0 });
  });
  it('reports degraded vs down by the latest result and honours maintenance', () => {
    expect(nextState({ status: 'operational', failures: 1 }, 'degraded', 2, false).status).toBe('degraded');
    expect(nextState({ status: 'down', failures: 5 }, 'down', 2, true).status).toBe('maintenance');
    expect(nextState({ status: 'maintenance', failures: 0 }, 'down', 2, false).status).toBe('unknown');
  });
  it('computes p95', () => {
    expect(p95([])).toBeNull();
    expect(p95(Array.from({ length: 100 }, (_, i) => i + 1))).toBe(95);
  });
});

describe('rollups', () => {
  it('derives day states', () => {
    expect(dayState(undefined)).toBe('nodata');
    expect(dayState(rollup({ checks: 100, up: 100 }))).toBe('operational');
    expect(dayState(rollup({ checks: 100, up: 99, down: 1 }))).toBe('degraded');
    expect(dayState(rollup({ checks: 100, up: 90, down: 10 }))).toBe('down');
    expect(dayState(rollup({ checks: 100, up: 90, degraded: 10 }))).toBe('degraded');
    expect(dayState(rollup({ checks: 10, maintenance: 10 }))).toBe('maintenance');
  });
  it('computes uptime excluding maintenance and counting degraded as up', () => {
    expect(uptimeOf([rollup({ checks: 100, up: 50, degraded: 49, down: 1 })])).toBe(99);
    expect(uptimeOf([rollup({ checks: 10, up: 5, maintenance: 5 })])).toBe(100);
    expect(uptimeOf([])).toBeNull();
  });
});

describe('time zones', () => {
  it('computes calendar days and DST-aware ranges', () => {
    expect(dayKey(Date.UTC(2026, 10, 1, 23, 30), 'Europe/Berlin')).toBe('2026-11-02');
    const [start, end] = dayRange('2026-10-25', 'Europe/Berlin'); // DST ends: 25 hour day
    expect(end - start).toBe(25 * 3_600_000);
    expect(lastDays(3, Date.UTC(2026, 10, 1, 12), 'UTC')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01']);
  });
});

describe('http evaluation', () => {
  const spec = monitorSpecSchema.parse({
    id: 'h',
    name: 'h',
    type: 'http',
    url: 'https://h.example',
    expect: { status: [200], json: { 'checks.0.ok': true } },
  });
  it('validates status codes and JSON paths', () => {
    if (spec.type !== 'http') throw new Error('unreachable');
    expect(evaluateResponse(spec, 200, '{"checks":[{"ok":true}]}')).toBeNull();
    expect(evaluateResponse(spec, 503, '')).toMatch(/HTTP 503/);
    expect(evaluateResponse(spec, 200, '{"checks":[{"ok":false}]}')).toMatch(/checks.0.ok is false/);
    expect(evaluateResponse(spec, 200, 'nope')).toMatch(/not valid JSON/);
  });
});

describe('plugin output', () => {
  it('maps exit codes and JSON overrides', () => {
    expect(interpretPluginOutput(0, '', '', 5)).toEqual({ status: 'up', latencyMs: 5, message: null });
    expect(interpretPluginOutput(2, 'queue long\n', '', 5).status).toBe('degraded');
    expect(interpretPluginOutput(7, '', 'boom\n', 5)).toMatchObject({ status: 'down', message: 'boom' });
    expect(interpretPluginOutput(0, 'x\n{"status":"down","latency_ms":9,"message":"m"}', '', 5)).toEqual({
      status: 'down',
      latencyMs: 9,
      message: 'm',
    });
  });
  it('parses ping output', () => {
    expect(parsePingOutput('64 bytes from 1.1.1.1: icmp_seq=0 ttl=57 time=12.4 ms')).toBe(12);
  });
});

describe('maintenance recurrence', () => {
  const start = Date.UTC(2026, 10, 1, 2, 0); // Sunday 02:00 UTC
  const w = { startsAt: start, endsAt: start + 30 * 60_000, recurrence: 'FREQ=WEEKLY;BYDAY=SU' };
  it('finds the active and next occurrences', () => {
    expect(occurrence(w, start + 10 * 60_000)).toEqual({ start, end: start + 30 * 60_000 });
    expect(occurrence(w, start + 60 * 60_000)?.start).toBe(start + 7 * 86_400_000);
    expect(occurrence({ ...w, recurrence: null }, start + 60 * 60_000)).toBeNull();
  });
});

describe('roles', () => {
  const provider = oidcProviderSchema.parse({
    id: 'gitea',
    name: 'Gitea',
    discoveryUrl: 'https://git.example/.well-known/openid-configuration',
    clientId: 'c',
    clientSecret: 's',
    roles: { 'org:owners': 'admin', 'org:ops': 'editor' },
  });
  it('maps groups to the highest role or the default', () => {
    expect(roleFromGroups(provider, ['org', 'org:ops'])).toBe('editor');
    expect(roleFromGroups(provider, ['org:ops', 'org:owners'])).toBe('admin');
    expect(roleFromGroups(provider, ['other'])).toBe('none');
  });
  it('caps token scopes by role', () => {
    expect(effectiveScope('viewer', ['admin'])).toBe('read');
    expect(effectiveScope('admin', ['read'])).toBe('read');
    expect(effectiveScope('editor', ['write', 'read'])).toBe('write');
    expect(effectiveScope('admin', [])).toBeNull();
  });
});

describe('notifications', () => {
  it('renders an adaptive card for Teams', () => {
    const m = render(
      {
        kind: 'status',
        service: { id: 'gitea', name: 'Gitea' },
        from: 'operational',
        to: 'down',
        message: 'HTTP 502',
        at: 0,
      },
      'https://status.example',
      'Status',
    );
    expect(m.title).toBe('Gitea is down');
    const card = teamsPayload(m) as {
      attachments: { content: { body: { text?: string }[]; actions: { url: string }[] } }[];
    };
    expect(card.attachments[0]?.content.body[0]?.text).toBe('Gitea is down');
    expect(card.attachments[0]?.content.actions[0]?.url).toBe('https://status.example/services/gitea');
  });
});
