import type { VulnSeverity } from '@heartline/shared';
import { severityFromScore } from '../cvss.ts';
import { cleanVersion, compareVersions } from '../version.ts';
import { type SourceOpts, fetchCached } from './cache.ts';

export const NVD_BASE = 'https://services.nvd.nist.gov/rest/json/cves/2.0';
const TTL = 12 * 3_600_000;
const PAGE = 200;

export interface NvdMatch {
  criteria: string;
  vulnerable: boolean;
  versionStartIncluding: string | null;
  versionStartExcluding: string | null;
  versionEndIncluding: string | null;
  versionEndExcluding: string | null;
}

export interface NvdCve {
  id: string;
  summary: string | null;
  score: number | null;
  vector: string | null;
  severity: VulnSeverity;
  published: number | null;
  modified: number | null;
  references: string[];
  matches: NvdMatch[];
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const date = (v: unknown): number | null => {
  const t = typeof v === 'string' ? Date.parse(v) : Number.NaN;
  return Number.isFinite(t) ? t : null;
};

function pickMetric(metrics: Record<string, unknown>): { score: number | null; vector: string | null } {
  for (const key of ['cvssMetricV40', 'cvssMetricV31', 'cvssMetricV30', 'cvssMetricV2']) {
    const list = metrics[key];
    if (!Array.isArray(list) || list.length === 0) continue;
    const primary =
      (list as Record<string, unknown>[]).find((m) => m.type === 'Primary') ??
      (list[0] as Record<string, unknown>);
    const data = (primary.cvssData ?? {}) as Record<string, unknown>;
    const score = typeof data.baseScore === 'number' ? data.baseScore : null;
    if (score !== null) return { score, vector: str(data.vectorString) };
  }
  return { score: null, vector: null };
}

export function parseNvdResponse(text: string): { cves: NvdCve[]; total: number } {
  const o = JSON.parse(text) as {
    totalResults?: number;
    vulnerabilities?: { cve?: Record<string, unknown> }[];
  };
  const cves = (o.vulnerabilities ?? []).map(({ cve = {} }) => {
    const { score, vector } = pickMetric((cve.metrics ?? {}) as Record<string, unknown>);
    const descriptions = Array.isArray(cve.descriptions)
      ? (cve.descriptions as Record<string, unknown>[])
      : [];
    const matches: NvdMatch[] = [];
    for (const cfg of Array.isArray(cve.configurations)
      ? (cve.configurations as Record<string, unknown>[])
      : [])
      for (const node of Array.isArray(cfg.nodes) ? (cfg.nodes as Record<string, unknown>[]) : [])
        for (const m of Array.isArray(node.cpeMatch) ? (node.cpeMatch as Record<string, unknown>[]) : [])
          matches.push({
            criteria: str(m.criteria) ?? '',
            vulnerable: Boolean(m.vulnerable),
            versionStartIncluding: str(m.versionStartIncluding),
            versionStartExcluding: str(m.versionStartExcluding),
            versionEndIncluding: str(m.versionEndIncluding),
            versionEndExcluding: str(m.versionEndExcluding),
          });
    return {
      id: str(cve.id) ?? 'UNKNOWN',
      summary:
        (descriptions.find((d) => d.lang === 'en')?.value as string | undefined)?.slice(0, 300) ?? null,
      score,
      vector,
      severity: severityFromScore(score),
      published: date(cve.published),
      modified: date(cve.lastModified),
      references: (Array.isArray(cve.references) ? (cve.references as Record<string, unknown>[]) : [])
        .map((r) => str(r.url))
        .filter((u): u is string => u !== null)
        .slice(0, 10),
      matches,
    };
  });
  return { cves, total: typeof o.totalResults === 'number' ? o.totalResults : cves.length };
}

/** Client-side confirmation that the CVE applies to `vendor:product` at `version`; returns the fix version. */
export function cveAffects(
  cve: NvdCve,
  cpePrefix: string,
  version: string,
): { fixedIn: string | null } | null {
  const prefix = `cpe:2.3:a:${cpePrefix}:`;
  const prefixAny = `cpe:2.3:${cpePrefix.split(':')[0]}`;
  let hit: { fixedIn: string | null } | null = null;
  for (const m of cve.matches) {
    if (!m.vulnerable) continue;
    if (
      !m.criteria.startsWith(prefix) &&
      !(m.criteria.includes(`:${cpePrefix}:`) && m.criteria.startsWith(prefixAny))
    )
      continue;
    const cpeVersion = m.criteria.split(':')[5] ?? '*';
    const exact = cpeVersion !== '*' && cpeVersion !== '-' ? cleanVersion(cpeVersion) : null;
    let ok = exact ? compareVersions(exact, version) === 0 : true;
    if (m.versionStartIncluding && compareVersions(version, m.versionStartIncluding) < 0) ok = false;
    if (m.versionStartExcluding && compareVersions(version, m.versionStartExcluding) <= 0) ok = false;
    if (m.versionEndIncluding && compareVersions(version, m.versionEndIncluding) > 0) ok = false;
    if (m.versionEndExcluding && compareVersions(version, m.versionEndExcluding) >= 0) ok = false;
    if (!ok) continue;
    const fixedIn = m.versionEndExcluding ? cleanVersion(m.versionEndExcluding) : null;
    if (!hit || (fixedIn && !hit.fixedIn)) hit = { fixedIn };
  }
  return hit;
}

export class NvdClient {
  #opts: SourceOpts;
  #apiKey: string | null;
  constructor(opts: SourceOpts, apiKey: string | null) {
    this.#opts = opts;
    this.#apiKey = apiKey;
  }

  /** All CVEs matching the exact CPE `cpe:2.3:a:vendor:product:version`. */
  async byCpe(cpePrefix: string, version: string): Promise<NvdCve[]> {
    const cpeName = `cpe:2.3:a:${cpePrefix}:${version}:*:*:*:*:*:*:*`;
    const headers: Record<string, string> = this.#apiKey ? { apiKey: this.#apiKey } : {};
    const all: NvdCve[] = [];
    let start = 0;
    for (let page = 0; page < 10; page++) {
      const url = `${NVD_BASE}?cpeName=${encodeURIComponent(cpeName)}&resultsPerPage=${PAGE}&startIndex=${start}`;
      const res = await fetchCached(
        `nvd:${cpeName}:${start}`,
        url,
        { method: 'GET', headers },
        TTL,
        parseNvdResponse,
        this.#opts,
      );
      all.push(...res.data.cves);
      start += PAGE;
      if (start >= res.data.total || res.data.cves.length === 0) break;
    }
    return all;
  }
}
