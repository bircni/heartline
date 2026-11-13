import { describe, expect, it } from 'vitest';
import { authorizeUrlFrom, isOAuthContinuation } from './auth.ts';
import { dayTicks, duration, ms, pct, relative, timeTicks } from './format.ts';

describe('format', () => {
  it('formats percentages and latency', () => {
    expect(pct(100)).toBe('100%');
    expect(pct(99.714)).toBe('99.71%');
    expect(pct(null)).toBe('–');
    expect(ms(120)).toBe('120 ms');
    expect(ms(1500)).toBe('1.5 s');
  });
  it('formats relative times and durations', () => {
    const now = 1_000_000_000;
    expect(relative(now - 30_000, now)).toBe('30 s ago');
    expect(relative(now - 2 * 3_600_000, now)).toBe('2 h ago');
    expect(relative(null, now)).toBe('never');
    expect(duration(0, 42 * 60_000)).toBe('42 min');
    expect(duration(0, 65 * 60_000)).toBe('1 h 5 min');
  });
});

describe('oauth continuation', () => {
  const search = '?response_type=code&client_id=abc&scope=status%3Aread&sig=xyz&exp=123&ba_iat=1';
  it('detects the signed query from the OAuth provider', () => {
    expect(isOAuthContinuation(search)).toBe(true);
    expect(isOAuthContinuation('?next=/admin')).toBe(false);
  });
  it('rebuilds the original authorize request without signature parameters', () => {
    expect(authorizeUrlFrom(search)).toBe(
      '/api/auth/oauth2/authorize?response_type=code&client_id=abc&scope=status%3Aread',
    );
  });
});

/** Consecutive local calendar days as `YYYY-MM-DD`. */
const run = (first: string, count: number) =>
  Array.from({ length: count }, (_, i) => {
    const d = new Date(`${first}T00:00:00`);
    d.setDate(d.getDate() + i);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });

describe('axis ticks', () => {
  it('marks month starts on a 90-day axis, between two day marks', () => {
    const days = run('2026-08-13', 90);
    const ticks = dayTicks(days);
    // The range starts mid-month, so the left edge is labelled, followed by Sep 1, Oct 1 and Nov 1.
    expect(ticks.map((t) => Math.round(t.pos * 90))).toEqual([0, 19, 49, 80]);
    expect(days[19]).toBe('2026-09-01');
  });

  it('marks every day of a week and Mondays of a month', () => {
    expect(dayTicks(run('2026-11-04', 7))).toHaveLength(6);
    const month = dayTicks(run('2026-10-12', 30));
    // 2026-10-12 is a Monday; the following Mondays are 7, 14, 21 and 28 days in.
    expect(month.map((t) => Math.round(t.pos * 30))).toEqual([0, 7, 14, 21, 28]);
  });

  it('returns nothing for an empty range', () => {
    expect(dayTicks([])).toEqual([]);
    expect(timeTicks(5, 5)).toEqual([]);
  });
});

describe('site time zone', () => {
  it('formats inputs and ticks in the given zone, whatever zone the browser is in', async () => {
    const { fromZonedInput, timeTicks, toZonedInput } = await import('./format.ts');
    // 2026-04-05 03:00 in Auckland is the end of daylight saving time (NZDT → NZST).
    const at = Date.UTC(2026, 3, 4, 11, 30); // 2026-04-05 00:30 NZDT (UTC+13)
    expect(toZonedInput(at, 'Pacific/Auckland')).toBe('2026-04-05T00:30');
    expect(fromZonedInput('2026-04-05T00:30', 'Pacific/Auckland')).toBe(at);
    // After the change the offset is +12.
    expect(fromZonedInput('2026-04-06T00:30', 'Pacific/Auckland')).toBe(Date.UTC(2026, 3, 5, 12, 30));
    expect(toZonedInput(Date.UTC(2026, 10, 13, 23, 30), 'Europe/Berlin')).toBe('2026-11-14T00:30');

    // A week in Auckland: the first tick is the first local midnight, 11:00 UTC (NZDT +13 → midnight at 11:00).
    const from = Date.UTC(2026, 10, 9, 11); // 2026-11-10 00:00 NZDT
    const ticks = timeTicks(from, from + 7 * 86_400_000, undefined, 'Pacific/Auckland');
    expect(ticks).toHaveLength(6);
    expect(ticks[0]!.pos).toBeCloseTo(1 / 7, 5);
    expect(ticks[0]!.label).toBe(
      new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: 'UTC' }).format(
        Date.UTC(2026, 10, 11),
      ),
    );
  });

  it('labels the zone', async () => {
    const { setDisplayTimeZone, zoneLabel, displayTimeZone, dateTime } = await import('./format.ts');
    setDisplayTimeZone('Europe/Berlin');
    expect(displayTimeZone()).toBe('Europe/Berlin');
    expect(zoneLabel(Date.UTC(2026, 0, 15))).toMatch(/^Europe\/Berlin \((CET|GMT\+1)\)$/);
    expect(dateTime(Date.UTC(2026, 0, 15, 23, 30))).toMatch(/00:30/);
    // An unknown zone falls back to the browser's.
    setDisplayTimeZone('Not/AZone');
    expect(displayTimeZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    setDisplayTimeZone(undefined);
  });
});
