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
