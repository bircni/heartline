import {
  IMPACTS,
  INCIDENT_STATUSES,
  MAX_RANGE_DAYS,
  MONITOR_KINDS,
  ROLES,
  SCOPES,
  THEMES,
  URGENCY_LEVELS,
  incidentCreateSchema,
  incidentPatchSchema,
  incidentUpdateCreateSchema,
  maintenanceCreateSchema,
  maintenanceUpdateSchema,
  monitorSpecSchema,
  tokenCreateSchema,
  userCreateSchema,
  userUpdateSchema,
} from '@heartline/shared';
import { z } from 'zod';
import { APP_VERSION } from '../util/pkg.ts';
import { monitorInputSchema } from './admin.ts';

type Schema = Record<string, unknown>;

const jsonSchema = (schema: z.ZodType): Schema => {
  const out = z.toJSONSchema(schema, {
    io: 'input',
    unrepresentable: 'any',
    target: 'draft-2020-12',
  }) as Schema;
  delete out.$schema;
  return out;
};

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const str = (extra: Schema = {}) => ({ type: 'string', ...extra });
const num = (extra: Schema = {}) => ({ type: 'number', ...extra });
const int = (extra: Schema = {}) => ({ type: 'integer', ...extra });
const bool = () => ({ type: 'boolean' });
const nullable = (s: Schema) => ({ ...s, nullable: true });
const arr = (items: Schema) => ({ type: 'array', items });
const obj = (properties: Record<string, Schema>, required?: string[]) => ({
  type: 'object',
  properties,
  ...(required ? { required } : { required: Object.keys(properties) }),
});
const en = (values: readonly string[]) => ({ type: 'string', enum: [...values] });
const ts = () => int({ description: 'Unix time in milliseconds' });

const SERVICE_STATUS = ['operational', 'degraded', 'down', 'maintenance', 'paused', 'unknown'] as const;
const DAY_STATE = ['operational', 'degraded', 'down', 'maintenance', 'nodata'] as const;
const CHECK_STATUS = ['up', 'degraded', 'down', 'maintenance', 'unknown'] as const;
const SEVERITIES = ['critical', 'high', 'medium', 'low', 'unknown'] as const;

