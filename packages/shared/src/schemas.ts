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

export const monitorSpecSchema = z.discriminatedUnion('type', [
  httpMonitorSchema,
  tcpMonitorSchema,
  dnsMonitorSchema,
  tlsMonitorSchema,
  icmpMonitorSchema,
  pluginMonitorSchema,
]);
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
