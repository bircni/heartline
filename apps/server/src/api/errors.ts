import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError, z } from 'zod';
import { ConflictError, NotFoundError, ValidationError } from '../services/monitors.ts';
import { log } from '../util/log.ts';
import { dayRange } from '../util/time.ts';

export class BadRequestError extends Error {}
export class ForbiddenError extends Error {}

export function onError(error: Error, c: Context): Response {
  if (error instanceof HTTPException) return error.getResponse();
  if (error instanceof ZodError) return c.json({ error: z.prettifyError(error) }, 400);
  if (error instanceof NotFoundError) return c.json({ error: error.message }, 404);
  if (error instanceof ConflictError) return c.json({ error: error.message }, 409);
  if (error instanceof BadRequestError || error instanceof ValidationError)
    return c.json({ error: error.message }, 400);
  if (error instanceof ForbiddenError) return c.json({ error: error.message }, 403);
  log.error('unhandled request error', { path: c.req.path, error: error.stack ?? error.message });
  return c.json({ error: 'Internal server error' }, 500);
}

export async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.output<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new BadRequestError('request body must be JSON');
  }
  return schema.parse(raw);
}

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

export function daysParam(value: string | undefined, fallback: number): number {
  const n = value ? Number.parseInt(value, 10) : fallback;
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, 365);
}
