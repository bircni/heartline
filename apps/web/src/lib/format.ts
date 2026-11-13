import {
  addDays,
  dayKey,
  dayRange,
  zoneAbbreviation,
  zonedToInstant as zonedInstant,
} from '@heartline/shared';
import type {
  ComponentStatus,
  DayState,
  MaintenanceStatus,
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

let siteZone: string | undefined;

/**
 * Sets the time zone every timestamp is shown in: the site's, so times agree with the day bars and reports
 * (which the server computes in that zone) whatever zone the visitor's browser is in.
 */
export function setDisplayTimeZone(timeZone: string | undefined): void {
  if (timeZone === siteZone) return;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone });
    siteZone = timeZone;
  } catch {
    siteZone = undefined;
  }
  formatters.clear();
}

/** The zone timestamps are shown in: the site's once known, else the browser's. */
export function displayTimeZone(): string {
  return siteZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(options: Intl.DateTimeFormatOptions, timeZone = displayTimeZone()): Intl.DateTimeFormat {
  const key = `${timeZone}|${JSON.stringify(options)}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(undefined, { ...options, timeZone });
    formatters.set(key, f);
  }
  return f;
}

/** "Europe/Berlin (CET)": the zone timestamps are shown in. */
export function zoneLabel(at = Date.now()): string {
  const tz = displayTimeZone();
  const abbr = zoneAbbreviation(at, tz);
  return abbr && abbr !== tz ? `${tz} (${abbr})` : tz;
}

/** "CET": the short zone name at an instant, for a timestamp that stands on its own. */
export function zoneShort(at: number): string {
  return zoneAbbreviation(at, displayTimeZone());
}

export function dateTime(at: number, timeZone?: string): string {
  return formatter(
    { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
    timeZone,
  ).format(at);
}

/** "Nov 13, 2026, 14:05": a full date and time. */
export function fullDateTime(at: number): string {
  return formatter({
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(at);
}

export function time(at: number, timeZone?: string): string {
  return formatter(
    { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' },
    timeZone,
  ).format(at);
}

export function shortDay(day: string): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
    Date.parse(`${day}T00:00:00Z`),
  );
}

/** "14:05". */
export function clock(at: number): string {
  return formatter({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
}

/** "Sun, Nov 15". */
export function weekdayDate(at: number): string {
  return formatter({ weekday: 'short', month: 'short', day: 'numeric' }).format(at);
}

/** Calendar day (`YYYY-MM-DD`) of an instant in the display zone, for grouping by day. */
export function displayDay(at: number): string {
  return dayKey(at, displayTimeZone());
}

/** "November 2026" for a `YYYY-MM-DD` day. */
export function monthLabel(day: string): string {
  return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(
    Date.parse(`${day}T00:00:00Z`),
  );
}

/** "Fri, Nov 13" for a `YYYY-MM-DD` day. */
export function weekdayDay(day: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(Date.parse(`${day}T00:00:00Z`));
}

/**
 * The value of a `datetime-local` input for an instant, in the display zone, and back. Admin forms use them so
 * a window entered as 22:00 starts at 22:00 site time, as shown everywhere else.
 */
export function toZonedInput(at: number, timeZone = displayTimeZone()): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function fromZonedInput(value: string, timeZone = displayTimeZone()): number {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return Number.NaN;
  const [, y, mo, d, h, mi] = m.map(Number) as [number, number, number, number, number, number];
  return zonedInstant(Date.UTC(y, mo - 1, d, h, mi), timeZone);
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
  partial: 'Partial outage',
  down: 'Down',
  maintenance: 'Maintenance',
  paused: 'Paused',
  unknown: 'Pending',
};

/** Like STATUS_LABEL, but a third-party status that cannot be read is not "pending". */
export function statusLabel(status: ServiceStatus, external = false): string {
  return external && status === 'unknown' ? 'Unavailable' : STATUS_LABEL[status];
}

/** Colours of a state: dot, text, tinted background and the border of a tinted surface. */
export interface Tone {
  dot: string;
  text: string;
  bg: string;
  line: string;
}

const NEUTRAL: Tone = { dot: 'var(--fill-2)', text: 'var(--sec)', bg: 'var(--fill)', line: 'var(--hair)' };
const WARN: Tone = {
  dot: 'var(--warn)',
  text: 'var(--warn-text)',
  bg: 'var(--warn-bg)',
  line: 'var(--warn)',
};
const BAD: Tone = {
  dot: 'var(--bad)',
  text: 'var(--bad-text)',
  bg: 'var(--bad-bg)',
  line: 'var(--bad-line)',
};

const PARTIAL: Tone = {
  dot: 'var(--partial)',
  text: 'var(--partial-text)',
  bg: 'var(--partial-bg)',
  line: 'var(--partial)',
};

export const STATUS_TONE: Record<ServiceStatus, Tone> = {
  operational: { dot: 'var(--ok)', text: 'var(--ok-text)', bg: 'var(--ok-bg)', line: 'var(--hair)' },
  degraded: WARN,
  partial: PARTIAL,
  down: BAD,
  maintenance: { dot: 'var(--maint)', text: 'var(--maint)', bg: 'var(--maint-bg)', line: 'var(--hair)' },
  paused: NEUTRAL,
  unknown: NEUTRAL,
};

/** Background of a troubled period, behind the availability graph and the response-time chart. */
export const DAY_BG: Partial<Record<DayState, string>> = {
  down: 'var(--bad-band)',
  degraded: 'var(--warn-band)',
  maintenance: 'var(--maint-band)',
};

export const IMPACT_LABEL: Record<Impact, string> = {
  none: 'No impact',
  degraded: 'Degraded performance',
  partial: 'Partial outage',
  major: 'Major outage',
};

export const MAINTENANCE_LABEL: Record<MaintenanceStatus, string> = {
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  verifying: 'Verifying',
  completed: 'Completed',
};

/** What an incident says about one affected service. */
export const COMPONENT_LABEL: Record<ComponentStatus, string> = {
  operational: 'Operational',
  degraded: 'Degraded performance',
  partial: 'Partial outage',
  down: 'Major outage',
};

export const COMPONENT_TONE: Record<ComponentStatus, Tone> = {
  operational: STATUS_TONE.operational,
  degraded: WARN,
  partial: PARTIAL,
  down: BAD,
};

/** Colours of an incident by impact while open (amber, orange, red), neutral once resolved or without impact. */
export function incidentTone(i: Pick<Incident, 'impact' | 'resolvedAt'>): Tone {
  if (i.resolvedAt !== null || i.impact === 'none') return NEUTRAL;
  return i.impact === 'degraded' ? WARN : i.impact === 'partial' ? PARTIAL : BAD;
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

export const DAY_MS = 86_400_000;

/**
 * Calendar ticks between two instants: every day for a week, Mondays for a month, the first of each
 * month beyond that. `snap` rounds positions to a grid of that many equal marks so ticks fall between them.
 */
export function timeTicks(from: number, to: number, snap?: number, timeZone = displayTimeZone()): Tick[] {
  const span = to - from;
  if (span <= 0) return [];
  const days = span / DAY_MS;
  const mode = days <= 10 ? 'day' : days <= 45 ? 'week' : 'month';
  // Labels name calendar days, so they are formatted from the day itself (at UTC), not from an instant.
  const format = new Intl.DateTimeFormat(undefined, {
    ...(mode === 'day'
      ? { weekday: 'short' }
      : mode === 'week'
        ? { month: 'short', day: 'numeric' }
        : { month: 'short' }),
    timeZone: 'UTC',
  });
  const ticks: Tick[] = [];
  // Ticks sit on midnights in the display zone, from the first one after `from`.
  for (let day = addDays(dayKey(from, timeZone), 1); ; day = addDays(day, 1)) {
    const start = dayRange(day, timeZone)[0];
    if (start >= to) break;
    const date = new Date(`${day}T00:00:00Z`);
    if (mode === 'week' && date.getUTCDay() !== 1) continue;
    if (mode === 'month' && date.getUTCDate() !== 1) continue;
    const pos = (start - from) / span;
    ticks.push({ pos: snap ? Math.round(pos * snap) / snap : pos, label: format.format(date) });
  }
  // Longer ranges rarely start on a tick, so the left edge says where the axis begins.
  if (mode !== 'day' && (ticks[0]?.pos ?? 1) > 0.18)
    ticks.unshift({ pos: 0, label: formatter({ month: 'short', day: 'numeric' }, timeZone).format(from) });
  return ticks;
}

/** Leaves room at the right end of an axis for the end label ("Today" or the last day). */
export function clearOfEndLabel(t: Tick): boolean {
  return t.pos < 0.84;
}

/** Ticks for a run of consecutive `YYYY-MM-DD` days, one mark per day. */
export function dayTicks(days: string[], timeZone = displayTimeZone()): Tick[] {
  const first = days[0];
  const last = days.at(-1);
  if (!first || !last) return [];
  return timeTicks(dayRange(first, timeZone)[0], dayRange(last, timeZone)[1], days.length, timeZone);
}
