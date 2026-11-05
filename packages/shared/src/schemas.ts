import { z } from 'zod';
import { parseDuration } from './duration.ts';

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

export const softwareSchema = z.object({
  /** Catalog slug (also the endoflife.date product), e.g. `gitea`. Unknown slugs are allowed. */
  product: z.string().regex(/^[a-z0-9][a-z0-9.-]{0,62}$/, 'lowercase slug'),
  /** Display name for products that are not in the catalog. */
  name: z.string().min(1).max(80).optional(),
  version: softwareVersionSchema.optional(),
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

export const monitorSpecSchema = z
  .discriminatedUnion('type', [
    httpMonitorSchema,
    tcpMonitorSchema,
    dnsMonitorSchema,
    tlsMonitorSchema,
    icmpMonitorSchema,
    pluginMonitorSchema,
  ])
  .superRefine((m, ctx) => {
    // Without an HTTP response (or a plugin result) there is nothing to read a version from.
    const probe = m.software?.version;
    if (m.software && m.type !== 'http' && m.type !== 'plugin' && !probe?.url && !probe?.static) {
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
export const MONITOR_KINDS = ['http', 'tcp', 'dns', 'tls', 'icmp', 'plugin'] as const satisfies MonitorKind[];

export const INCIDENT_STATUSES = ['investigating', 'identified', 'monitoring', 'resolved'] as const;
export const incidentStatusSchema = z.enum(INCIDENT_STATUSES);
export const IMPACTS = ['degraded', 'partial', 'major'] as const;
export const impactSchema = z.enum(IMPACTS);

export const incidentCreateSchema = z.object({
  title: z.string().min(1).max(200),
  impact: impactSchema.default('degraded'),
  status: incidentStatusSchema.default('investigating'),
  message: z.string().min(1).max(5000),
  services: z.array(z.string()).default([]),
  notify: z.boolean().default(true),
});

/** Editable incident fields; updates (status changes) go through incidentUpdateCreateSchema. */
export const incidentPatchSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    impact: impactSchema.optional(),
    services: z.array(z.string()).optional(),
  })
  .refine((p) => Object.keys(p).length > 0, { message: 'nothing to change' });

export const incidentUpdateCreateSchema = z.object({
  status: incidentStatusSchema,
  message: z.string().min(1).max(5000),
  notify: z.boolean().default(true),
});

export const maintenanceCreateSchema = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().max(5000).optional(),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    /** RFC 5545 RRULE, e.g. `FREQ=WEEKLY;BYDAY=SU`. */
    recurrence: z.string().max(500).optional(),
    services: z.array(z.string()).default([]),
  })
  .refine((m) => m.endsAt > m.startsAt, { message: 'endsAt must be after startsAt', path: ['endsAt'] });

export const maintenanceUpdateSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(5000).nullable().optional(),
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
