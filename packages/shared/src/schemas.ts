import { z } from 'zod';
import { parseDuration } from './duration.ts';
import { findProvider } from './providers.ts';

export const duration = z.union([z.string(), z.number().int().nonnegative()]).transform((value, ctx) => {
  try {
    return parseDuration(value);
  } catch (error) {
    ctx.addIssue({ code: 'custom', message: (error as Error).message });
    return z.NEVER;
  }
});

export const ROLES = ['admin', 'editor', 'viewer'] as const;
export const roleSchema = z.enum(ROLES);

export const SCOPES = ['read', 'write', 'admin'] as const;
export const scopeSchema = z.enum(SCOPES);

export const URGENCY_LEVELS = ['critical', 'high', 'medium', 'low', 'none', 'unknown'] as const;
export const urgencyLevelSchema = z.enum(URGENCY_LEVELS);

/** Where the running version of a service comes from. */
export const softwareVersionSchema = z
  .object({
    /** Endpoint to probe. Defaults to the catalog probe relative to the monitor URL (http monitors). */
    url: z.url().optional(),
    method: z.enum(['GET', 'HEAD', 'POST']).default('GET'),
    headers: z.record(z.string(), z.string()).default({}),
    /** Dot path into a JSON body; an empty string means the root value. */
    json: z.string().optional(),
    /** Response header holding the version (case-insensitive). */
    header: z.string().optional(),
    /** Applied to the body, or to the json/header value when one is set; groups are joined with dots. */
    regex: z.string().optional(),
    /** Fixed version for services that cannot be probed. */
    static: z.string().min(1).max(100).optional(),
    /** How often to probe (separate probes only). */
    interval: duration.default(3_600_000),
    ignoreTls: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (v.regex !== undefined) {
      try {
        RegExp(v.regex);
      } catch {
        ctx.addIssue({ code: 'custom', message: 'invalid regular expression', path: ['regex'] });
      }
    }
    if (v.static !== undefined && (v.url || v.json !== undefined || v.header || v.regex))
      ctx.addIssue({ code: 'custom', message: 'static cannot be combined with a probe', path: ['static'] });
  });

const repoSlug = z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'expected owner/repo');

/** Where the latest release of a product is published. */
export const softwareReleasesSchema = z
  .object({
    /** Base URL of a Gitea or Forgejo instance; `repo` names the repository. */
    gitea: z.url().optional(),
    repo: repoSlug.optional(),
    /** GitHub repository as `owner/repo`. */
    github: repoSlug.optional(),
    /** Any endpoint returning the latest version: read through `json` or `regex`. */
    url: z.url().optional(),
    json: z.string().optional(),
    regex: z.string().optional(),
    headers: z.record(z.string(), z.string()).default({}),
    /** Count pre-releases as releases. */
    prerelease: z.boolean().default(false),
  })
  .superRefine((r, ctx) => {
    const kinds = [r.gitea, r.github, r.url].filter((x) => x !== undefined).length;
    if (kinds !== 1) ctx.addIssue({ code: 'custom', message: 'set exactly one of gitea, github or url' });
    if (r.gitea && !r.repo)
      ctx.addIssue({ code: 'custom', message: 'gitea needs repo (owner/name)', path: ['repo'] });
    if (r.url && r.json === undefined && !r.regex)
      ctx.addIssue({ code: 'custom', message: 'url needs json or regex', path: ['url'] });
    if (r.regex !== undefined) {
      try {
        RegExp(r.regex);
      } catch {
        ctx.addIssue({ code: 'custom', message: 'invalid regular expression', path: ['regex'] });
      }
    }
  });

export const softwareSchema = z.object({
  /** Catalog slug (also the endoflife.date product), e.g. `gitea`. Unknown slugs are allowed. */
  product: z.string().regex(/^[a-z0-9][a-z0-9.-]{0,62}$/, 'lowercase slug'),
  /** Display name for products that are not in the catalog. */
  name: z.string().min(1).max(80).optional(),
  version: softwareVersionSchema.optional(),
  /** Latest-release source; overrides endoflife.date and the catalog. */
  releases: softwareReleasesSchema.optional(),
  /** Stay on this release cycle (e.g. `1.24`): newer cycles do not count as updates. */
  pinCycle: z
    .string()
    .regex(/^\d+(\.\d+)*$/, 'e.g. 1.24')
    .optional(),
  /** `cpe:2.3:a:vendor:product` prefix for NVD lookups; overrides the catalog. */
  cpe: z
    .string()
    .regex(/^cpe:2\.3:[aho]:[^:\s]+:[^:\s]+$/, 'expected cpe:2.3:a:vendor:product')
    .optional(),
  /** OSV package for vulnerability lookups; overrides the catalog. */
  osv: z.object({ ecosystem: z.string().min(1), name: z.string().min(1) }).optional(),
  /** When false only the version and release information are tracked, no vulnerabilities. */
  track: z.boolean().default(true),
});
export type SoftwareConfig = z.output<typeof softwareSchema>;

