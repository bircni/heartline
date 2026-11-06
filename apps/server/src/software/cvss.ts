import type { VulnSeverity } from '@heartline/shared';

const AV: Record<string, number> = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 };
const AC: Record<string, number> = { L: 0.77, H: 0.44 };
const PR_U: Record<string, number> = { N: 0.85, L: 0.62, H: 0.27 };
const PR_C: Record<string, number> = { N: 0.85, L: 0.68, H: 0.5 };
const UI: Record<string, number> = { N: 0.85, R: 0.62 };
const CIA: Record<string, number> = { H: 0.56, L: 0.22, N: 0 };

function roundUp(n: number): number {
  const i = Math.round(n * 100_000);
  return i % 10_000 === 0 ? i / 100_000 : (Math.floor(i / 10_000) + 1) / 10;
}

/** Base score of a CVSS v3.0 or v3.1 vector; null for anything else. */
export function cvss3BaseScore(vector: string): number | null {
  const m = /^CVSS:3\.[01]\/(.+)$/.exec(vector.trim());
  if (!m) return null;
  const v: Record<string, string> = {};
  for (const part of (m[1] as string).split('/')) {
    const [k, val] = part.split(':');
    if (k && val) v[k] = val;
  }
  const scope = v.S;
  const av = AV[v.AV ?? ''];
  const ac = AC[v.AC ?? ''];
  const pr = (scope === 'C' ? PR_C : PR_U)[v.PR ?? ''];
  const ui = UI[v.UI ?? ''];
  const c = CIA[v.C ?? ''];
  const i = CIA[v.I ?? ''];
  const a = CIA[v.A ?? ''];
  if ([av, ac, pr, ui, c, i, a].some((x) => x === undefined) || (scope !== 'U' && scope !== 'C')) return null;
  const iss = 1 - (1 - (c as number)) * (1 - (i as number)) * (1 - (a as number));
  const impact = scope === 'U' ? 6.42 * iss : 7.52 * (iss - 0.029) - 3.25 * (iss - 0.02) ** 15;
  const exploitability = 8.22 * (av as number) * (ac as number) * (pr as number) * (ui as number);
  if (impact <= 0) return 0;
  const base =
    scope === 'U'
      ? roundUp(Math.min(impact + exploitability, 10))
      : roundUp(Math.min(1.08 * (impact + exploitability), 10));
  return base;
}

/** Score from any supported vector (v3.x computed; v4 unsupported → null). */
export function scoreFromVector(vector: string | null | undefined): number | null {
  if (!vector) return null;
  return cvss3BaseScore(vector);
}

export function severityFromScore(score: number | null): VulnSeverity {
  if (score === null) return 'unknown';
  if (score >= 9) return 'critical';
  if (score >= 7) return 'high';
  if (score >= 4) return 'medium';
  return 'low';
}

/** Representative score for a severity label (used when only a label is published). */
export function labelToScore(label: string | null | undefined): number | null {
  switch ((label ?? '').toUpperCase()) {
    case 'CRITICAL':
      return 9.5;
    case 'HIGH':
      return 8;
    case 'MODERATE':
    case 'MEDIUM':
      return 5.5;
    case 'LOW':
      return 2.5;
    default:
      return null;
  }
}
