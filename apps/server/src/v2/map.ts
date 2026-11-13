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
 * Heartline data in the common status page JSON format (`/api/v2/*.json`), so tools that read status pages in
 * that format (widgets, aggregators, other status pages) read this one as well.
 */

export type V2ComponentStatus =
  | 'operational'
  | 'degraded_performance'
  | 'partial_outage'
  | 'major_outage'
  | 'under_maintenance';
export type V2Indicator = 'none' | 'minor' | 'major' | 'critical' | 'maintenance';

export interface V2Page {
  id: string;
  name: string;
  url: string;
  time_zone: string;
  updated_at: string;
}

export interface V2Component {
  id: string;
  name: string;
  status: V2ComponentStatus;
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

export interface V2Update {
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
    old_status: V2ComponentStatus;
    new_status: V2ComponentStatus;
  }[];
  deliver_notifications: boolean;
  custom_tweet: null;
  tweet_id: null;
}

export interface V2Incident {
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
  incident_updates: V2Update[];
  components: V2Component[];
  scheduled_for?: string;
  scheduled_until?: string;
}

const iso = (ms: number) => new Date(ms).toISOString();

/** Status of a service; unknown and paused services have no equivalent in the format and are left out. */
export function componentStatus(s: ServiceStatus): V2ComponentStatus | null {
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

const COMPONENT: Record<ComponentStatus, V2ComponentStatus> = {
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

/** The page indicator and its sentence, in the format's usual wording. */
export function pageStatus(o: Pick<Overview, 'status' | 'headline'>): {
  indicator: V2Indicator;
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
export function components(groups: OverviewGroup[], pageId: string, times: ComponentTimes): V2Component[] {
  const out: V2Component[] = [];
  groups.forEach((g, gi) => {
    const members = g.services
      .map((s, si) => serviceComponent(s, si + 1, groupComponentId(g.id), pageId, times))
      .filter((c): c is V2Component => c !== null);
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

const RANK: Record<V2ComponentStatus, number> = {
  operational: 0,
  under_maintenance: 1,
  degraded_performance: 2,
  partial_outage: 3,
  major_outage: 4,
};
const worst = (list: V2ComponentStatus[]) =>
  list.reduce<V2ComponentStatus>((a, s) => (RANK[s] > RANK[a] ? s : a), 'operational');

function serviceComponent(
  s: ServiceSummary,
  position: number,
  groupId: string,
  pageId: string,
  times: ComponentTimes,
): V2Component | null {
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
  byId: Map<string, V2Component>,
): V2Incident {
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
  byId: Map<string, V2Component>,
): V2Incident {
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
      // The description is the first post, as status pages usually show it.
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
