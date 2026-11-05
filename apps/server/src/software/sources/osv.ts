import { labelToScore, scoreFromVector } from '../cvss.ts';
import { cleanVersion, compareVersions } from '../version.ts';
import { type SourceOpts, fetchCached } from './cache.ts';

export const OSV_BASE = 'https://api.osv.dev/v1';
const QUERY_TTL = 6 * 3_600_000;
const VULN_TTL = 7 * 86_400_000;

export interface OsvRange {
  introduced: string | null;
  fixed: string | null;
}

export interface OsvVuln {
  id: string;
  aliases: string[];
  summary: string | null;
  vector: string | null;
  score: number | null;
  severityLabel: string | null;
  published: number | null;
  modified: number | null;
  references: string[];
  /** Version ranges of SEMVER/ECOSYSTEM type; GIT ranges are ignored. */
  ranges: OsvRange[];
  /** Explicitly listed affected versions. */
  versions: string[];
  /** The advisory only carries ranges we cannot evaluate (GIT commits). */
  unsupportedRangesOnly: boolean;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const date = (v: unknown): number | null => {
  const t = typeof v === 'string' ? Date.parse(v) : Number.NaN;
  return Number.isFinite(t) ? t : null;
};

export function parseOsvVuln(json: unknown): OsvVuln {
  const o = (json ?? {}) as Record<string, unknown>;
  const severities = Array.isArray(o.severity) ? (o.severity as Record<string, unknown>[]) : [];
  let vector: string | null = null;
  let score: number | null = null;
  for (const s of severities) {
    const v = str(s.score);
    if (!v) continue;
    const computed = scoreFromVector(v);
    if (computed !== null && (score === null || computed > score)) {
      score = computed;
      vector = v;
    } else if (vector === null) vector = v;
  }
  const dbSpecific = (o.database_specific ?? {}) as Record<string, unknown>;
  const severityLabel = str(dbSpecific.severity);
  if (score === null) score = labelToScore(severityLabel);

  const ranges: OsvRange[] = [];
  const versions: string[] = [];
  let unsupported = 0;
  for (const a of Array.isArray(o.affected) ? (o.affected as Record<string, unknown>[]) : []) {
    for (const r of Array.isArray(a.ranges) ? (a.ranges as Record<string, unknown>[]) : []) {
      if (r.type !== 'SEMVER' && r.type !== 'ECOSYSTEM') {
        unsupported++;
        continue;
      }
      let current: OsvRange = { introduced: null, fixed: null };
      for (const e of Array.isArray(r.events) ? (r.events as Record<string, unknown>[]) : []) {
        if (typeof e.introduced === 'string') {
          if (current.introduced !== null || current.fixed !== null) ranges.push(current);
          current = { introduced: e.introduced === '0' ? '0' : cleanVersion(e.introduced), fixed: null };
        } else if (typeof e.fixed === 'string') {
          current.fixed = cleanVersion(e.fixed);
          ranges.push(current);
          current = { introduced: null, fixed: null };
        } else if (typeof e.last_affected === 'string') {
          ranges.push(current);
          current = { introduced: null, fixed: null };
        }
      }
      if (current.introduced !== null) ranges.push(current);
    }
    for (const v of Array.isArray(a.versions) ? (a.versions as unknown[]) : [])
      if (typeof v === 'string') versions.push(cleanVersion(v));
  }
  return {
    id: str(o.id) ?? 'UNKNOWN',
    aliases: Array.isArray(o.aliases)
      ? (o.aliases as unknown[]).filter((x): x is string => typeof x === 'string')
      : [],
    summary: str(o.summary) ?? str(o.details)?.split('\n')[0]?.slice(0, 300) ?? null,
    vector,
    score,
    severityLabel,
    published: date(o.published),
    modified: date(o.modified),
    references: (Array.isArray(o.references) ? (o.references as Record<string, unknown>[]) : [])
      .map((r) => str(r.url))
      .filter((u): u is string => u !== null)
      .slice(0, 10),
    ranges,
    versions,
    unsupportedRangesOnly: unsupported > 0 && ranges.length === 0 && versions.length === 0,
  };
}

export function parseOsvQuery(text: string): OsvVuln[] {
  const o = JSON.parse(text) as { vulns?: unknown[] };
  return (o.vulns ?? []).map(parseOsvVuln);
}

/** Confirms client-side that `version` falls in one of the vulnerability's ranges. */
export function matchedRange(v: OsvVuln, version: string): OsvRange | null {
  for (const r of v.ranges) {
    const afterStart = !r.introduced || r.introduced === '0' || compareVersions(version, r.introduced) >= 0;
    const beforeFix = !r.fixed || compareVersions(version, r.fixed) < 0;
    if (afterStart && beforeFix) return r;
  }
  if (v.versions.some((x) => compareVersions(x, version) === 0)) return { introduced: version, fixed: null };
  // No version information at all: trust OSV's own match. Commit-only ranges cannot be checked, skip them.
  if (v.ranges.length === 0 && v.versions.length === 0 && !v.unsupportedRangesOnly)
    return { introduced: null, fixed: null };
  return null;
}

/** The lowest fixed version above `version` across all ranges, if any. */
export function fixedAfter(v: OsvVuln, version: string): string | null {
  const fixes = v.ranges
    .map((r) => r.fixed)
    .filter((f): f is string => f !== null && compareVersions(f, version) > 0)
    .toSorted(compareVersions);
  return fixes[0] ?? null;
}

export class OsvClient {
  #opts: SourceOpts;
  constructor(opts: SourceOpts) {
    this.#opts = opts;
  }

  async query(pkg: { ecosystem: string; name: string }, version: string): Promise<OsvVuln[]> {
    const key = `osv:q:${pkg.ecosystem}:${pkg.name}:${version}`;
    const body = JSON.stringify({ package: { ecosystem: pkg.ecosystem, name: pkg.name }, version });
    const res = await fetchCached(
      key,
      `${OSV_BASE}/query`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body },
      QUERY_TTL,
      parseOsvQuery,
      this.#opts,
    );
    return res.data;
  }

  async vuln(id: string): Promise<OsvVuln> {
    const res = await fetchCached(
      `osv:v:${id}`,
      `${OSV_BASE}/vulns/${encodeURIComponent(id)}`,
      { method: 'GET' },
      VULN_TTL,
      (t) => parseOsvVuln(JSON.parse(t)),
      this.#opts,
    );
    return res.data;
  }
}
