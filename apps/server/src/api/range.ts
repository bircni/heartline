import type { Context } from 'hono';
import { dayRange } from '../util/time.ts';
import { BadRequestError, daysParam } from './errors.ts';

/**
 * End of a range whose last day is `to` (`YYYY-MM-DD` in the site time zone): the end of that day, or
 * `now` when the day is today, in the future or not given.
 */
export function rangeEndParam(value: string | undefined, timeZone: string, now = Date.now()): number {
  if (!value) return now;
  // The round trip rejects days that do not exist, such as 2026-02-31, which Date.parse rolls over.
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : null;
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value)
    throw new BadRequestError('to must be a date like 2026-01-31');
  return Math.min(now, dayRange(value, timeZone)[1] - 1);
}

/** The history range of a request: `days` (1 to 365, else `fallback`) ending with the day `to`. */
export function rangeParams(
  c: Context,
  timeZone: string,
  fallback: number,
): { days: number; end: number; to: string | undefined } {
  const to = c.req.query('to');
  return { days: daysParam(c.req.query('days'), fallback), end: rangeEndParam(to, timeZone), to };
}
