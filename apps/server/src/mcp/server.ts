import { requireMcpAuth } from '@better-auth/mcp';
import { type AuthInfo, McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import {
  IMPACTS,
  INCIDENT_STATUSES,
  type Scope,
  URGENCY_LEVELS,
  incidentCreateSchema,
  incidentPatchSchema,
  incidentUpdateCreateSchema,
  maintenanceCreateSchema,
  maintenanceUpdateSchema,
  monitorSpecSchema,
} from '@heartline/shared';
import { z } from 'zod';
import { type Principal, principalForUser } from '../auth/principal.ts';
import type { AuditInput } from '../services/audit.ts';
import { mcpResource } from '../auth/auth.ts';
import { OAUTH_SCOPES, oauthScopesToScopes, scopeAtLeast } from '../auth/roles.ts';
import { describeTarget, runCheck } from '../checks/index.ts';
import type { AppContext } from '../context.ts';
import { restoreSecrets, validateMonitorSpec } from '../services/monitors.ts';
import { URGENCY_RANK } from '../software/urgency.ts';
import { log } from '../util/log.ts';
import { APP_VERSION } from '../util/pkg.ts';

const VERSION = APP_VERSION;

type ToolResult = {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

function ok(data: unknown, summary?: string): ToolResult {
  const text = summary ? `${summary}\n\n${JSON.stringify(data, null, 2)}` : JSON.stringify(data, null, 2);
  return {
    content: [{ type: 'text', text }],
    ...(data && typeof data === 'object' && !Array.isArray(data)
      ? { structuredContent: data as Record<string, unknown> }
      : {}),
  };
}

function fail(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function fmtPct(v: number | null): string {
  return v === null ? 'no data' : `${v.toFixed(2)}%`;
}

/** Builds the MCP server for one request; tools check the caller's effective scope. */
export function buildMcpServer(app: AppContext, principal: Principal): McpServer {
  const server = new McpServer(
    { name: 'heartline', version: VERSION, title: `${app.site().title} status` },
    {
      instructions:
        'Read service availability, uptime reports, incidents and the software inventory (running versions, known vulnerabilities, update urgency) of this self-hosted status page. Write tools (incidents, maintenance, monitors, refreshes) need matching permissions.',
    },
  );

  /** Records a change made through MCP, marked as such in the actor name. */
  const audit = (entry: AuditInput) =>
    app.audit.record(
      { userId: principal.userId, name: `${principal.name} (MCP)`, via: principal.via },
      entry,
    );

  const guard = async (needed: Scope, fn: () => Promise<ToolResult>): Promise<ToolResult> => {
    if (!scopeAtLeast(principal.scope, needed))
      return fail(`Permission denied: this tool needs "${needed}" access, you have "${principal.scope}".`);
    try {
      return await fn();
    } catch (error) {
      return fail(error instanceof z.ZodError ? z.prettifyError(error) : (error as Error).message);
    }
  };

  server.registerTool(
    'list_services',
    {
      title: 'List services',
      description: 'All monitored services with current status and uptime over the given number of days.',
      inputSchema: z.object({ days: z.number().int().min(1).max(365).default(30) }),
      annotations: { readOnlyHint: true },
    },
    async ({ days }) =>
      guard('read', async () => {
        const o = await app.queries.overview(days);
        const services = [...o.groups, ...o.external].flatMap((g) =>
          g.services.map((s) => ({
            id: s.id,
            name: s.name,
            group: g.name,
            kind: s.kind,
            external: s.external,
            status: s.status,
            uptime: s.uptime,
            upstream: s.upstream.map((u) => ({ id: u.id, status: u.status })),
          })),
        );
        const lines = services.map(
          (s) =>
            `- ${s.name} [${s.id}]${s.external ? ' (third-party)' : ''} ${s.status}, ${fmtPct(s.uptime)} over ${days}d${s.upstream.length ? `, upstream: ${s.upstream.map((u) => `${u.id} ${u.status}`).join(', ')}` : ''}`,
        );
        return ok(
          { status: o.status, headline: o.headline, services },
          `${o.headline}. ${o.summary}\n${lines.join('\n')}`,
        );
      }),
  );

  server.registerTool(
    'get_service',
    {
      title: 'Service details',
      description: 'Current status, KPIs, daily history, recent checks and incidents of one service.',
      inputSchema: z.object({ id: z.string(), days: z.number().int().min(1).max(365).default(30) }),
      annotations: { readOnlyHint: true },
    },
    async ({ id, days }) =>
      guard('read', async () => {
        const d = await app.queries.detail(id, days);
        return ok(
          {
            id: d.id,
            name: d.name,
            status: d.status,
            target: d.target,
            kpis: d.kpis,
            lastCheckedAt: d.lastCheckedAt,
            recentChecks: d.checks.slice(0, 10),
            days: d.bars.map((b) => ({
              day: b.day,
              state: b.state,
              uptime: b.uptime,
              avgLatencyMs: b.avgLatencyMs,
            })),
            incidents: d.incidents.map((i) => ({ id: i.id, title: i.title, status: i.status })),
          },
          `${d.name} is ${d.status}. Uptime ${fmtPct(d.kpis.uptime)}, average ${d.kpis.avgLatencyMs ?? '–'} ms, p95 ${d.kpis.p95LatencyMs ?? '–'} ms, ${d.kpis.incidents} incidents in ${days} days.`,
        );
      }),
  );

  server.registerTool(
    'uptime_report',
    {
      title: 'Uptime report',
      description: 'Uptime percentage, worst day and incident count per service over the last N days.',
      inputSchema: z.object({
        days: z.number().int().min(1).max(365).default(30),
        service: z.string().optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ days, service }) =>
      guard('read', async () => {
        const all = await app.queries.summaries(days);
        const rows = all.filter((s) => !service || s.id === service);
        if (service && rows.length === 0) return fail(`service "${service}" not found`);
        const incidents = await app.incidents.list({ since: Date.now() - days * 86_400_000 });
        const report = rows.map((s) => {
          const worst = s.bars
            .filter((b) => b.uptime !== null)
            .toSorted((a, b) => (a.uptime as number) - (b.uptime as number))[0];
          return {
            id: s.id,
            name: s.name,
            uptime: s.uptime,
            worstDay: worst ? { day: worst.day, uptime: worst.uptime } : null,
            incidents: incidents.filter((i) => i.services.some((x) => x.id === s.id)).length,
          };
        });
        const text = report
          .map(
            (r) =>
              `- ${r.name}: ${fmtPct(r.uptime)}${r.worstDay && r.worstDay.uptime !== 100 ? `, worst day ${r.worstDay.day} (${fmtPct(r.worstDay.uptime)})` : ''}, ${r.incidents} incidents`,
          )
          .join('\n');
        return ok({ days, services: report }, `Uptime over the last ${days} days:\n${text}`);
      }),
  );

  server.registerTool(
    'list_incidents',
    {
      title: 'List incidents',
      description: 'Recent incidents with their updates. Set active to only return unresolved ones.',
      inputSchema: z.object({
        active: z.boolean().default(false),
        limit: z.number().int().min(1).max(200).default(20),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ active, limit }) =>
      guard('read', async () => ok({ incidents: await app.incidents.list({ activeOnly: active, limit }) })),
  );

  server.registerTool(
    'list_maintenance',
    {
      title: 'List maintenance',
      description: 'Scheduled and active maintenance windows.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => guard('read', async () => ok({ maintenance: app.maintenance.list() })),
  );

  server.registerTool(
    'create_incident',
    {
      title: 'Create incident',
      description: 'Open a public incident. Notifies Teams/e-mail unless notify is false.',
      inputSchema: z.object({
        title: z.string(),
        message: z.string(),
        impact: z.enum(IMPACTS).default('degraded'),
        status: z.enum(INCIDENT_STATUSES).default('investigating'),
        services: z.array(z.string()).default([]),
        notify: z.boolean().default(true),
      }),
    },
    async (input) =>
      guard('write', async () => {
        const parsed = incidentCreateSchema.parse(input);
        const i = await app.incidents.create(parsed, `${principal.name} (MCP)`);
        await audit({
          action: 'incident.create',
          entityType: 'incident',
          entityId: i.id,
          summary: `Declared incident “${i.title}”`,
          detail: parsed,
        });
        return ok(i, 'Incident created.');
      }),
  );

  server.registerTool(
    'update_incident',
    {
      title: 'Post incident update',
      description: 'Add a status update to an incident; status "resolved" closes it.',
      inputSchema: z.object({
        id: z.string(),
        status: z.enum(INCIDENT_STATUSES),
        message: z.string(),
        notify: z.boolean().default(true),
      }),
    },
    async ({ id, ...rest }) =>
      guard('write', async () => {
        const parsed = incidentUpdateCreateSchema.parse(rest);
        const i = await app.incidents.addUpdate(id, parsed, `${principal.name} (MCP)`);
        await audit({
          action: 'incident.post_update',
          entityType: 'incident',
          entityId: i.id,
          summary: `Posted a “${parsed.status}” update to “${i.title}”`,
          detail: parsed,
        });
        return ok(i, 'Update posted.');
      }),
  );

  server.registerTool(
    'schedule_maintenance',
    {
      title: 'Schedule maintenance',
      description:
        'Create a maintenance window (ISO timestamps). Optional RRULE recurrence such as FREQ=WEEKLY;BYDAY=SU.',
      inputSchema: z.object({
        title: z.string(),
        description: z.string().optional(),
        startsAt: z.string(),
        endsAt: z.string(),
        recurrence: z.string().optional(),
        services: z.array(z.string()).default([]),
      }),
    },
    async (input) =>
      guard('write', async () => {
        const parsed = maintenanceCreateSchema.parse(input);
        const m = await app.maintenance.create(parsed, `${principal.name} (MCP)`);
        await audit({
          action: 'maintenance.create',
          entityType: 'maintenance',
          entityId: m.id,
          summary: `Scheduled maintenance “${m.title}”`,
          detail: parsed,
        });
        return ok(m, 'Maintenance scheduled.');
      }),
  );

  server.registerTool(
    'run_check',
    {
      title: 'Run check now',
      description: 'Run a service check immediately and record the result.',
      inputSchema: z.object({ id: z.string() }),
    },
    async ({ id }) =>
      guard('write', async () => {
        const outcome = await app.scheduler.runNow(app.monitors.require(id));
        return ok(outcome ?? { message: 'a check is already running' });
      }),
  );

  server.registerTool(
    'set_paused',
    {
      title: 'Pause or resume a service',
      description: 'Paused services are not checked and excluded from the overall status.',
      inputSchema: z.object({ id: z.string(), paused: z.boolean() }),
    },
    async ({ id, paused }) =>
      guard('write', async () => {
        await app.monitors.setPaused(id, paused);
        await app.engine.setPausedState(id, paused);
        await audit({
          action: paused ? 'monitor.pause' : 'monitor.resume',
          entityType: 'monitor',
          entityId: id,
          summary: `${paused ? 'Paused' : 'Resumed'} monitor ${app.monitors.get(id)?.name ?? id}`,
        });
        return ok({ id, paused });
      }),
  );

  server.registerTool(
    'create_monitor',
    {
      title: 'Create monitor',
      description:
        'Add a UI-managed monitor (http, tcp, dns, tls, icmp, plugin, or provider for a third-party status page such as github, atlassian-jira, slack, google-workspace or m365).',
      inputSchema: z.object({ group: z.string(), spec: z.record(z.string(), z.unknown()) }),
    },
    async ({ group, spec }) =>
      guard('admin', async () => {
        const parsed = monitorSpecSchema.parse(spec);
        validateMonitorSpec(parsed, app);
        const m = await app.monitors.create(parsed, group);
        await audit({
          action: 'monitor.create',
          entityType: 'monitor',
          entityId: m.id,
          summary: `Created monitor ${m.name}`,
          detail: { group, spec: parsed },
        });
        return ok({ id: m.id, name: m.name, group: m.group }, 'Monitor created.');
      }),
  );

  server.registerTool(
    'update_monitor',
    {
      title: 'Update monitor',
      description: 'Replace the spec of a UI-managed monitor (monitors from status.yaml are read-only).',
      inputSchema: z.object({ id: z.string(), group: z.string(), spec: z.record(z.string(), z.unknown()) }),
    },
    async ({ id, group, spec }) =>
      guard('admin', async () => {
        const parsed = restoreSecrets(monitorSpecSchema.parse(spec), app.monitors.get(id)?.spec);
        validateMonitorSpec(parsed, app);
        const m = await app.monitors.update(id, parsed, group);
        await audit({
          action: 'monitor.update',
          entityType: 'monitor',
          entityId: m.id,
          summary: `Updated monitor ${m.name}`,
          detail: { group, spec: parsed },
        });
        return ok({ id: m.id, name: m.name, group: m.group }, 'Monitor updated.');
      }),
  );

  server.registerTool(
    'delete_monitor',
    {
      title: 'Delete monitor',
      description: 'Delete a UI-managed monitor and its history.',
      inputSchema: z.object({ id: z.string() }),
      annotations: { destructiveHint: true },
    },
    async ({ id }) =>
      guard('admin', async () => {
        const name = app.monitors.get(id)?.name ?? id;
        await app.monitors.remove(id);
        await audit({
          action: 'monitor.delete',
          entityType: 'monitor',
          entityId: id,
          summary: `Deleted monitor ${name}`,
        });
        return ok({ id, deleted: true }, 'Monitor deleted.');
      }),
  );

  server.registerTool(
    'list_monitors',
    {
      title: 'List monitors',
      description:
        'Monitor definitions as seen in the admin area: kind, target, source (config or UI), paused state.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () =>
      guard('read', async () =>
        ok({
          monitors: app.monitors.list().map((m) => ({
            id: m.id,
            name: m.name,
            group: m.group,
            kind: m.spec.type,
            target: describeTarget(m.spec),
            source: m.source,
            paused: m.paused,
            external: m.spec.type === 'provider',
            dependsOn: m.spec.dependsOn,
            intervalMs: m.spec.interval,
            software: m.spec.software
              ? { product: m.spec.software.product, track: m.spec.software.track }
              : null,
          })),
        }),
      ),
  );

  server.registerTool(
    'get_incident',
    {
      title: 'Get incident',
      description: 'One incident with all its updates.',
      inputSchema: z.object({ id: z.string() }),
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => guard('read', async () => ok(await app.incidents.get(id))),
  );

  server.registerTool(
    'edit_incident',
    {
      title: 'Edit incident',
      description: 'Change the title, impact or affected services of an incident without posting an update.',
      inputSchema: z.object({
        id: z.string(),
        title: z.string().optional(),
        impact: z.enum(IMPACTS).optional(),
        services: z.array(z.string()).optional(),
      }),
    },
    async ({ id, ...rest }) =>
      guard('write', async () => {
        const parsed = incidentPatchSchema.parse(rest);
        const i = await app.incidents.update(id, parsed);
        await audit({
          action: 'incident.edit',
          entityType: 'incident',
          entityId: i.id,
          summary: `Edited incident “${i.title}”`,
          detail: parsed,
        });
        return ok(i, 'Incident edited.');
      }),
  );

  server.registerTool(
    'delete_incident',
    {
      title: 'Delete incident',
      description: 'Remove an incident and its updates from the history.',
      inputSchema: z.object({ id: z.string() }),
      annotations: { destructiveHint: true },
    },
    async ({ id }) =>
      guard('admin', async () => {
        const title = (await app.incidents.get(id).catch(() => null))?.title ?? id;
        await app.incidents.remove(id);
        await audit({
          action: 'incident.delete',
          entityType: 'incident',
          entityId: id,
          summary: `Deleted incident “${title}”`,
        });
        return ok({ id, deleted: true }, 'Incident deleted.');
      }),
  );

  server.registerTool(
    'update_maintenance',
    {
      title: 'Update maintenance',
      description: 'Change a maintenance window (ISO timestamps, optional RRULE recurrence, services).',
      inputSchema: z.object({
        id: z.string(),
        title: z.string().optional(),
        description: z.string().nullable().optional(),
        startsAt: z.string().optional(),
        endsAt: z.string().optional(),
        recurrence: z.string().nullable().optional(),
        services: z.array(z.string()).optional(),
      }),
    },
    async ({ id, ...rest }) =>
      guard('write', async () => {
        const parsed = maintenanceUpdateSchema.parse(rest);
        const m = await app.maintenance.update(id, parsed);
        await audit({
          action: 'maintenance.update',
          entityType: 'maintenance',
          entityId: m.id,
          summary: `Updated maintenance “${m.title}”`,
          detail: parsed,
        });
        return ok(m, 'Maintenance updated.');
      }),
  );

  server.registerTool(
    'delete_maintenance',
    {
      title: 'Cancel maintenance',
      description: 'Delete a maintenance window.',
      inputSchema: z.object({ id: z.string() }),
      annotations: { destructiveHint: true },
    },
    async ({ id }) =>
      guard('write', async () => {
        const title = app.maintenance.list().find((m) => m.id === id)?.title ?? id;
        await app.maintenance.remove(id);
        await audit({
          action: 'maintenance.delete',
          entityType: 'maintenance',
          entityId: id,
          summary: `Deleted maintenance “${title}”`,
        });
        return ok({ id, deleted: true }, 'Maintenance deleted.');
      }),
  );

  server.registerTool(
    'list_audit_log',
    {
      title: 'Audit log',
      description:
        'Recent changes: who created, edited or deleted monitors, incidents, maintenance, users and tokens, plus automatic actions. Newest first.',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(500).default(50),
        entityType: z.string().optional(),
        entityId: z.string().optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    async (input) =>
      guard('admin', async () => {
        const entries = await app.audit.list(input);
        return ok(
          { entries },
          entries.map((e) => `- ${new Date(e.at).toISOString()} ${e.actor.name}: ${e.summary}`).join('\n') ||
            'No entries.',
        );
      }),
  );

  server.registerTool(
    'list_plugins',
    {
      title: 'List plugins',
      description: 'Installed check plugins and their arguments.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => guard('read', async () => ok({ plugins: app.plugins.list() })),
  );

  server.registerTool(
    'list_notifiers',
    {
      title: 'List notifiers',
      description: 'Configured notification channels with their last delivery state.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => guard('read', async () => ok({ notifiers: await app.notifier.list() })),
  );

  server.registerTool(
    'test_notifier',
    {
      title: 'Test notifier',
      description: 'Send a test message through one notification channel.',
      inputSchema: z.object({ id: z.string() }),
    },
    async ({ id }) => guard('admin', async () => ok(await app.notifier.test(id))),
  );

  server.registerTool(
    'software_inventory',
    {
      title: 'Software inventory',
      description:
        'Running version, latest release, end-of-life and update urgency (critical, high, medium, low, none, unknown) of every tracked service, worst first.',
      inputSchema: z.object({ minUrgency: z.enum(URGENCY_LEVELS).optional() }),
      annotations: { readOnlyHint: true },
    },
    async ({ minUrgency }) =>
      guard('read', async () => {
        const inv = await app.software.inventory();
        const services = inv.services.filter(
          (s) => !minUrgency || URGENCY_RANK[s.urgency ?? 'unknown'] >= URGENCY_RANK[minUrgency],
        );
        const lines = services.map(
          (s) =>
            `- ${s.serviceName} [${s.serviceId}] ${s.productName} ${s.version ?? '?'}${s.latest && s.latest !== s.version ? ` → ${s.latest}` : ''}, urgency ${s.urgency}${s.reasons[0] ? `: ${s.reasons[0]}` : ''}`,
        );
        return ok(
          { totals: inv.totals, lastRefreshAt: inv.lastRefreshAt, services },
          `${services.length} tracked services.\n${lines.join('\n')}`,
        );
      }),
  );

  server.registerTool(
    'get_vulnerabilities',
    {
      title: 'Service vulnerabilities',
      description:
        'Known vulnerabilities (CVSS, exploited flag, fixed version) and update reasons of one service.',
      inputSchema: z.object({ id: z.string() }),
      annotations: { readOnlyHint: true },
    },
    async ({ id }) =>
      guard('read', async () => {
        const d = await app.software.detail(id);
        if (!d) return fail(`service "${id}" has no software block`);
        const lines = d.vulnerabilities.map(
          (v) =>
            `- ${v.id} ${v.score === null ? 'unscored' : `CVSS ${v.score}`}${v.kev ? ', actively exploited' : ''}${v.fixedIn ? `, fixed in ${v.fixedIn}` : ''}: ${v.summary ?? ''}`,
        );
        return ok(
          d,
          `${d.serviceName}: ${d.productName} ${d.version ?? 'unknown version'}, urgency ${d.urgency}.\n${[...d.reasons, ...lines].join('\n')}`,
        );
      }),
  );

  server.registerTool(
    'refresh_software',
    {
      title: 'Refresh software data',
      description:
        'Re-probe the version and refresh vulnerability and release data for one service (or all when id is omitted).',
      inputSchema: z.object({ id: z.string().optional() }),
    },
    async ({ id }) =>
      guard('write', async () => {
        if (!id) return ok(await app.software.refreshAll(true), 'Refresh finished.');
        const m = app.monitors.require(id);
        if (!m.spec.software) return fail(`service "${id}" has no software block`);
        await app.software.probeNow(m);
        return ok(await app.software.refreshMonitor(id, true), 'Refreshed.');
      }),
  );

  server.registerTool(
    'test_plugin',
    {
      title: 'Test plugin',
      description: 'Run an installed check plugin once with the given args without recording anything.',
      inputSchema: z.object({
        plugin: z.string(),
        args: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
      }),
    },
    async ({ plugin, args }) =>
      guard('admin', async () => {
        const spec = monitorSpecSchema.parse({
          id: 'plugin-test',
          name: 'Plugin test',
          type: 'plugin',
          plugin,
          args,
        });
        return ok(await runCheck(spec, app.plugins));
      }),
  );

  server.registerResource(
    'summary',
    'status://summary',
    {
      title: 'Status summary',
      description: 'Overall status and per-service state',
      mimeType: 'application/json',
    },
    async (uri) => {
      const o = await app.queries.overview(30);
      const data = {
        status: o.status,
        headline: o.headline,
        summary: o.summary,
        services: o.groups.flatMap((g) =>
          g.services.map((s) => ({ id: s.id, name: s.name, status: s.status, uptime30d: s.uptime })),
        ),
      };
      return {
        contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }],
      };
    },
  );

  server.registerResource(
    'software',
    'status://software',
    {
      title: 'Software inventory',
      description: 'Versions, latest releases and update urgency per service',
      mimeType: 'application/json',
    },
    async (uri) => {
      const inv = await app.software.inventory();
      const data = inv.services.map((s) => ({
        id: s.serviceId,
        name: s.serviceName,
        product: s.productName,
        version: s.version,
        latest: s.latest,
        eol: s.eol,
        urgency: s.urgency,
        reasons: s.reasons,
      }));
      return {
        contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }],
      };
    },
  );

  return server;
}

interface PrincipalAuthInfo extends AuthInfo {
  extra: { principal: Principal };
}

/** `/mcp` handler: accepts OAuth access tokens issued by the built-in authorization server, or API tokens. */
export function mcpHandler(app: AppContext): (req: Request) => Promise<Response> {
  const handler = createMcpHandler(
    (ctx) => {
      const principal = (ctx.authInfo as PrincipalAuthInfo | undefined)?.extra?.principal;
      if (!principal) throw new Error('unauthenticated MCP request reached the server factory');
      return buildMcpServer(app, principal);
    },
    { legacy: 'stateless', onerror: (error) => log.warn('mcp error', { error: error.message }) },
  );

  const serve = (req: Request, principal: Principal, token: string, scopes: string[]) =>
    handler.fetch(req, {
      authInfo: {
        token,
        clientId: principal.via === 'token' ? 'api-token' : 'oauth',
        scopes,
        extra: { principal },
      } satisfies PrincipalAuthInfo,
    });

  const oauth = requireMcpAuth(
    app.auth,
    async (req, claims) => {
      const granted = typeof claims.scope === 'string' ? claims.scope.split(' ') : [];
      const principal = claims.sub
        ? await principalForUser(app, claims.sub, oauthScopesToScopes(granted), 'oauth')
        : null;
      if (!principal)
        return Response.json(
          { error: 'This account or token has no access to the status page.' },
          { status: 403 },
        );
      return serve(req, principal, req.headers.get('authorization')?.slice(7) ?? '', granted);
    },
    {
      resource: mcpResource(app.env.baseUrl),
      jwksUrl: `${app.env.internalUrl}/api/auth/jwks`,
      challengeScopes: ['status:read'],
      isScopeSatisfied: (s, g) => g.has(s) || OAUTH_SCOPES.some((x) => g.has(x)),
    },
  );

  return async (req) => {
    const authz = req.headers.get('authorization');
    if (authz?.startsWith('Bearer hl_')) {
      const token = authz.slice(7).trim();
      const owner = await app.tokens.verify(token);
      const principal = owner ? await principalForUser(app, owner.userId, owner.scopes, 'token') : null;
      if (!principal) return Response.json({ error: 'invalid or expired API token' }, { status: 401 });
      return serve(req, principal, token, owner?.scopes.map((s) => `status:${s}`) ?? []);
    }
    return oauth(req);
  };
}