const base = {
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/, 'lowercase letters, digits, - and _ only'),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  interval: duration.default(60_000),
  timeout: duration.default(10_000),
  /** Consecutive failed checks before the service is reported degraded or down. */
  failureThreshold: z.number().int().min(1).max(20).default(2),
  notify: z.array(z.string()).default([]),
  /** Open an incident automatically when the service goes down. */
  autoIncident: z.boolean().default(false),
  /** Track the running version and its known vulnerabilities. */
  software: softwareSchema.optional(),
  /** Services this one relies on (e.g. a provider monitor); their outages are shown as a likely cause. */
  dependsOn: z.array(z.string().min(1)).default([]),
};

export const httpMonitorSchema = z.object({
  ...base,
  type: z.literal('http'),
  url: z.url(),
  method: z.enum(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']).default('GET'),
  headers: z.record(z.string(), z.string()).default({}),
  body: z.string().optional(),
  followRedirects: z.boolean().default(true),
  ignoreTls: z.boolean().default(false),
  expect: z
    .object({
      status: z.array(z.number().int().min(100).max(599)).optional(),
      bodyContains: z.string().optional(),
      bodyRegex: z.string().optional(),
      /** `path.to.field` → expected value, compared as strings. */
      json: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    })
    .default({}),
  /** Responses slower than this mark the service degraded. */
  degradedAfter: duration.optional(),
});

export const tcpMonitorSchema = z.object({
  ...base,
  type: z.literal('tcp'),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  degradedAfter: duration.optional(),
});

export const dnsMonitorSchema = z.object({
  ...base,
  type: z.literal('dns'),
  host: z.string().min(1),
  record: z.enum(['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV']).default('A'),
  server: z.string().optional(),
  expect: z.array(z.string()).optional(),
  degradedAfter: duration.optional(),
});

export const tlsMonitorSchema = z.object({
  ...base,
  type: z.literal('tls'),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535).default(443),
  servername: z.string().optional(),
  /** Certificates expiring within this many days mark the service degraded. */
  minDays: z.number().int().min(0).default(14),
});

export const icmpMonitorSchema = z.object({
  ...base,
  type: z.literal('icmp'),
  host: z.string().min(1),
  degradedAfter: duration.optional(),
});

export const pluginMonitorSchema = z.object({
  ...base,
  type: z.literal('plugin'),
  plugin: z.string().min(1),
  args: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
});

/**
 * The service reports in instead of being checked: a cron job pinging after each run (heartbeat), or an
 * alerting tool sending its state (webhook, `heartbeat: false`).
 */
export const pushMonitorSchema = z.object({
  ...base,
  type: z.literal('push'),
  /** How often a heartbeat is expected. */
  interval: duration.default(300_000),
  /** Extra time after `interval` before a missing heartbeat counts as down. */
  grace: duration.default(60_000),
  /** false: no heartbeat is expected; the last pushed status stays until the next push. */
  heartbeat: z.boolean().default(true),
  failureThreshold: z.number().int().min(1).max(20).default(1),
  /** Fixed secret for the push URL (24+ characters), for monitors defined in status.yaml. */
  token: z.string().min(24).max(200).optional(),
});

/** Status of a third-party service, read from its public status page or API. */
export const providerMonitorSchema = z.object({
  ...base,
  // Providers aggregate their own status, so poll less often and trust a single answer.
  interval: duration.default(300_000),
  failureThreshold: z.number().int().min(1).max(20).default(1),
  type: z.literal('provider'),
  /** Preset slug such as `github` or `atlassian-jira`, or a generic kind: `statuspage`, `feed`. */
  provider: z.string().min(1),
  /** Status page (statuspage) or feed URL (feed); overrides the preset URL. */
  url: z.url().optional(),
  /** Only these components, products or services count (case-insensitive names). Empty means all. */
  components: z.array(z.string().min(1)).default([]),
  /** Feeds only: entries newer than this count as open issues. Defaults to every entry for Azure, 6h otherwise. */
  window: duration.optional(),
  /** Microsoft 365 service health of your tenant (app registration with ServiceHealth.Read.All). */
  m365: z
    .object({
      tenantId: z.string().min(1),
      clientId: z.string().min(1),
      clientSecret: z.string().min(1),
    })
    .optional(),
});

