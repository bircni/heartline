import type {
  ComponentStatus,
  Impact,
  Incident,
  Maintenance,
  Overview,
  OverviewGroup,
  ServiceStatus,
  ServiceSummary,
} from '@heartline/shared';

/*
 * Heartline data in the shapes of the Atlassian Statuspage public API v2 (`/api/v2/*.json`), so tools that
 * read Statuspage pages (widgets, aggregators, other status pages) read this one as well.
 */

export type SpComponentStatus =
  | 'operational'
  | 'degraded_performance'
  | 'partial_outage'
  | 'major_outage'
  | 'under_maintenance';
export type SpIndicator = 'none' | 'minor' | 'major' | 'critical' | 'maintenance';

export interface SpPage {
  id: string;
  name: string;
  url: string;
  time_zone: string;
  updated_at: string;
}

export interface SpComponent {
  id: string;
  name: string;
  status: SpComponentStatus;
  created_at: string;
  updated_at: string;
  position: number;
  description: string | null;
  showcase: boolean;
  start_date: string | null;
  group_id: string | null;
  page_id: string;
  group: boolean;
  only_show_if_degraded: boolean;
  components?: string[];
}

export interface SpUpdate {
  id: string;
  status: string;
  body: string;
  incident_id: string;
  created_at: string;
  updated_at: string;
  display_at: string;
  affected_components: {
    code: string;
    name: string;
    old_status: SpComponentStatus;
    new_status: SpComponentStatus;
  }[];
  deliver_notifications: boolean;
  custom_tweet: null;
  tweet_id: null;
}

export interface SpIncident {
  id: string;
  name: string;
  status: string;
  created_at: string;
  updated_at: string;
  monitoring_at: string | null;
  resolved_at: string | null;
  impact: string;
  shortlink: string;
  started_at: string;
  page_id: string;
  incident_updates: SpUpdate[];
  components: SpComponent[];
  scheduled_for?: string;
  scheduled_until?: string;
}

const iso = (ms: number) => new Date(ms).toISOString();

/** Status of a service; unknown and paused services have no Statuspage equivalent and are left out. */
export function componentStatus(s: ServiceStatus): SpComponentStatus | null {
  switch (s) {
    case 'operational':
      return 'operational';
    case 'degraded':
      return 'degraded_performance';
    case 'partial':
      return 'partial_outage';
    case 'down':
      return 'major_outage';
    case 'maintenance':
      return 'under_maintenance';
    default:
      return null;
  }
}

const COMPONENT: Record<ComponentStatus, SpComponentStatus> = {
  operational: 'operational',
  degraded: 'degraded_performance',
  partial: 'partial_outage',
  down: 'major_outage',
};

export const IMPACT: Record<Impact, string> = {
  none: 'none',
  degraded: 'minor',
  partial: 'major',
  major: 'critical',
};

/** The page indicator and its sentence, as Statuspage words them. */
export function pageStatus(o: Pick<Overview, 'status' | 'headline'>): {
  indicator: SpIndicator;
  description: string;
} {
  switch (o.status) {
    case 'down':
      return o.headline === 'Major outage'
        ? { indicator: 'critical', description: 'Major System Outage' }
        : { indicator: 'major', description: 'Partial System Outage' };
    case 'partial':
      return { indicator: 'major', description: 'Partial System Outage' };
    case 'degraded':
      return { indicator: 'minor', description: 'Partially Degraded Service' };
    case 'maintenance':
      return { indicator: 'maintenance', description: 'Service Under Maintenance' };
    default:
      return { indicator: 'none', description: 'All Systems Operational' };
  }
}

/** Groups are components too: `group.<id>`, with their members' ids. */
export const groupComponentId = (id: string) => `group.${id}`;

export interface ComponentTimes {
  /** Monitor id → created and last status change (ms). */
  created: Map<string, number>;
  changed: Map<string, number>;
}

/** Your own services and their groups (third-party services are left out), in page order. */
export function components(groups: OverviewGroup[], pageId: string, times: ComponentTimes): SpComponent[] {
  const out: SpComponent[] = [];
  groups.forEach((g, gi) => {
    const members = g.services
      .map((s, si) => serviceComponent(s, si + 1, groupComponentId(g.id), pageId, times))
      .filter((c): c is SpComponent => c !== null);
    if (members.length === 0) return;
    const created = Math.min(...members.map((m) => Date.parse(m.created_at)));
    const updated = Math.max(...members.map((m) => Date.parse(m.updated_at)));
    out.push({
      id: groupComponentId(g.id),
      name: g.name,
      status: worst(members.map((m) => m.status)),
      created_at: iso(created),
      updated_at: iso(updated),
      position: gi + 1,
      description: g.description,
      showcase: false,
      start_date: null,
      group_id: null,
      page_id: pageId,
      group: true,
      only_show_if_degraded: g.hideUnlessDegraded,
      components: members.map((m) => m.id),
    });
    out.push(...members);
  });
  return out;
}

