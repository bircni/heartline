import type { VulnSeverity } from '@heartline/shared';
import { severityFromScore } from '../cvss.ts';
import type { NvdCve } from './nvd.ts';
import type { OsvRange, OsvVuln } from './osv.ts';

export interface MatchedVuln {
  id: string;
  aliases: string[];
  summary: string | null;
  score: number | null;
  vector: string | null;
  severity: VulnSeverity;
  kev: boolean;
  fixedIn: string | null;
  introduced: string | null;
  published: number | null;
  modified: number | null;
  references: string[];
  sources: ('osv' | 'nvd')[];
}

const CVE = /^CVE-\d{4}-\d{4,}$/i;

export function canonicalId(id: string, aliases: string[]): string {
  const cve = [id, ...aliases].find((a) => CVE.test(a));
  return (cve ?? id).toUpperCase();
}

const union = <T>(a: T[], b: T[]): T[] => [...new Set([...a, ...b])];

interface Finding {
  id: string;
  aliases: string[];
  summary: string | null;
  score: number | null;
  vector: string | null;
  fixedIn: string | null;
  introduced: string | null;
  published: number | null;
  modified: number | null;
  references: string[];
  source: 'osv' | 'nvd';
}

function fold(out: Map<string, MatchedVuln>, f: Finding): void {
  const existing = out.get(f.id);
  if (!existing) {
    out.set(f.id, {
      ...f,
      aliases: f.aliases.filter((a) => a.toUpperCase() !== f.id),
      severity: 'unknown',
      kev: false,
      references: f.references.slice(0, 10),
      sources: [f.source],
    });
    return;
  }
  const higher = (f.score ?? -1) > (existing.score ?? -1);
  existing.aliases = union(existing.aliases, f.aliases).filter((a) => a.toUpperCase() !== f.id);
  existing.summary ??= f.summary;
  if (higher) {
    existing.score = f.score;
    existing.vector = f.vector ?? existing.vector;
  } else existing.vector ??= f.vector;
  existing.fixedIn ??= f.fixedIn;
  existing.introduced ??= f.introduced;
  existing.published ??= f.published;
  existing.modified ??= f.modified;
  existing.references = union(existing.references, f.references).slice(0, 10);
  existing.sources = union(existing.sources, [f.source]);
}

/** Merges OSV and NVD findings for one installed version, keyed by CVE id where possible. */
export function mergeVulns(
  osv: { v: OsvVuln; range: OsvRange; fixedIn: string | null }[],
  nvd: { c: NvdCve; fixedIn: string | null }[],
  kev: Set<string>,
): MatchedVuln[] {
  const out = new Map<string, MatchedVuln>();
  for (const { v, range, fixedIn } of osv)
    fold(out, {
      id: canonicalId(v.id, v.aliases),
      aliases: union([v.id], v.aliases),
      summary: v.summary,
      score: v.score,
      vector: v.vector,
      fixedIn,
      introduced: range.introduced,
      published: v.published,
      modified: v.modified,
      references: v.references,
      source: 'osv',
    });
  for (const { c, fixedIn } of nvd)
    fold(out, {
      id: c.id.toUpperCase(),
      aliases: [],
      summary: c.summary,
      score: c.score,
      vector: c.vector,
      fixedIn,
      introduced: null,
      published: c.published,
      modified: c.modified,
      references: c.references,
      source: 'nvd',
    });
  for (const v of out.values()) {
    v.severity = severityFromScore(v.score);
    v.kev = [v.id, ...v.aliases].some((a) => kev.has(a.toUpperCase()));
  }
  return [...out.values()].toSorted((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.id.localeCompare(b.id));
}