const schemas: Record<string, Schema> = {
  Error: obj(
    {
      error: str(),
      issues: arr(
        obj({ path: str({ description: 'Dotted path of the field, e.g. spec.url' }), message: str() }),
      ),
    },
    ['error'],
  ),
  SiteInfo: obj({
    title: str(),
    description: nullable(str()),
    timezone: str(),
    logoUrl: nullable(str()),
    theme: en(THEMES),
  }),
  Bootstrap: obj({
    site: ref('SiteInfo'),
    public: bool(),
    showVersions: bool(),
    auth: obj({ local: bool(), oidc: arr(obj({ id: str(), name: str() })) }),
  }),
  Me: obj({ id: str(), name: str(), email: str(), role: en(ROLES), image: nullable(str()) }),
  AppVersion: obj({ name: str(), version: str(), node: str() }),
  DayBar: obj({
    day: str({ format: 'date' }),
    state: en(DAY_STATE),
    uptime: nullable(num()),
    avgLatencyMs: nullable(num()),
    p95LatencyMs: nullable(num()),
    checks: int(),
  }),
  ServiceRef: obj({ id: str(), name: str() }),
  SoftwareSummary: obj({
    product: str({ description: 'Catalog slug' }),
    productName: str(),
    version: nullable(str()),
    latest: nullable(str()),
    latestUrl: nullable(str({ description: 'Release page of the latest version' })),
    latestPublishedAt: nullable(ts()),
    latestInCycle: nullable(str()),
    pinnedCycle: nullable(str()),
    cycle: nullable(str()),
    eol: nullable(str({ format: 'date' })),
    eolReached: bool(),
    versionSeenAt: nullable(ts()),
    urgency: nullable(en(URGENCY_LEVELS)),
    score: nullable(int({ minimum: 0, maximum: 100 })),
    vulns: nullable(obj(Object.fromEntries(SEVERITIES.map((s) => [s, int()])))),
  }),
  ServiceSummary: obj({
    id: str(),
    name: str(),
    group: str(),
    kind: en(MONITOR_KINDS),
    external: bool(),
    status: en(SERVICE_STATUS),
    upstream: arr(obj({ id: str(), name: str(), status: en(SERVICE_STATUS) })),
    uptime: nullable(num()),
    bars: arr(ref('DayBar')),
    software: nullable(ref('SoftwareSummary')),
  }),
  IncidentUpdate: obj({
    id: str(),
    status: en(INCIDENT_STATUSES),
    message: str(),
    createdAt: ts(),
    author: nullable(str()),
  }),
  Incident: obj({
    id: str(),
    title: str(),
    status: en(INCIDENT_STATUSES),
    impact: en(IMPACTS),
    services: arr(ref('ServiceRef')),
    createdAt: ts(),
    resolvedAt: nullable(ts()),
    automatic: bool(),
    updates: arr(ref('IncidentUpdate')),
  }),
  Maintenance: obj({
    id: str(),
    title: str(),
    description: nullable(str()),
    startsAt: ts(),
    endsAt: ts(),
    recurrence: nullable(str({ description: 'RFC 5545 RRULE' })),
    nextStartsAt: nullable(ts()),
    nextEndsAt: nullable(ts()),
    active: bool(),
    services: arr(ref('ServiceRef')),
  }),
  Overview: obj({
    site: ref('SiteInfo'),
    status: en(SERVICE_STATUS),
    headline: str(),
    summary: str(),
    operational: int(),
    total: int(),
    days: int(),
    groups: arr(obj({ name: str(), services: arr(ref('ServiceSummary')) })),
    external: arr(obj({ name: str(), services: arr(ref('ServiceSummary')) })),
    activeIncidents: arr(ref('Incident')),
    upcomingMaintenance: arr(ref('Maintenance')),
    security: nullable(obj({ critical: int(), high: int() })),
    generatedAt: ts(),
  }),
  CheckResult: obj({
    at: ts(),
    status: en(CHECK_STATUS),
    latencyMs: nullable(num()),
    message: nullable(str()),
  }),
  LatencyPoint: obj({
    at: ts(),
    avgLatencyMs: nullable(num()),
    highLatencyMs: nullable(num()),
    state: nullable(en(DAY_STATE)),
    checks: nullable(int()),
    down: nullable(int()),
  }),
  ServiceDetail: {
    allOf: [
      ref('ServiceSummary'),
      obj({
        description: nullable(str()),
        target: str(),
        intervalMs: int(),
        lastCheckedAt: nullable(ts()),
        days: int(),
        kpis: obj({
          uptime: nullable(num()),
          avgLatencyMs: nullable(num()),
          p95LatencyMs: nullable(num()),
          incidents: int(),
        }),
        checks: arr(ref('CheckResult')),
        incidents: arr(ref('Incident')),
        series: arr(ref('LatencyPoint')),
        seriesBucketMs: int(),
        rangeStart: ts(),
        rangeEnd: ts(),
        generatedAt: ts(),
      }),
    ],
  },
  Vulnerability: obj({
    id: str({ description: 'CVE id when known, otherwise the OSV id' }),
    aliases: arr(str()),
    summary: nullable(str()),
    score: nullable(num({ description: 'CVSS base score' })),
    severity: en(SEVERITIES),
    vector: nullable(str()),
    kev: bool(),
    fixedIn: nullable(str()),
    introduced: nullable(str()),
    publishedAt: nullable(ts()),
    sources: arr(en(['osv', 'nvd'])),
    urls: obj({ osv: nullable(str()), nvd: nullable(str()) }),
    references: arr(str()),
  }),
  SoftwareDetail: {
    allOf: [
      ref('SoftwareSummary'),
      obj({
        serviceId: str(),
        serviceName: str(),
        group: str(),
        track: bool(),
        releasesUrl: nullable(str()),
        versionSource: nullable(en(['check', 'probe', 'plugin', 'static'])),
        previousVersion: nullable(str()),
        versionChangedAt: nullable(ts()),
        probeError: nullable(str()),
        intelRefreshedAt: nullable(ts()),
        intelError: nullable(str()),
        reasons: arr(str()),
        vulnerabilities: arr(ref('Vulnerability')),
      }),
    ],
  },
  SoftwareInventory: obj({
    generatedAt: ts(),
    lastRefreshAt: nullable(ts()),
    services: arr(ref('SoftwareDetail')),
    totals: obj(Object.fromEntries(URGENCY_LEVELS.map((l) => [l, int()]))),
  }),
  CatalogEntry: obj({
    slug: str(),
    name: str(),
    endoflife: nullable(str()),
    cpe: nullable(str()),
    osv: nullable(obj({ ecosystem: str(), name: str() })),
    probe: nullable(
      obj(
        {
          path: str(),
          json: str(),
          header: str(),
          regex: str(),
          auth: en(['none', 'bearer', 'api-key']),
          note: str(),
        },
        ['path', 'auth'],
      ),
    ),
    github: nullable(str()),
    releasesUrl: nullable(str()),
  }),
  MonitorSpec: jsonSchema(monitorSpecSchema),
  MonitorInput: jsonSchema(monitorInputSchema),
  AdminMonitor: obj({
    id: str(),
    name: str(),
    group: str(),
    kind: en(MONITOR_KINDS),
    source: en(['config', 'db']),
    paused: bool(),
    status: en(SERVICE_STATUS),
    target: str(),
    lastCheckedAt: nullable(ts()),
    lastMessage: nullable(str()),
    spec: ref('MonitorSpec'),
  }),
  CheckOutcome: obj({
    status: nullable(en(CHECK_STATUS)),
    latencyMs: nullable(num()),
    message: nullable(str()),
  }),
  Plugin: obj({
    name: str(),
    description: nullable(str()),
    args: {
      type: 'object',
      additionalProperties: obj({ type: str(), required: bool(), description: nullable(str()) }),
    },
  }),
  Notifier: obj({
    id: str(),
    type: en(['teams', 'email', 'webhook']),
    target: str(),
    lastSentAt: nullable(ts()),
    lastError: nullable(str()),
  }),
  ApiToken: obj({
    id: str(),
    name: str(),
    prefix: str(),
    scopes: arr(en(SCOPES)),
    createdAt: ts(),
    lastUsedAt: nullable(ts()),
    expiresAt: nullable(ts()),
    owner: str(),
  }),
  CreatedApiToken: { allOf: [ref('ApiToken'), obj({ token: str({ description: 'Shown once' }) })] },
  User: obj({
    id: str(),
    name: str(),
    email: str(),
    role: en(ROLES),
    providers: arr(str()),
    createdAt: ts(),
  }),
  IncidentCreate: jsonSchema(incidentCreateSchema),
  IncidentPatch: jsonSchema(incidentPatchSchema),
  IncidentUpdateCreate: jsonSchema(incidentUpdateCreateSchema),
  MaintenanceCreate: jsonSchema(maintenanceCreateSchema),
  MaintenanceUpdate: jsonSchema(maintenanceUpdateSchema),
  TokenCreate: jsonSchema(tokenCreateSchema),
  UserCreate: jsonSchema(userCreateSchema),
  UserUpdate: jsonSchema(userUpdateSchema),
  PluginTest: obj({ plugin: str(), args: { type: 'object', additionalProperties: {} } }, ['plugin']),
  Pause: obj({ paused: bool() }),
};

