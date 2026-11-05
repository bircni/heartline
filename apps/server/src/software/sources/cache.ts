import type { Db } from '../../db/index.ts';
import type { IntelCacheTable } from '../../db/schema.ts';
import { errorMessage } from '../../checks/types.ts';

export class SourceUnavailable extends Error {}

/** Serialises calls to one upstream with a minimum spacing. */
export class RateGate {
  #minSpacingMs: number;
  #next = 0;
  #chain: Promise<void> = Promise.resolve();

  constructor(minSpacingMs: number) {
    this.#minSpacingMs = minSpacingMs;
  }

  wait(signal?: AbortSignal): Promise<void> {
    const run = this.#chain.then(async () => {
      const delay = this.#next - Date.now();
      if (delay > 0) {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, delay);
          t.unref();
          signal?.addEventListener(
            'abort',
            () => {
              clearTimeout(t);
              reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
            },
            { once: true },
          );
        });
      }
      this.#next = Date.now() + this.#minSpacingMs;
    });
    this.#chain = run.catch(() => {});
    return run;
  }
}

export class IntelCache {
  #db: Db;
  constructor(db: Db) {
    this.#db = db;
  }

  get(key: string): Promise<IntelCacheTable | undefined> {
    return this.#db.kysely.selectFrom('intel_cache').selectAll().where('key', '=', key).executeTakeFirst();
  }

  async put(
    key: string,
    row: { etag: string | null; body: string; status: 'ok' | 'error'; error: string | null; ttlMs: number },
    now = Date.now(),
  ): Promise<void> {
    const values = {
      etag: row.etag,
      body: row.body,
      fetched_at: now,
      expires_at: now + row.ttlMs,
      status: row.status,
      error: row.error,
    };
    await this.#db.kysely
      .insertInto('intel_cache')
      .values({ key, ...values })
      .onConflict((oc) => oc.column('key').doUpdateSet(values))
      .execute();
  }

  async touch(key: string, now = Date.now()): Promise<void> {
    await this.put(key, { etag: null, body: '', status: 'ok', error: null, ttlMs: 0 }, now);
  }

  async delete(key: string): Promise<void> {
    await this.#db.kysely.deleteFrom('intel_cache').where('key', '=', key).execute();
  }
}

export interface SourceOpts {
  fetchImpl: typeof fetch;
  cache: IntelCache;
  gate: RateGate;
  userAgent: string;
  signal?: AbortSignal;
  now?: () => number;
}

export interface Cached<T> {
  data: T;
  /** Served from an expired cache entry because the source failed. */
  stale: boolean;
  fromCache: boolean;
}

const NEGATIVE_TTL = 15 * 60_000;
const TIMEOUT = 15_000;

/**
 * Fetches `url` through the persistent cache: fresh entries are served without a request, expired
 * ones are revalidated with `If-None-Match`, failures serve the stale copy and are negative-cached for
 * 15 minutes. Throws `SourceUnavailable` when the source fails and nothing is cached.
 */
export async function fetchCached<T>(
  key: string,
  url: string,
  init: RequestInit,
  ttlMs: number,
  parse: (text: string) => T,
  opts: SourceOpts,
): Promise<Cached<T>> {
  const now = opts.now?.() ?? Date.now();
  const cached = await opts.cache.get(key);
  if (cached && cached.expires_at > now) {
    if (cached.status === 'ok') return { data: parse(cached.body), stale: false, fromCache: true };
    throw new SourceUnavailable(cached.error ?? 'source unavailable (cached failure)');
  }
  const stale = cached?.status === 'ok' ? cached : undefined;
  const staleBody = stale?.body ?? (cached && cached.body ? cached.body : null);
  try {
    await opts.gate.wait(opts.signal);
    const headers = new Headers(init.headers);
    headers.set('user-agent', opts.userAgent);
    if (stale?.etag) headers.set('if-none-match', stale.etag);
    const res = await opts.fetchImpl(url, {
      ...init,
      headers,
      signal: AbortSignal.any([AbortSignal.timeout(TIMEOUT), ...(opts.signal ? [opts.signal] : [])]),
    });
    if (res.status === 304 && stale) {
      await res.body?.cancel();
      await opts.cache.put(
        key,
        { etag: stale.etag, body: stale.body, status: 'ok', error: null, ttlMs },
        now,
      );
      return { data: parse(stale.body), stale: false, fromCache: true };
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}${res.status === 429 ? ' (rate limited)' : ''}`);
    const data = parse(text);
    await opts.cache.put(
      key,
      { etag: res.headers.get('etag'), body: text, status: 'ok', error: null, ttlMs },
      now,
    );
    return { data, stale: false, fromCache: false };
  } catch (error) {
    const message = errorMessage(error);
    await opts.cache.put(
      key,
      {
        etag: stale?.etag ?? null,
        body: staleBody ?? '',
        status: 'error',
        error: message,
        ttlMs: NEGATIVE_TTL,
      },
      now,
    );
    if (staleBody) {
      try {
        return { data: parse(staleBody), stale: true, fromCache: true };
      } catch {
        /* fall through */
      }
    }
    throw new SourceUnavailable(message);
  }
}
