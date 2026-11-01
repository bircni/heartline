import { requireMcpAuth } from '@better-auth/mcp';
import { type AuthInfo, McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import {
  IMPACTS,
  INCIDENT_STATUSES,
  type Scope,
  incidentCreateSchema,
  incidentUpdateCreateSchema,
  maintenanceCreateSchema,
  monitorSpecSchema,
} from '@heartline/shared';
import { z } from 'zod';
import { type Principal, principalForUser } from '../auth/principal.ts';
import { mcpResource } from '../auth/auth.ts';
import { OAUTH_SCOPES, oauthScopesToScopes, scopeAtLeast } from '../auth/roles.ts';
import { runCheck } from '../checks/index.ts';
import type { AppContext } from '../context.ts';
import { log } from '../util/log.ts';

const VERSION = '0.1.0';

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
        'Read service availability, uptime reports and incidents of this self-hosted status page. Write tools (incidents, maintenance, monitors) need matching permissions.',
    },
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
        const services = o.groups.flatMap((g) =>
          g.services.map((s) => ({
            id: s.id,
            name: s.name,
            group: g.name,
            kind: s.kind,
            status: s.status,
            uptime: s.uptime,
          })),
        );
        const lines = services.map(
          (s) => `- ${s.name} [${s.id}] ${s.status}, ${fmtPct(s.uptime)} over ${days}d`,
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
        limit: z.number().int().min(1).max(100).default(20),
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
      guard('write', async () =>
        ok(
          await app.incidents.create(incidentCreateSchema.parse(input), `${principal.name} (MCP)`),
          'Incident created.',
        ),
      ),
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
      guard('write', async () =>
        ok(
          await app.incidents.addUpdate(
            id,
            incidentUpdateCreateSchema.parse(rest),
            `${principal.name} (MCP)`,
          ),
          'Update posted.',
        ),
      ),
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
      guard('write', async () =>
        ok(
          await app.maintenance.create(maintenanceCreateSchema.parse(input), `${principal.name} (MCP)`),
          'Maintenance scheduled.',
        ),
      ),
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
        return ok({ id, paused });
      }),
  );

  server.registerTool(
    'create_monitor',
    {
      title: 'Create monitor',
      description: 'Add a UI-managed monitor (http, tcp, dns, tls, icmp or plugin).',
      inputSchema: z.object({ group: z.string(), spec: z.record(z.string(), z.unknown()) }),
    },
    async ({ group, spec }) =>
      guard('admin', async () => {
        const parsed = monitorSpecSchema.parse(spec);
        if (parsed.type === 'plugin') {
          const plugin = app.plugins.get(parsed.plugin);
          if (!plugin) return fail(`plugin "${parsed.plugin}" is not installed`);
          app.plugins.resolveArgs(plugin, parsed.args);
        }
        const m = await app.monitors.create(parsed, group);
        return ok({ id: m.id, name: m.name, group: m.group }, 'Monitor created.');
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