const json = (schema: Schema, description = 'OK') => ({
  description,
  content: { 'application/json': { schema } },
});
const body = (schema: Schema) => ({ required: true, content: { 'application/json': { schema } } });
const pathId = (name = 'id', description = 'Service id') => ({
  name,
  in: 'path',
  required: true,
  schema: str(),
  description,
});
const days = (fallback: number) => ({
  name: 'days',
  in: 'query',
  schema: int({ minimum: 1, maximum: MAX_RANGE_DAYS, default: fallback }),
});
const to = {
  name: 'to',
  in: 'query',
  schema: str({ format: 'date' }),
  description: 'Last day of the range (YYYY-MM-DD, site time zone); defaults to today',
};
const E401 = {
  description: 'Sign in or provide an API token',
  content: { 'application/json': { schema: ref('Error') } },
};
const E403 = {
  description: 'Insufficient permission',
  content: { 'application/json': { schema: ref('Error') } },
};
const E404 = { description: 'Not found', content: { 'application/json': { schema: ref('Error') } } };
const E400 = { description: 'Validation error', content: { 'application/json': { schema: ref('Error') } } };
const E204 = { description: 'Deleted' };

type Op = {
  summary: string;
  description?: string;
  tags: string[];
  parameters?: unknown[];
  requestBody?: unknown;
  responses: Record<string, unknown>;
  security?: unknown[];
};
const scope = (s: 'read' | 'write' | 'admin'): Pick<Op, 'security'> => ({
  security: [{ cookieAuth: [] }, { bearerToken: [s] }],
});
const pub: Pick<Op, 'security' | 'description'> = {
  security: [{}, { cookieAuth: [] }, { bearerToken: ['read'] }],
  description: 'Public when `site.public` is true, otherwise needs read access.',
};

