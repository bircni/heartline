import { type SourceOpts, fetchCached } from './cache.ts';

export const KEV_URL = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';
export const KEV_CACHE_KEY = 'kev';

/** CVE ids from CISA's Known Exploited Vulnerabilities feed (or from the compact cached form). */
export function parseKev(text: string): string[] {
  const raw = JSON.parse(text) as unknown;
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === 'string');
  const list = (raw as { vulnerabilities?: { cveID?: unknown }[] }).vulnerabilities ?? [];
  return list.map((v) => v.cveID).filter((x): x is string => typeof x === 'string');
}

export class KevClient {
  #opts: SourceOpts;
  #ttlMs: number;
  constructor(opts: SourceOpts, ttlMs = 24 * 3_600_000) {
    this.#opts = opts;
    this.#ttlMs = ttlMs;
  }

  async ids(): Promise<Set<string>> {
    const res = await fetchCached(
      KEV_CACHE_KEY,
      KEV_URL,
      { method: 'GET' },
      this.#ttlMs,
      parseKev,
      this.#opts,
    );
    if (!res.fromCache) {
      // Store the compact id list instead of the multi-megabyte feed.
      await this.#opts.cache.put(KEV_CACHE_KEY, {
        etag: null,
        body: JSON.stringify(res.data),
        status: 'ok',
        error: null,
        ttlMs: this.#ttlMs,
      });
    }
    return new Set(res.data.map((id) => id.toUpperCase()));
  }
}
