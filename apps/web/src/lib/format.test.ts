import { describe, expect, it } from 'vitest';
import { authorizeUrlFrom, isOAuthContinuation } from './auth.ts';
import { duration, ms, pct, relative } from './format.ts';

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