const paths: Record<string, Record<string, Op>> = {
  '/healthz': {
    get: {
      summary: 'Liveness',
      tags: ['Health'],
      responses: { 200: json(obj({ ok: bool() })) },
      security: [{}],
    },
  },
  '/readyz': {
    get: {
      summary: 'Readiness (database reachable)',
      tags: ['Health'],
      responses: { 200: json(obj({ ok: bool(), leader: bool() })), 503: json(obj({ ok: bool() })) },
      security: [{}],
    },
  },
  '/api/v1/site': {
    get: {
      summary: 'Site info and sign-in providers',
      tags: ['Public'],
      responses: { 200: json(ref('Bootstrap')) },
      security: [{}],
    },
  },
  '/api/v1/version': {
    get: {
      summary: 'heartline version',
      tags: ['Public'],
      responses: { 200: json(ref('AppVersion')) },
      security: [{}],
    },
  },
  '/api/v1/me': {
    get: {
      summary: 'The signed-in user',
      tags: ['Public'],
      responses: { 200: json(ref('Me')), 204: { description: 'Not signed in' } },
      security: [{}, { cookieAuth: [] }, { bearerToken: ['read'] }],
    },
  },
  '/api/v1/overview': {
    get: {
      ...pub,
      summary: 'Overview with day bars per service',
      tags: ['Public'],
      parameters: [days(90), to],
      responses: { 200: json(ref('Overview')), 400: E400, 401: E401 },
    },
  },
  '/api/v1/services/{id}': {
    get: {
      ...pub,
      summary: 'Service detail',
      tags: ['Public'],
      parameters: [pathId(), days(30), to],
      responses: { 200: json(ref('ServiceDetail')), 400: E400, 404: E404 },
    },
  },
  '/api/v1/services/{id}/report.csv': {
    get: {
      ...pub,
      summary: 'Daily uptime report of one service (CSV)',
      tags: ['Public'],
      parameters: [pathId(), days(90), to],
      responses: { 200: { description: 'CSV', content: { 'text/csv': { schema: str() } } } },
    },
  },
  '/api/v1/report.csv': {
    get: {
      ...pub,
      summary: 'Daily uptime report of all services (CSV)',
      tags: ['Public'],
      parameters: [days(90), to],
      responses: { 200: { description: 'CSV', content: { 'text/csv': { schema: str() } } } },
    },
  },
  '/api/v1/incidents': {
    get: {
      ...pub,
      summary: 'Incidents, newest first',
      tags: ['Public'],
      parameters: [
        { name: 'active', in: 'query', schema: bool() },
        { name: 'limit', in: 'query', schema: int({ minimum: 1, maximum: 200, default: 50 }) },
      ],
      responses: { 200: json(arr(ref('Incident'))) },
    },
  },
  '/api/v1/incidents/{id}': {
    get: {
      ...pub,
      summary: 'One incident',
      tags: ['Public'],
      parameters: [pathId('id', 'Incident id')],
      responses: { 200: json(ref('Incident')), 404: E404 },
    },
  },
  '/api/v1/incidents.rss': {
    get: {
      ...pub,
      summary: 'Incident feed (RSS 2.0)',
      tags: ['Public'],
      responses: { 200: { description: 'RSS', content: { 'application/rss+xml': { schema: str() } } } },
    },
  },
  '/api/v1/maintenance': {
    get: {
      ...pub,
      summary: 'Maintenance windows',
      tags: ['Public'],
      responses: { 200: json(arr(ref('Maintenance'))) },
    },
  },
  '/api/v1/maintenance/{id}': {
    get: {
      ...pub,
      summary: 'One maintenance window',
      tags: ['Public'],
      parameters: [pathId('id', 'Maintenance id')],
      responses: { 200: json(ref('Maintenance')), 404: E404 },
    },
  },
  '/api/v1/badge/{id}.svg': {
    get: {
      ...pub,
      summary: 'Uptime badge (SVG); `kind=version` shows the running version',
      tags: ['Public'],
      parameters: [pathId(), days(30), { name: 'kind', in: 'query', schema: en(['uptime', 'version']) }],
      responses: {
        200: { description: 'SVG', content: { 'image/svg+xml': { schema: str() } } },
        404: { description: 'Unknown service (also an SVG)' },
      },
    },
  },
  '/api/v1/software': {
    get: {
      summary: 'Software inventory: versions, latest releases, end-of-life, update urgency',
      description:
        'Needs read access. Anonymous visitors get version and release information only when `site.showVersions` is on; urgency and vulnerabilities are never public.',
      tags: ['Software'],
      responses: { 200: json(ref('SoftwareInventory')), 401: E401 },
      security: [{}, { cookieAuth: [] }, { bearerToken: ['read'] }],
    },
  },
  '/api/v1/software/report.csv': {
    get: {
      ...scope('read'),
      summary: 'Software inventory (CSV)',
      tags: ['Software'],
      responses: { 200: { description: 'CSV', content: { 'text/csv': { schema: str() } } }, 401: E401 },
    },
  },
  '/api/v1/services/{id}/software': {
    get: {
      summary: 'Version, release and vulnerability details of one service',
      tags: ['Software'],
      parameters: [pathId()],
      responses: { 200: json(ref('SoftwareDetail')), 401: E401, 404: E404 },
      security: [{}, { cookieAuth: [] }, { bearerToken: ['read'] }],
    },
  },
  '/api/v1/admin/software/catalog': {
    get: {
      ...scope('read'),
      summary: 'Built-in product catalog (probes, CPE, OSV packages)',
      tags: ['Software'],
      responses: { 200: json(arr(ref('CatalogEntry'))) },
    },
  },
  '/api/v1/admin/software/refresh': {
    post: {
      ...scope('write'),
      summary: 'Refresh intel for all tracked services (background)',
      tags: ['Software'],
      responses: { 202: json(obj({ queued: bool() })) },
    },
  },
  '/api/v1/admin/monitors/{id}/software/refresh': {
    post: {
      ...scope('write'),
      summary: 'Re-probe the version and refresh intel of one service',
      tags: ['Software'],
      parameters: [pathId()],
      responses: { 200: json(ref('SoftwareDetail')), 400: E400, 404: E404 },
    },
  },
  '/api/v1/admin/monitors': {
    get: {
      ...scope('read'),
      summary: 'Monitors with admin details',
      tags: ['Monitors'],
      responses: { 200: json(arr(ref('AdminMonitor'))) },
    },
    post: {
      ...scope('admin'),
      summary: 'Create a UI-managed monitor',
      tags: ['Monitors'],
      requestBody: body(ref('MonitorInput')),
      responses: { 201: json(ref('AdminMonitor')), 400: E400, 409: { description: 'Id already exists' } },
    },
  },
  '/api/v1/admin/monitors/{id}': {
    get: {
      ...scope('read'),
      summary: 'One monitor',
      tags: ['Monitors'],
      parameters: [pathId()],
      responses: { 200: json(ref('AdminMonitor')), 404: E404 },
    },
    put: {
      ...scope('admin'),
      summary: 'Replace a UI-managed monitor',
      tags: ['Monitors'],
      parameters: [pathId()],
      requestBody: body(ref('MonitorInput')),
      responses: {
        200: json(ref('AdminMonitor')),
        400: E400,
        409: { description: 'Managed in status.yaml' },
      },
    },
    delete: {
      ...scope('admin'),
      summary: 'Delete a UI-managed monitor and its history',
      tags: ['Monitors'],
      parameters: [pathId()],
      responses: { 204: E204, 409: { description: 'Managed in status.yaml' } },
    },
  },
  '/api/v1/admin/monitors/{id}/run': {
    post: {
      ...scope('write'),
      summary: 'Run the check now',
      tags: ['Monitors'],
      parameters: [pathId()],
      responses: { 200: json(ref('CheckOutcome')) },
    },
  },
  '/api/v1/admin/monitors/{id}/pause': {
    post: {
      ...scope('write'),
      summary: 'Pause or resume',
      tags: ['Monitors'],
      parameters: [pathId()],
      requestBody: body(ref('Pause')),
      responses: { 200: json(ref('AdminMonitor')) },
    },
  },
  '/api/v1/admin/plugins': {
    get: {
      ...scope('read'),
      summary: 'Installed check plugins',
      tags: ['Monitors'],
      responses: { 200: json(arr(ref('Plugin'))) },
    },
  },
  '/api/v1/admin/plugins/test': {
    post: {
      ...scope('admin'),
      summary: 'Run a plugin once without recording',
      tags: ['Monitors'],
      requestBody: body(ref('PluginTest')),
      responses: { 200: json(ref('CheckOutcome')) },
    },
  },
  '/api/v1/admin/incidents': {
    post: {
      ...scope('write'),
      summary: 'Open an incident',
      tags: ['Incidents'],
      requestBody: body(ref('IncidentCreate')),
      responses: { 201: json(ref('Incident')), 400: E400 },
    },
  },
  '/api/v1/admin/incidents/{id}': {
    patch: {
      ...scope('write'),
      summary: 'Edit title, impact or services',
      tags: ['Incidents'],
      parameters: [pathId('id', 'Incident id')],
      requestBody: body(ref('IncidentPatch')),
      responses: { 200: json(ref('Incident')), 404: E404 },
    },
    delete: {
      ...scope('admin'),
      summary: 'Delete an incident',
      tags: ['Incidents'],
      parameters: [pathId('id', 'Incident id')],
      responses: { 204: E204, 404: E404 },
    },
  },
  '/api/v1/admin/incidents/{id}/updates': {
    post: {
      ...scope('write'),
      summary: 'Post an update (status "resolved" closes it)',
      tags: ['Incidents'],
      parameters: [pathId('id', 'Incident id')],
      requestBody: body(ref('IncidentUpdateCreate')),
      responses: { 200: json(ref('Incident')), 404: E404 },
    },
  },
  '/api/v1/admin/maintenance': {
    post: {
      ...scope('write'),
      summary: 'Schedule maintenance',
      tags: ['Maintenance'],
      requestBody: body(ref('MaintenanceCreate')),
      responses: { 201: json(ref('Maintenance')), 400: E400 },
    },
  },
  '/api/v1/admin/maintenance/{id}': {
    put: {
      ...scope('write'),
      summary: 'Edit a maintenance window',
      tags: ['Maintenance'],
      parameters: [pathId('id', 'Maintenance id')],
      requestBody: body(ref('MaintenanceUpdate')),
      responses: { 200: json(ref('Maintenance')), 400: E400, 404: E404 },
    },
    delete: {
      ...scope('write'),
      summary: 'Cancel a maintenance window',
      tags: ['Maintenance'],
      parameters: [pathId('id', 'Maintenance id')],
      responses: { 204: E204, 404: E404 },
    },
  },
  '/api/v1/admin/notifiers': {
    get: {
      ...scope('read'),
      summary: 'Notification channels',
      tags: ['Notifiers'],
      responses: { 200: json(arr(ref('Notifier'))) },
    },
  },
  '/api/v1/admin/notifiers/{id}/test': {
    post: {
      ...scope('admin'),
      summary: 'Send a test message',
      tags: ['Notifiers'],
      parameters: [pathId('id', 'Notifier id')],
      responses: { 200: json(obj({ ok: bool(), error: nullable(str()) })) },
    },
  },
  '/api/v1/admin/tokens': {
    get: {
      ...scope('read'),
      summary: 'Your API tokens (`all=true` lists everyone’s, admin only)',
      tags: ['Tokens'],
      parameters: [{ name: 'all', in: 'query', schema: bool() }],
      responses: { 200: json(arr(ref('ApiToken'))), 403: E403 },
    },
    post: {
      ...scope('read'),
      summary: 'Create an API token (not with a token)',
      tags: ['Tokens'],
      requestBody: body(ref('TokenCreate')),
      responses: { 201: json(ref('CreatedApiToken')), 403: E403 },
    },
  },
  '/api/v1/admin/tokens/{id}': {
    delete: {
      ...scope('read'),
      summary: 'Revoke a token',
      tags: ['Tokens'],
      parameters: [pathId('id', 'Token id')],
      responses: { 204: E204, 404: E404 },
    },
  },
  '/api/v1/admin/users': {
    get: { ...scope('admin'), summary: 'Users', tags: ['Users'], responses: { 200: json(arr(ref('User'))) } },
    post: {
      ...scope('admin'),
      summary: 'Create a local user',
      tags: ['Users'],
      requestBody: body(ref('UserCreate')),
      responses: { 201: json(ref('User')), 400: E400 },
    },
  },
  '/api/v1/admin/users/{id}': {
    patch: {
      ...scope('admin'),
      summary: 'Change a role',
      tags: ['Users'],
      parameters: [pathId('id', 'User id')],
      requestBody: body(ref('UserUpdate')),
      responses: { 200: json(ref('User')), 404: E404 },
    },
    delete: {
      ...scope('admin'),
      summary: 'Delete a user',
      tags: ['Users'],
      parameters: [pathId('id', 'User id')],
      responses: { 204: E204 },
    },
  },
  '/api/v1/openapi.json': {
    get: {
      summary: 'This document',
      tags: ['Public'],
      responses: { 200: json({ type: 'object' }) },
      security: [{}],
    },
  },
};

