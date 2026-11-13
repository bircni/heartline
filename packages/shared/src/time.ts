/** Longest history range, in days, that the overview, service and report endpoints serve. */
export const MAX_RANGE_DAYS = 365;

const formatters = new Map<string, Intl.DateTimeFormat>();

function dayFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Calendar day (`YYYY-MM-DD`) of an instant in the given time zone. Server and web share it so days agree. */
export function dayKey(at: number, timeZone: string): string {
  return dayFormatter(timeZone).format(at);
}

/** `day` (`YYYY-MM-DD`) moved by `n` calendar days. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** True for a calendar day that exists, written `YYYY-MM-DD` (2026-02-31 is not one). */
export function isDayKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

/** Offset of the time zone from UTC at an instant, in ms (positive east of Greenwich). */
export function offsetMs(at: number, timeZone: string): number {
  let f = offsetFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' });
    offsetFormatters.set(timeZone, f);
  }
  const parts = f.formatToParts(at).find((p) => p.type === 'timeZoneName')?.value;
  const m = parts?.match(/GMT([+-])(\d{2}):?(\d{2})?/);
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 3_600_000 + Number(m[3] ?? 0) * 60_000);
}

/** The instant a wall-clock time (`Date.UTC` fields read as local time) has in the given time zone. */
export function zonedToInstant(wallUtc: number, timeZone: string): number {
  return wallUtc - offsetMs(wallUtc - offsetMs(wallUtc, timeZone), timeZone);
}

/** `[start, end)` instants of a calendar day in the given time zone. */
export function dayRange(day: string, timeZone: string): [number, number] {
  const [y, mo, d] = day.split('-').map(Number) as [number, number, number];
  return [
    zonedToInstant(Date.UTC(y, mo - 1, d), timeZone),
    zonedToInstant(Date.UTC(y, mo - 1, d + 1), timeZone),
  ];
}

/** The last `count` calendar days ending with the day containing `now`, oldest first. */
export function lastDays(count: number, now: number, timeZone: string): string[] {
  const today = dayKey(now, timeZone);
  return Array.from({ length: count }, (_, i) => addDays(today, i - count + 1));
}

const zoneNames = new Map<string, Intl.DateTimeFormat>();

/** Short name of the zone at an instant, e.g. "CET", "CEST" or "GMT+2" where no abbreviation exists. */
export function zoneAbbreviation(at: number, timeZone: string): string {
  let f = zoneNames.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' });
    zoneNames.set(timeZone, f);
  }
  return f.formatToParts(at).find((p) => p.type === 'timeZoneName')?.value ?? timeZone;
}
