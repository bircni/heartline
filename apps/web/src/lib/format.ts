import type {
  DayState,
  Impact,
  Incident,
  ServiceRef,
  ServiceStatus,
  UrgencyLevel,
  VulnSeverity,
} from '@heartline/shared';

export function pct(v: number | null | undefined): string {
  return v === null || v === undefined ? '–' : `${v.toFixed(v === 100 ? 0 : 2)}%`;
}

export function ms(v: number | null | undefined): string {
  if (v === null || v === undefined) return '–';
  return v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`;
}

export function relative(at: number | null | undefined, now = Date.now()): string {
  if (!at) return 'never';
  const s = Math.round((now - at) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} d ago`;
}

export function dateTime(at: number, timeZone?: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(at);
}

export function time(at: number, timeZone?: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(at);
}

export function shortDay(day: string): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
    Date.parse(`${day}T00:00:00Z`),
  );
}

/** `day` (`YYYY-MM-DD`) moved by `n` calendar days. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function duration(from: number, to: number | null): string {
  const minutes = Math.max(1, Math.round(((to ?? Date.now()) - from) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h < 48) return m ? `${h} h ${m} min` : `${h} h`;
  return `${Math.round(h / 24)} days`;
}

export const STATUS_LABEL: Record<ServiceStatus, string> = {
  operational: 'Operational',
  degraded: 'Degraded',
  down: 'Down',
  maintenance: 'Maintenance',
  paused: 'Paused',
  unknown: 'Pending',
};

/** CSS variables per status: dot, text and background colour. */
export const STATUS_TONE: Record<ServiceStatus, { dot: string; text: string; bg: string }> = {
  operational: { dot: 'var(--ok)', text: 'var(--ok-text)', bg: 'var(--ok-bg)' },
  degraded: { dot: 'var(--warn)', text: 'var(--warn-text)', bg: 'var(--warn-bg)' },
  down: { dot: 'var(--bad)', text: 'var(--bad-text)', bg: 'var(--bad-bg)' },
  maintenance: { dot: 'var(--maint)', text: 'var(--maint)', bg: 'var(--maint-bg)' },
  paused: { dot: 'var(--fill-2)', text: 'var(--sec)', bg: 'var(--fill)' },
  unknown: { dot: 'var(--fill-2)', text: 'var(--sec)', bg: 'var(--fill)' },
};

/** Background of a troubled period, behind the availability graph and the response-time chart. */
export const DAY_BG: Partial<Record<DayState, string>> = {
  down: 'var(--bad-bg)',
  degraded: 'var(--warn-bg)',
  maintenance: 'var(--maint-bg)',
};

export const IMPACT_LABEL: Record<Impact, string> = {
  degraded: 'Degraded performance',
  partial: 'Partial outage',
  major: 'Major outage',
};

/** Text colour of an incident: red or amber while open, grey once resolved. */
export function incidentTone(i: Pick<Incident, 'impact' | 'resolvedAt'>): string {
  if (i.resolvedAt !== null) return 'var(--sec)';
  return i.impact === 'degraded' ? 'var(--warn-text)' : 'var(--bad-text)';
}

/** "lasted 1 h 5 min" or "ongoing for 20 min". */
export function incidentAge(i: Pick<Incident, 'createdAt' | 'resolvedAt'>): string {
  return i.resolvedAt === null
    ? `ongoing for ${duration(i.createdAt, null)}`
    : `lasted ${duration(i.createdAt, i.resolvedAt)}`;
}

/** Names of the affected services, or "All services" when an incident or window names none. */
export function serviceNames(services: ServiceRef[]): string {
  return services.map((s) => s.name).join(', ') || 'All services';
}

export const DAY_COLOR: Record<DayState, string> = {
  operational: 'var(--ok)',
  degraded: 'var(--warn)',
  down: 'var(--bad)',
  maintenance: 'var(--maint)',
  nodata: 'var(--fill-2)',
};

export const URGENCY_LABEL: Record<UrgencyLevel, string> = {
  critical: 'Update now',
  high: 'Update soon',
  medium: 'Update advised',
  low: 'Minor update',
  none: 'Up to date',
  unknown: 'Unknown',
};

/** Dot and text colour per urgency level. */
export const URGENCY_TONE: Record<UrgencyLevel, { dot: string; text: string }> = {
  critical: { dot: 'var(--bad)', text: 'var(--bad-text)' },
  high: { dot: 'var(--bad)', text: 'var(--bad-text)' },
  medium: { dot: 'var(--warn)', text: 'var(--warn-text)' },
  low: { dot: 'var(--warn)', text: 'var(--sec)' },
  none: { dot: 'var(--ok)', text: 'var(--sec)' },
  unknown: { dot: 'var(--fill-2)', text: 'var(--sec)' },
};

export const SEVERITY_TONE: Record<VulnSeverity, string> = {
  critical: 'var(--bad)',
  high: 'var(--bad)',
  medium: 'var(--warn)',
  low: 'var(--maint)',
  unknown: 'var(--fill-2)',
};

export function shortDate(day: string): string {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(Date.parse(`${day}T00:00:00Z`));
}

export const DAY_LABEL: Record<DayState, string> = {
  operational: 'No issues',
  degraded: 'Degraded',
  down: 'Outage',
  maintenance: 'Maintenance',
  nodata: 'No data',
};

/** A labelled position on a time axis, as a fraction of its width. */
export interface Tick {
  pos: number;
  label: string;
}

const DAY_MS = 86_400_000;

/**
 * Calendar ticks between two instants: every day for a week, Mondays for a month, the first of each
 * month beyond that. `snap` rounds positions to a grid of that many equal marks so ticks fall between them.
 */
export function timeTicks(from: number, to: number, snap?: number): Tick[] {
  const span = to - from;
  if (span <= 0) return [];
  const days = span / DAY_MS;
  const mode = days <= 10 ? 'day' : days <= 45 ? 'week' : 'month';
  const format = new Intl.DateTimeFormat(
    undefined,
    mode === 'day'
      ? { weekday: 'short' }
      : mode === 'week'
        ? { month: 'short', day: 'numeric' }
        : { month: 'short' },
  );
  const ticks: Tick[] = [];
  const d = new Date(from);
  d.setHours(24, 0, 0, 0);
  for (; d.getTime() < to; d.setDate(d.getDate() + 1)) {
    if (mode === 'week' && d.getDay() !== 1) continue;
    if (mode === 'month' && d.getDate() !== 1) continue;
    const pos = (d.getTime() - from) / span;
    ticks.push({ pos: snap ? Math.round(pos * snap) / snap : pos, label: format.format(d) });
  }
  // Longer ranges rarely start on a tick, so the left edge says where the axis begins.
  if (mode !== 'day' && (ticks[0]?.pos ?? 1) > 0.12)
    ticks.unshift({
      pos: 0,
      label: new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(from),
    });
  return ticks;
}

/** Ticks for a run of consecutive `YYYY-MM-DD` days, one mark per day. */
export function dayTicks(days: string[]): Tick[] {
  const first = days[0];
  if (!first) return [];
  const from = new Date(`${first}T00:00:00`).getTime();
  return timeTicks(from, from + days.length * DAY_MS, days.length);
}
