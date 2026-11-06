import { cleanVersion, compareVersions, sameCycle } from '../version.ts';
import { type SourceOpts, fetchCached } from './cache.ts';

export const EOL_BASE = 'https://endoflife.date/api';
const TTL = 24 * 3_600_000;

export interface EolCycle {
  cycle: string;
  latest: string | null;
  latestReleaseDate: string | null;
  releaseDate: string | null;
  /** ISO date, boolean, or null when unknown. */
  eol: string | boolean | null;
  lts: string | boolean | null;
}

export function parseCycles(text: string): EolCycle[] {
  const raw = JSON.parse(text) as unknown;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null)
    .map((c) => ({
      cycle: String(c.cycle ?? ''),
      latest: typeof c.latest === 'string' && c.latest ? cleanVersion(c.latest) : null,
      latestReleaseDate: typeof c.latestReleaseDate === 'string' ? c.latestReleaseDate : null,
      releaseDate: typeof c.releaseDate === 'string' ? c.releaseDate : null,
      eol: typeof c.eol === 'string' || typeof c.eol === 'boolean' ? c.eol : null,
      lts: typeof c.lts === 'string' || typeof c.lts === 'boolean' ? c.lts : null,
    }))
    .filter((c) => c.cycle);
}

export interface ResolvedCycle {
  cycle: EolCycle | null;
  latest: string | null;
  latestInCycle: string | null;
  /** `YYYY-MM-DD`, `true`, `false` or null. */
  eol: string | null;
}

/** Finds the running release cycle and the newest versions overall and within that cycle. */
export function resolveCycle(cycles: EolCycle[], version: string | null): ResolvedCycle {
  let latest: string | null = null;
  for (const c of cycles)
    if (c.latest && (!latest || compareVersions(c.latest, latest) > 0)) latest = c.latest;
  if (!version) return { cycle: null, latest, latestInCycle: null, eol: null };
  const matches = cycles
    .filter((c) => sameCycle(version, c.cycle))
    .toSorted((a, b) => b.cycle.split('.').length - a.cycle.split('.').length);
  const cycle = matches[0] ?? null;
  const eol = cycle === null || cycle.eol === null ? null : String(cycle.eol);
  return { cycle, latest, latestInCycle: cycle?.latest ?? null, eol };
}

export class EndoflifeClient {
  #opts: SourceOpts;
  constructor(opts: SourceOpts) {
    this.#opts = opts;
  }

  async product(slug: string): Promise<EolCycle[]> {
    const res = await fetchCached(
      `eol:${slug}`,
      `${EOL_BASE}/${encodeURIComponent(slug)}.json`,
      { method: 'GET', headers: { accept: 'application/json' } },
      TTL,
      parseCycles,
      this.#opts,
    );
    return res.data;
  }
}
