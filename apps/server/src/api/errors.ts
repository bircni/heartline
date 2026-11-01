import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError, z } from 'zod';
import { ConflictError, NotFoundError } from '../services/monitors.ts';
import { log } from '../util/log.ts';

export class BadRequestError extends Error {}
export class ForbiddenError extends Error {}

export function onError(error: Error, c: Context): Response {
  if (error instanceof HTTPException) return error.getResponse();
  if (error instanceof ZodError) return c.json({ error: z.prettifyError(error) }, 400);
  if (error instanceof NotFoundError) return c.json({ error: error.message }, 404);
  if (error instanceof ConflictError) return c.json({ error: error.message }, 409);
  if (error instanceof BadRequestError) return c.json({ error: error.message }, 400);
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

export function daysParam(value: string | undefined, fallback: number): number {
  const n = value ? Number.parseInt(value, 10) : fallback;
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, 365);
}