const RANK: Record<SpComponentStatus, number> = {
  operational: 0,
  under_maintenance: 1,
  degraded_performance: 2,
  partial_outage: 3,
  major_outage: 4,
};
const worst = (list: SpComponentStatus[]) =>
  list.reduce<SpComponentStatus>((a, s) => (RANK[s] > RANK[a] ? s : a), 'operational');

function serviceComponent(
  s: ServiceSummary,
  position: number,
  groupId: string,
  pageId: string,
  times: ComponentTimes,
): SpComponent | null {
  const status = componentStatus(s.status);
  if (!status) return null;
  const created = times.created.get(s.id) ?? Date.now();
  return {
    id: s.id,
    name: s.name,
    status,
    created_at: iso(created),
    updated_at: iso(times.changed.get(s.id) ?? created),
    position,
    description: s.description,
    showcase: true,
    start_date: iso(created).slice(0, 10),
    group_id: groupId,
    page_id: pageId,
    group: false,
    only_show_if_degraded: false,
  };
}

export function incident(
  i: Incident,
  pageId: string,
  baseUrl: string,
  byId: Map<string, SpComponent>,
): SpIncident {
  const updates = i.updates;
  const monitoring = updates.filter((u) => u.status === 'monitoring').at(-1);
  return {
    id: i.id,
    name: i.title,
    status: i.resolvedAt !== null && i.postmortem?.publishedAt ? 'postmortem' : i.status,
    created_at: iso(i.createdAt),
    updated_at: iso(i.updatedAt),
    monitoring_at: monitoring ? iso(monitoring.createdAt) : null,
    resolved_at: i.resolvedAt === null ? null : iso(i.resolvedAt),
    impact: IMPACT[i.impact],
    shortlink: `${baseUrl}/incidents/${i.id}`,
    started_at: iso(i.createdAt),
    page_id: pageId,
    incident_updates: updates.map((u) => ({
      id: u.id,
      status: u.status,
      body: u.message,
      incident_id: i.id,
      created_at: iso(u.createdAt),
      updated_at: iso(u.createdAt),
      display_at: iso(u.createdAt),
      affected_components: u.components.map((c) => ({
        code: c.id,
        name: c.name,
        old_status: COMPONENT[c.oldStatus ?? 'operational'],
        new_status: COMPONENT[c.newStatus],
      })),
      deliver_notifications: u.notify,
      custom_tweet: null,
      tweet_id: null,
    })),
    components: i.services.flatMap((s) => {
      const c = byId.get(s.id);
      return c ? [{ ...c, status: i.resolvedAt === null ? COMPONENT[s.status] : c.status }] : [];
    }),
  };
}

/** A maintenance window, or the current or next occurrence of a recurring one (id `<id>.<start>`). */
export function maintenance(
  m: Maintenance,
  pageId: string,
  baseUrl: string,
  byId: Map<string, SpComponent>,
): SpIncident {
  const start = m.nextStartsAt ?? m.startsAt;
  const end = m.nextEndsAt ?? m.endsAt;
  const id = m.recurrence ? `${m.id}.${start}` : m.id;
  const created = m.updates.at(-1)?.createdAt ?? m.startsAt;
  const updated = m.updates[0]?.createdAt ?? created;
  return {
    id,
    name: m.title,
    status: m.status,
    created_at: iso(Math.min(created, start)),
    updated_at: iso(updated),
    monitoring_at: null,
    resolved_at: m.completedAt === null ? null : iso(m.completedAt),
    impact: 'maintenance',
    shortlink: `${baseUrl}/maintenance/${m.id}`,
    started_at: iso(m.startedAt ?? start),
    page_id: pageId,
    incident_updates: [
      ...m.updates.map((u) => ({
        id: u.id,
        status: u.status,
        body: u.message,
        incident_id: id,
        created_at: iso(u.createdAt),
        updated_at: iso(u.createdAt),
        display_at: iso(u.createdAt),
        affected_components: [],
        deliver_notifications: true,
        custom_tweet: null,
        tweet_id: null,
      })),
      // The description is the first post, as on Statuspage.
      ...(m.description
        ? [
            {
              id: `${id}.description`,
              status: 'scheduled',
              body: m.description,
              incident_id: id,
              created_at: iso(Math.min(created, start)),
              updated_at: iso(Math.min(created, start)),
              display_at: iso(Math.min(created, start)),
              affected_components: [],
              deliver_notifications: true,
              custom_tweet: null,
              tweet_id: null,
            },
          ]
        : []),
    ],
    components: (m.services.length ? m.services.map((s) => s.id) : [...byId.keys()]).flatMap((sid) => {
      const c = byId.get(sid);
      return c && !c.group ? [c] : [];
    }),
    scheduled_for: iso(start),
    scheduled_until: iso(end),
  };
}