/** OpenAPI 3.1 description of the HTTP API. MCP (`/mcp`) and better-auth (`/api/auth/*`) are out of scope. */
export function openApiDocument(baseUrl: string): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'heartline API',
      version: APP_VERSION,
      description:
        'Self-hosted status page API. Timestamps are Unix milliseconds. Admin routes accept the browser session or `Authorization: Bearer hl_…` API tokens whose scopes are read ⊂ write ⊂ admin, capped by the owner’s role.',
      license: { name: 'MIT' },
    },
    servers: [{ url: baseUrl }],
    tags: [
      { name: 'Public', description: 'Status page data' },
      { name: 'Software', description: 'Running versions, known vulnerabilities and update urgency' },
      { name: 'Monitors' },
      { name: 'Incidents' },
      { name: 'Maintenance' },
      { name: 'Notifiers' },
      { name: 'Tokens' },
      { name: 'Users' },
      { name: 'Health' },
    ],
    paths,
    components: {
      securitySchemes: {
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'better-auth.session_token',
          description: 'Browser session',
        },
        bearerToken: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'hl_…',
          description: 'API token from the admin area; the scopes listed per operation are the minimum.',
        },
      },
      schemas,
    },
  };
}

/** Minimal self-contained reference page (the CSP forbids external scripts). */
export function docsHtml(doc: Record<string, unknown>): string {
  const esc = (s: string) =>
    s.replace(/[<>&"]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[ch] as string);
  const info = doc.info as { title: string; version: string; description: string };
  const rows = Object.entries(doc.paths as Record<string, Record<string, Op>>)
    .flatMap(([path, ops]) =>
      Object.entries(ops).map(([method, op]) => {
        const scopes = (op.security ?? [])
          .flatMap((s) => Object.entries(s as Record<string, string[]>))
          .filter(([k]) => k === 'bearerToken')
          .flatMap(([, v]) => v);
        const access = (op.security ?? []).some((s) => Object.keys(s as object).length === 0)
          ? 'public'
          : (scopes[0] ?? 'session');
        return `<tr><td class="m ${method}">${method.toUpperCase()}</td><td><code>${esc(path)}</code></td><td>${esc(op.summary)}</td><td>${esc(access)}</td><td>${op.tags.map(esc).join(', ')}</td></tr>`;
      }),
    )
    .join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(info.title)}</title>
<style>body{font:14px/1.5 system-ui,sans-serif;margin:0 auto;max-width:1100px;padding:24px;color:#1f2328;background:#fff}@media(prefers-color-scheme:dark){body{color:#e6edf3;background:#0d1117}a{color:#8fb7ff}th,td{border-color:#30363d!important}}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #d0d7de;vertical-align:top}code{font-size:13px}.m{font-weight:700;width:60px}.get{color:#1a7f37}.post{color:#0969da}.put,.patch{color:#9a6700}.delete{color:#cf222e}p{max-width:80ch}</style></head>
<body><h1>${esc(info.title)} <small>v${esc(info.version)}</small></h1><p>${esc(info.description)}</p>
<p>Machine-readable: <a href="/api/v1/openapi.json">/api/v1/openapi.json</a> (OpenAPI 3.1). Model Context Protocol: <code>/mcp</code>.</p>
<table><thead><tr><th>Method</th><th>Path</th><th>Summary</th><th>Access</th><th>Tag</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
}
