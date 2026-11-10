import { isDayKey } from '@heartline/shared';
import type { Context } from 'hono';
import { dayRange } from '../util/time.ts';
import { BadRequestError, daysParam } from './errors.ts';

/**
 * End of a range whose last day is `to` (`YYYY-MM-DD` in the site time zone): the end of that day, or
 * `now` when the day is today, in the future or not given.
 */
function rangeEndParam(value: string | undefined, timeZone: string, now = Date.now()): number {
  if (!value) return now;
  if (!isDayKey(value)) throw new BadRequestError('to must be a date like 2026-01-31');
  return Math.min(now, dayRange(value, timeZone)[1] - 1);
}

/**
 * The history range of a request: `days` (1 to MAX_RANGE_DAYS, else `fallback`) ending with the day `to`.
 */
export function rangeParams(
  c: Context,
  timeZone: string,
  fallback: number,
): { days: number; end: number; to: string | undefined } {
  const to = c.req.query('to');
  return { days: daysParam(c.req.query('days'), fallback), end: rangeEndParam(to, timeZone), to };
}
