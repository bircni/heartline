import { THEMES, duration, monitorSpecSchema, roleSchema } from '@heartline/shared';
import { z } from 'zod';

const notifierBase = { id: z.string().min(1), name: z.string().optional() };

export const notifierSchema = z.discriminatedUnion('type', [
  z.object({ ...notifierBase, type: z.literal('teams'), webhookUrl: z.url() }),
  z.object({
    ...notifierBase,
    type: z.literal('email'),
    from: z.string().min(1),
    to: z.array(z.string().min(1)).min(1),
    smtp: z.object({
      host: z.string().min(1),
      port: z.number().int().default(587),
      secure: z.boolean().default(false),
      user: z.string().optional(),
      password: z.string().optional(),
    }),
  }),
  z.object({
    ...notifierBase,
    type: z.literal('webhook'),
    url: z.url(),
    headers: z.record(z.string(), z.string()).default({}),
  }),
]);
export type NotifierConfig = z.output<typeof notifierSchema>;

export const oidcProviderSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  discoveryUrl: z.url(),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  scopes: z.array(z.string()).default(['openid', 'profile', 'email', 'groups']),
  groupsClaim: z.string().default('groups'),
  /** Group or team name → role. Gitea sends `org` and `org:team` entries. */
  roles: z.record(z.string(), roleSchema).default({}),
  /** Role for users matching no mapping; `none` denies sign-in. */
  defaultRole: z.union([roleSchema, z.literal('none')]).default('none'),
});
export type OidcProviderConfig = z.output<typeof oidcProviderSchema>;

const rateBucketSchema = z.object({
  max: z.number().int().min(1),
  window: duration,
});

const groupSchema = z.object({
  name: z.string().min(1),
  monitors: z.array(monitorSpecSchema).default([]),
});

export const configSchema = z
  .object({
    site: z
      .object({
        title: z.string().default('Status'),
        description: z.string().optional(),
        timezone: z.string().default('UTC'),
        logoUrl: z.string().optional(),
        /** Public base URL, e.g. https://status.example.com. Falls back to BASE_URL. */
        baseUrl: z.url().optional(),
        /** When false, the status page and public API require a signed-in user. */
        public: z.boolean().default(true),
        /** Show running versions and update urgency to anonymous visitors (vulnerability details never are). */
        showVersions: z.boolean().default(false),
        /** Default colour theme of the web UI; visitors can pick another one for themselves. */
        theme: z.enum(THEMES).default('green'),
      })
      .default({ title: 'Status', timezone: 'UTC', public: true, showVersions: false, theme: 'green' }),
    retention: z
      .object({
        rawDays: z.number().int().min(1).default(30),
        /** How long the audit log keeps entries. */
        auditDays: z.number().int().min(1).default(365),
      })
      .default({ rawDays: 30, auditDays: 365 }),
    rateLimit: z
      .object({
        enabled: z.boolean().default(true),
        /** Anonymous reads of the public API, feeds and badges, per client IP and replica. */
        public: rateBucketSchema.default({ max: 300, window: 60_000 }),
        /** Sign-in and client registration attempts per client IP, shared by all replicas. */
        auth: rateBucketSchema.default({ max: 10, window: 60_000 }),
        /** Take the client IP from X-Forwarded-For; enable behind a reverse proxy or ingress. */
        trustProxy: z.boolean().default(false),
      })
      .default({
        enabled: true,
        public: { max: 300, window: 60_000 },
        auth: { max: 10, window: 60_000 },
        trustProxy: false,
      }),
    software: z
      .object({
        enabled: z.boolean().default(true),
        /** How often vulnerability and release data is refreshed. */
        refreshEvery: duration.default(6 * 3_600_000),
        /** How often the CISA KEV catalog is downloaded. */
        kevRefreshEvery: duration.default(24 * 3_600_000),
        sources: z
          .object({
            osv: z.boolean().default(true),
            /** `auto` enables NVD when NVD_API_KEY is set. */
            nvd: z.union([z.boolean(), z.literal('auto')]).default('auto'),
            endoflife: z.boolean().default(true),
            kev: z.boolean().default(true),
            /** Release pages (Gitea/Forgejo, GitHub, custom URLs) for the latest version. */
            releases: z.boolean().default(true),
          })
          .default({ osv: true, nvd: 'auto', endoflife: true, kev: true, releases: true }),
        /** Overrides the NVD_API_KEY environment variable. */
        nvdApiKey: z.string().optional(),
        /** Overrides the GITHUB_TOKEN environment variable (release lookups). */
        githubToken: z.string().optional(),
      })
      .default({
        enabled: true,
        refreshEvery: 6 * 3_600_000,
        kevRefreshEvery: 24 * 3_600_000,
        sources: { osv: true, nvd: 'auto', endoflife: true, kev: true, releases: true },
      }),
    groups: z.array(groupSchema).default([]),
    notifiers: z.array(notifierSchema).default([]),
    notifications: z
      .object({
        recovery: z.boolean().default(true),
        incidents: z.boolean().default(true),
        /** Repeat a down notification while the outage lasts; 0 disables reminders. */
        reminderEvery: duration.default(0),
        /** New vulnerabilities, urgency rising to high/critical, version changes. */
        security: z.boolean().default(true),
      })
      .default({ recovery: true, incidents: true, reminderEvery: 0, security: true }),
    auth: z
      .object({
        local: z.boolean().default(true),
        users: z
          .array(
            z.object({
              email: z.email(),
              name: z.string().min(1),
              password: z.string().min(12, 'seeded passwords need at least 12 characters'),
              role: roleSchema.default('admin'),
            }),
          )
          .default([]),
        oidc: z.array(oidcProviderSchema).default([]),
      })
      .default({ local: true, users: [], oidc: [] }),
  })
  .superRefine((cfg, ctx) => {
    const ids = new Set<string>();
    cfg.groups.forEach((g, gi) =>
      g.monitors.forEach((m, mi) => {
        if (ids.has(m.id)) {
          ctx.addIssue({
            code: 'custom',
            message: `duplicate monitor id "${m.id}"`,
            path: ['groups', gi, 'monitors', mi, 'id'],
          });
        }
        ids.add(m.id);
      }),
    );
    const notifierIds = new Set(cfg.notifiers.map((n) => n.id));
    cfg.groups.forEach((g, gi) =>
      g.monitors.forEach((m, mi) =>
        m.notify.forEach((n, ni) => {
          if (!notifierIds.has(n)) {
            ctx.addIssue({
              code: 'custom',
              message: `unknown notifier "${n}"`,
              path: ['groups', gi, 'monitors', mi, 'notify', ni],
            });
          }
        }),
      ),
    );
  });

export type AppConfig = z.output<typeof configSchema>;
