const formatters = new Map<string, Intl.DateTimeFormat>();

function dayFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Calendar day (`YYYY-MM-DD`) of an instant in the given time zone. */
export function dayKey(at: number, timeZone: string): string {
  return dayFormatter(timeZone).format(at);
}

function offsetMs(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName')?.value;
  const m = parts?.match(/GMT([+-])(\d{2}):?(\d{2})?/);
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 3_600_000 + Number(m[3] ?? 0) * 60_000);
}

/** `[start, end)` instants of a calendar day in the given time zone. */
export function dayRange(day: string, timeZone: string): [number, number] {
  const [y, mo, d] = day.split('-').map(Number) as [number, number, number];
  const utcMidnight = Date.UTC(y, mo - 1, d);
  const start = utcMidnight - offsetMs(utcMidnight - offsetMs(utcMidnight, timeZone), timeZone);
  const nextUtc = Date.UTC(y, mo - 1, d + 1);
  const end = nextUtc - offsetMs(nextUtc - offsetMs(nextUtc, timeZone), timeZone);
  return [start, end];
}

/** The last `count` calendar days ending with the day containing `now`, oldest first. */
export function lastDays(count: number, now: number, timeZone: string): string[] {
  const days: string[] = [];
  const today = dayKey(now, timeZone);
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  for (let i = count - 1; i >= 0; i--) {
    const dt = new Date(Date.UTC(y, m - 1, d - i));
    days.push(dt.toISOString().slice(0, 10));
  }
  return days;
}