export const monitorSpecSchema = z
  .discriminatedUnion('type', [
    httpMonitorSchema,
    tcpMonitorSchema,
    dnsMonitorSchema,
    tlsMonitorSchema,
    icmpMonitorSchema,
    pluginMonitorSchema,
    providerMonitorSchema,
    pushMonitorSchema,
  ])
  .superRefine((m, ctx) => {
    if (m.dependsOn.includes(m.id))
      ctx.addIssue({ code: 'custom', message: 'a service cannot depend on itself', path: ['dependsOn'] });
    if (m.type === 'provider') {
      const preset = findProvider(m.provider);
      if (!preset) {
        ctx.addIssue({ code: 'custom', message: `unknown provider "${m.provider}"`, path: ['provider'] });
      } else if (preset.kind === 'm365' && !m.m365) {
        ctx.addIssue({
          code: 'custom',
          message: 'm365 needs tenantId, clientId and clientSecret',
          path: ['m365'],
        });
      } else if (preset.url === null && preset.kind !== 'm365' && !m.url) {
        ctx.addIssue({ code: 'custom', message: `${m.provider} needs a url`, path: ['url'] });
      }
      if (m.software)
        ctx.addIssue({
          code: 'custom',
          message: 'provider monitors cannot track software',
          path: ['software'],
        });
      return;
    }
    // Without an HTTP response (or a plugin result) there is nothing to read a version from.
    const probe = m.software?.version;
    // Push monitors can send their version with each push.
    if (
      m.software &&
      m.type !== 'http' &&
      m.type !== 'plugin' &&
      m.type !== 'push' &&
      !probe?.url &&
      !probe?.static
    ) {
      ctx.addIssue({
        code: 'custom',
        message: `${m.type} monitors need software.version.url or software.version.static`,
        path: ['software', 'version'],
      });
    }
  });
export type MonitorSpec = z.output<typeof monitorSpecSchema>;
export type MonitorSpecInput = z.input<typeof monitorSpecSchema>;
export type MonitorKind = MonitorSpec['type'];
export const MONITOR_KINDS = [
  'http',
  'tcp',
  'dns',
  'tls',
  'icmp',
  'plugin',
  'provider',
  'push',
] as const satisfies MonitorKind[];

export const INCIDENT_STATUSES = ['investigating', 'identified', 'monitoring', 'resolved'] as const;
export const incidentStatusSchema = z.enum(INCIDENT_STATUSES);
/** Colour themes of the web UI; status colours are the same in every theme. */
export const THEMES = ['green', 'blue', 'violet', 'amber', 'rose'] as const;

/** How bad an incident is: `none` informs without changing any status. */
export const IMPACTS = ['none', 'degraded', 'partial', 'major'] as const;
export const impactSchema = z.enum(IMPACTS);

/** What an incident says about one affected service. */
export const COMPONENT_STATUSES = ['operational', 'degraded', 'partial', 'down'] as const;
export const componentStatusSchema = z.enum(COMPONENT_STATUSES);

/**
 * An affected service: its id, optionally with the status the incident gives it. A bare id takes its status
 * from the incident's impact (major → down, partial → partial, otherwise degraded).
 */
export const affectedServiceSchema = z.union([
  z.string().min(1),
  z.object({ id: z.string().min(1), status: componentStatusSchema }),
]);

const markdown = (max: number) => z.string().min(1).max(max);

export const incidentCreateSchema = z.object({
  title: z.string().min(1).max(200),
  /** Sets the impact; without it the impact follows the services' statuses. */
  impact: impactSchema.optional(),
  status: incidentStatusSchema.default('investigating'),
  /** Markdown. */
  message: markdown(10_000),
  services: z.array(affectedServiceSchema).default([]),
  notify: z.boolean().default(true),
  /** When it started, for an incident written up afterwards (backfill). A past time never notifies. */
  createdAt: z.coerce.date().optional(),
});

/** Editable incident fields; updates (status changes) go through incidentUpdateCreateSchema. */
export const incidentPatchSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    /** Sets the impact; `null` lets it follow the services' statuses again. */
    impact: impactSchema.nullable().optional(),
    services: z.array(affectedServiceSchema).optional(),
  })
  .refine((p) => Object.keys(p).length > 0, { message: 'nothing to change' });

