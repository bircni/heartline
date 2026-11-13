import { THEMES, duration, monitorSpecSchema, roleSchema, templateSchema } from '@heartline/shared';
import { z } from 'zod';
import { slugify } from '../util/slug.ts';

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

/** Links on the public page may only go to web pages or e-mail. */
const linkUrl = z
  .string()
  .regex(/^(https?:\/\/|mailto:|\/)/i, 'must start with https://, http://, mailto: or /');
const siteLinkSchema = z.object({ label: z.string().min(1).max(60), url: linkUrl });

export const groupIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,59}$/, 'lowercase letters, digits and dashes');

const groupSchema = z.object({
  /** Stable id for links and the API; derived from the name when left out. */
  id: groupIdSchema.optional(),
  name: z.string().min(1),
  /** Shown as a tooltip next to the group name. */
  description: z.string().max(1000).optional(),
  /** Show the group as one rolled-up row until a visitor opens it. */
  collapsed: z.boolean().default(false),
  /** Hide the group from visitors while all its services are operational. */
  hideUnlessDegraded: z.boolean().default(false),
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
        /** Icon in the browser tab; the heartline icon by default. */
        faviconUrl: z.string().optional(),
        /** Picture for link previews (OpenGraph). */
        ogImage: linkUrl.optional(),
        links: z
          .object({
            header: z.array(siteLinkSchema).max(5).default([]),
            footer: z.array(siteLinkSchema).max(10).default([]),
          })
          .default({ header: [], footer: [] }),
        /** Public base URL, e.g. https://status.example.com. Falls back to BASE_URL. */
        baseUrl: z.url().optional(),
        /** When false, the status page and public API require a signed-in user. */
        public: z.boolean().default(true),
        /** Show running versions and update urgency to anonymous visitors (vulnerability details never are). */
        showVersions: z.boolean().default(false),
        /** Default colour theme of the web UI; visitors can pick another one for themselves. */
        theme: z.enum(THEMES).default('green'),
      })
      .default({
        title: 'Status',
        timezone: 'UTC',
        public: true,
        showVersions: false,
        theme: 'green',
        links: { header: [], footer: [] },
      }),
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
        /** Push monitor reports per client IP, shared by all replicas. */
        push: rateBucketSchema.default({ max: 120, window: 60_000 }),
        /** Subscription sign-ups and manage-link requests per client IP, shared by all replicas. */
        subscribe: rateBucketSchema.default({ max: 10, window: 600_000 }),
        /** Take the client IP from X-Forwarded-For; enable behind a reverse proxy or ingress. */
        trustProxy: z.boolean().default(false),
      })
      .default({
        enabled: true,
        public: { max: 300, window: 60_000 },
        auth: { max: 10, window: 60_000 },
        push: { max: 120, window: 60_000 },
        subscribe: { max: 10, window: 600_000 },
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
    /** Incident and maintenance templates; read-only in the UI. */
    templates: z.array(templateSchema).default([]),
    notifiers: z.array(notifierSchema).default([]),
    notifications: z
      .object({
        recovery: z.boolean().default(true),
        incidents: z.boolean().default(true),
        /** Repeat a down notification while the outage lasts; 0 disables reminders. */
        reminderEvery: duration.default(0),
        /** New vulnerabilities, urgency rising to high/critical, version changes. */
        security: z.boolean().default(true),
        /** Maintenance scheduled, starting soon, started, completed and its updates. */
        maintenance: z.boolean().default(true),
      })
      .default({ recovery: true, incidents: true, reminderEvery: 0, security: true, maintenance: true }),
    layout: z
      .object({
        /** The last 15 days of resolved incidents, day by day, below the services. */
        pastIncidents: z.boolean().default(true),
        /** Subscribe opens a dialog with e-mail and feeds instead of going to a page. */
        subscribeDialog: z.boolean().default(true),
        /** Every service row says its status ("Operational"), with its description as a tooltip. */
        statusLabels: z.boolean().default(true),
        /** Open incidents show as boxes with all their updates in place of the status banner. */
        incidentBox: z.boolean().default(true),
      })
      .default({ pastIncidents: true, subscribeDialog: true, statusLabels: true, incidentBox: true }),
    embed: z
      .object({
        /** The /embed page, the widget and badges can be used on other sites. */
        enabled: z.boolean().default(true),
        /** Sites that may show /embed in a frame (CSP frame-ancestors), e.g. https://example.com; '*' for any. */
        frameAncestors: z.array(z.string().min(1)).default(['*']),
      })
      .default({ enabled: true, frameAncestors: ['*'] }),
    subscribers: z
      .object({
        /** Visitors can sign up for e-mail notifications. */
        enabled: z.boolean().default(true),
        email: z
          .object({
            /** Id of an `email` notifier whose mail server and sender are used; default the first one. */
            notifier: z.string().optional(),
            /** Most e-mails sent per minute, for the mail server's limits. */
            ratePerMinute: z.number().int().min(1).max(10_000).default(60),
          })
          .default({ ratePerMinute: 60 }),
        /** How long a confirmation link works. */
        confirmTtl: duration.default(48 * 3_600_000),
        /** Which events subscribers can choose. */
        events: z
          .object({
            /** Incidents posted by people (created, updates, resolved, postmortem); each update's notify switch decides. */
            incidents: z.boolean().default(true),
            /** Incidents opened and resolved by failing checks. */
            automaticIncidents: z.boolean().default(false),
            /** Maintenance scheduled, reminder, started, completed, updates. */
            maintenance: z.boolean().default(true),
            /** Every change of a service's status, also without an incident. */
            componentStatus: z.boolean().default(false),
          })
          .default({ incidents: true, automaticIncidents: false, maintenance: true, componentStatus: false }),
      })
      .default({
        enabled: true,
        email: { ratePerMinute: 60 },
        confirmTtl: 48 * 3_600_000,
        events: { incidents: true, automaticIncidents: false, maintenance: true, componentStatus: false },
      }),
    maintenance: z
      .object({
        /** Reminder this long before a window starts; 0 sends none. */
        reminderBefore: duration.default(3_600_000),
      })
      .default({ reminderBefore: 3_600_000 }),
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
    const groupIds = new Set<string>();
    cfg.groups.forEach((g, gi) => {
      const id = g.id ?? slugify(g.name);
      if (groupIds.has(id))
        ctx.addIssue({
          code: 'custom',
          message: `two groups share the id "${id}"; give one of them its own \`id\``,
          path: ['groups', gi, g.id ? 'id' : 'name'],
        });
      groupIds.add(id);
    });
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
