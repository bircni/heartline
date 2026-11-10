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
