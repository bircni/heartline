import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context, MiddlewareHandler } from 'hono';
import { sql } from 'kysely';
import type { Vars } from '../auth/principal.ts';
import type { AppContext } from '../context.ts';
import type { Db } from '../db/index.ts';
import { log } from '../util/log.ts';

export interface Bucket {
  max: number;
  /** Window length in ms. */
  window: number;
}

/**
 * The client's IP. Behind a reverse proxy every request comes from the proxy, so with `trustProxy` the first
 * address of X-Forwarded-For is used instead.
 */
export function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
    if (forwarded) return forwarded;
    const real = c.req.header('x-real-ip')?.trim();
    if (real) return real;
  }
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    // In-process requests (tests) have no socket.
    return 'unknown';
  }
}

/** Fixed-window counters. */
export interface RateStore {
  /** Counts one hit and returns the count in the current window. */
  hit(key: string, windowStart: number): Promise<number>;
  prune(before: number): Promise<void>;
}

/** Per-process counters: cheap, but each replica counts on its own. */
export class MemoryRateStore implements RateStore {
  readonly #hits = new Map<string, { start: number; count: number }>();

  async hit(key: string, windowStart: number): Promise<number> {
    const cur = this.#hits.get(key);
    const next =
      cur && cur.start === windowStart
        ? { start: windowStart, count: cur.count + 1 }
        : { start: windowStart, count: 1 };
    this.#hits.set(key, next);
    return next.count;
  }

  async prune(before: number): Promise<void> {
    for (const [k, v] of this.#hits) if (v.start < before) this.#hits.delete(k);
  }
}

/** Counters in the database, so every replica shares them. One atomic statement per hit. */
export class DbRateStore implements RateStore {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  async hit(key: string, windowStart: number): Promise<number> {
    const row = await this.#db.kysely
      .insertInto('rate_limits')
      .values({ key, window_start: windowStart, count: 1 })
      .onConflict((oc) =>
        oc.column('key').doUpdateSet({
          count: sql<number>`case when rate_limits.window_start = excluded.window_start then rate_limits.count + 1 else 1 end`,
          window_start: sql<number>`excluded.window_start`,
        }),
      )
      .returning('count')
      .executeTakeFirstOrThrow();
    return Number(row.count);
  }

  async prune(before: number): Promise<void> {
    await this.#db.kysely.deleteFrom('rate_limits').where('window_start', '<', before).execute();
  }
}

export class RateLimiter {
  readonly memory = new MemoryRateStore();
  readonly shared: RateStore;

  constructor(db: Db) {
    this.shared = new DbRateStore(db);
  }

  /** Counts a hit; returns the seconds to wait when the bucket is exhausted, else null. */
  async take(store: RateStore, key: string, bucket: Bucket, now = Date.now()): Promise<number | null> {
    const start = Math.floor(now / bucket.window) * bucket.window;
    const count = await store.hit(key, start);
    return count > bucket.max ? Math.max(1, Math.ceil((start + bucket.window - now) / 1000)) : null;
  }

  /** Drops counters of windows that ended before `now - maxWindow`. */
  async prune(maxWindowMs: number, now = Date.now()): Promise<void> {
    await this.memory.prune(now - maxWindowMs);
    await this.shared.prune(now - maxWindowMs);
  }
}

function tooMany(c: Context, retryAfter: number): Response {
  c.header('retry-after', String(retryAfter));
  return c.json({ error: 'Too many requests. Try again in a moment.' }, 429);
}

/**
 * Limits a bucket per client IP. `shared` buckets are counted in the database (security limits that must hold
 * across replicas); others per process (load shedding).
 */
export function rateLimit(
  app: AppContext,
  name: 'public' | 'auth' | (string & {}),
  opts: { shared: boolean; bucket?: () => Bucket; skip?: (c: Context<Vars>) => boolean },
): MiddlewareHandler<Vars> {
  return async (c, next) => {
    const cfg = app.config().rateLimit;
    if (!cfg.enabled || opts.skip?.(c)) return next();
    const bucket = opts.bucket?.() ?? (name === 'auth' ? cfg.auth : cfg.public);
    const key = `${name}:${clientIp(c, cfg.trustProxy)}`;
    let wait: number | null = null;
    try {
      wait = await app.rateLimiter.take(
        opts.shared ? app.rateLimiter.shared : app.rateLimiter.memory,
        key,
        bucket,
      );
    } catch (error) {
      // A database hiccup must not lock everyone out.
      log.warn('rate limit check failed; allowing the request', { bucket: name, error });
    }
    if (wait !== null) return tooMany(c, wait);
    return next();
  };
}
