import type { DayState, ServiceStatus, UrgencyLevel, VulnSeverity } from '@heartline/shared';

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

/** CSS variables per status: dot colour, text colour and halo ring. */
export const STATUS_TONE: Record<ServiceStatus, { dot: string; text: string; ring: string }> = {
  // All clear stays quiet: only the dot is green, so colored text always means trouble.
  operational: { dot: 'var(--ok)', text: 'var(--sec)', ring: 'var(--ring-ok)' },
  degraded: { dot: 'var(--warn)', text: 'var(--warn-text)', ring: 'var(--ring-warn)' },
  down: { dot: 'var(--bad)', text: 'var(--bad-text)', ring: 'var(--ring-bad)' },
  maintenance: { dot: 'var(--maint)', text: 'var(--sec)', ring: 'transparent' },
  paused: { dot: 'var(--fill-2)', text: 'var(--sec)', ring: 'transparent' },
  unknown: { dot: 'var(--fill-2)', text: 'var(--sec)', ring: 'transparent' },
};

export const DAY_COLOR: Record<DayState, string> = {
  operational: 'var(--ok-quiet)',
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