export const incidentUpdateCreateSchema = z.object({
  status: incidentStatusSchema,
  /** Markdown. */
  message: markdown(10_000),
  notify: z.boolean().default(true),
  /** New statuses of affected services; services not listed keep theirs, new ones are added. */
  services: z.array(affectedServiceSchema).optional(),
  /** When it was posted, for updates written up afterwards. A past time never notifies. */
  createdAt: z.coerce.date().optional(),
});

export const postmortemSchema = z.object({
  /** Markdown. */
  body: markdown(50_000),
  /** Published postmortems appear on the incident page; drafts only in the admin area. */
  publish: z.boolean().default(false),
  /** Tell subscribers when it is published. */
  notify: z.boolean().default(false),
});

export const TEMPLATE_KINDS = ['incident', 'maintenance'] as const;

export const templateSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,59}$/, 'lowercase letters, digits and dashes')
    .optional(),
  kind: z.enum(TEMPLATE_KINDS),
  /** Name in the template picker. */
  name: z.string().min(1).max(100),
  /** Title of the incident or maintenance it starts. */
  title: z.string().min(1).max(200),
  /** Markdown: the first update or the maintenance description. */
  body: z.string().max(10_000).default(''),
  status: incidentStatusSchema.optional(),
  impact: impactSchema.optional(),
  services: z.array(affectedServiceSchema).default([]),
  /** Length of a maintenance window. */
  duration: duration.optional(),
});

/** Lifecycle of a maintenance window; recurring windows only go scheduled → in progress → completed. */
export const MAINTENANCE_STATUSES = ['scheduled', 'in_progress', 'verifying', 'completed'] as const;
export const maintenanceStatusSchema = z.enum(MAINTENANCE_STATUSES);

export const maintenanceCreateSchema = z
  .object({
    title: z.string().min(1).max(200),
    /** Markdown. */
    description: z.string().max(10_000).optional(),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    /** RFC 5545 RRULE, e.g. `FREQ=WEEKLY;BYDAY=SU`. */
    recurrence: z.string().max(500).optional(),
    services: z.array(z.string()).default([]),
    /** Announce the window to the channels (and subscribers) now. */
    notify: z.boolean().default(true),
  })
  .refine((m) => m.endsAt > m.startsAt, { message: 'endsAt must be after startsAt', path: ['endsAt'] });

export const maintenanceUpdateSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(10_000).nullable().optional(),
    startsAt: z.coerce.date().optional(),
    endsAt: z.coerce.date().optional(),
    recurrence: z.string().max(500).nullable().optional(),
    services: z.array(z.string()).optional(),
  })
  .refine((p) => Object.keys(p).length > 0, { message: 'nothing to change' })
  .refine((m) => !m.startsAt || !m.endsAt || m.endsAt > m.startsAt, {
    message: 'endsAt must be after startsAt',
    path: ['endsAt'],
  });

/** What subscribers can hear about. */
export const SUBSCRIBER_EVENTS = [
  'incidents',
  'automaticIncidents',
  'maintenance',
  'componentStatus',
] as const;
export const subscriberEventSchema = z.enum(SUBSCRIBER_EVENTS);

export const subscribeSchema = z.object({
  email: z.email().max(254),
  /** Defaults to every event the site offers. */
  events: z.array(subscriberEventSchema).optional(),
  /** `all`, or the ids of the services to hear about. */
  components: z.union([z.literal('all'), z.array(z.string()).max(500)]).default('all'),
  /** Follow this one incident (every update), on top of the choices above. */
  incidentId: z.string().max(100).optional(),
});

export const subscriberPrefsSchema = z.object({
  events: z.array(subscriberEventSchema).optional(),
  components: z.union([z.literal('all'), z.array(z.string()).max(500)]).optional(),
  /** Incidents followed one by one; send the full list. */
  incidents: z.array(z.string()).max(100).optional(),
});

/** A status update on a one-off maintenance window. */
export const maintenanceUpdateCreateSchema = z.object({
  status: maintenanceStatusSchema,
  /** Markdown. */
  message: z.string().min(1).max(10_000),
  notify: z.boolean().default(true),
});

export const tokenCreateSchema = z.object({
  name: z.string().min(1).max(80),
  scopes: z.array(scopeSchema).min(1),
  expiresInDays: z.number().int().min(1).max(3650).nullable().default(90),
});

export const userUpdateSchema = z.object({ role: roleSchema });

export const userCreateSchema = z.object({
  email: z.email(),
  name: z.string().min(1).max(120),
  password: z.string().min(12).max(256),
  role: roleSchema,
});
