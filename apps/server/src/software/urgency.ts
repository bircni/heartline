import type { UrgencyLevel } from '@heartline/shared';
import { compareVersions, patchesBehind, sameCycle } from './version.ts';

export interface UrgencyVuln {
  id: string;
  score: number | null;
  kev: boolean;
  fixedIn: string | null;
}

export interface UrgencyInput {
  version: string | null;
  latest: string | null;
  latestInCycle: string | null;
  cycle: string | null;
  /** `YYYY-MM-DD`, `true`, `false` or null (unknown). */
  cycleEol: string | null;
  /** Release cycle the operator stays on; newer cycles are not counted as updates. */
  pinnedCycle?: string | null;
  vulns: UrgencyVuln[];
  track: boolean;
  /** At least one vulnerability source answered (or served a cached copy). */
  intelAvailable: boolean;
  probeError: string | null;
  now: number;
}

export interface Urgency {
  level: UrgencyLevel;
  score: number;
  reasons: string[];
}

export const URGENCY_RANK: Record<UrgencyLevel, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  none: 1,
  unknown: 0,
};

const DAY = 86_400_000;

function vulnPoints(v: UrgencyVuln): number {
  let p = v.score === null ? 10 : v.score >= 9 ? 40 : v.score >= 7 ? 25 : v.score >= 4 ? 12 : 5;
  if (v.kev) p += 40;
  if (!v.fixedIn) p *= 0.8;
  return p;
}

function describe(v: UrgencyVuln): string {
  const bits = [v.score === null ? 'unscored' : `CVSS ${v.score.toFixed(1)}`];
  if (v.kev) bits.push('actively exploited');
  return `${v.id} (${bits.join(', ')}) ${v.fixedIn ? `fixed in ${v.fixedIn}` : 'no fix released'}`;
}

function levelOf(score: number): UrgencyLevel {
  if (score >= 70) return 'critical';
  if (score >= 45) return 'high';
  if (score >= 20) return 'medium';
  if (score > 0) return 'low';
  return 'none';
}

function atLeast(level: UrgencyLevel, floor: UrgencyLevel): UrgencyLevel {
  return URGENCY_RANK[level] >= URGENCY_RANK[floor] ? level : floor;
}

/** Scores how urgently a service needs an update. Pure; see README for the rules. */
export function computeUrgency(i: UrgencyInput): Urgency {
  if (!i.version) {
    return {
      level: 'unknown',
      score: 0,
      reasons: [`version not detected${i.probeError ? `: ${i.probeError}` : ''}`],
    };
  }
  const reasons: string[] = [];
  let score = 0;
  let floor: UrgencyLevel = 'none';
  const dataMissing = i.track && !i.intelAvailable;

  if (i.track && !dataMissing && i.vulns.length) {
    const ranked = i.vulns.map((v) => ({ v, p: vulnPoints(v) })).toSorted((a, b) => b.p - a.p);
    score += (ranked[0] as { p: number }).p + 5 * Math.min(ranked.length - 1, 6);
    for (const r of ranked.slice(0, 5)) reasons.push(describe(r.v));
    if (ranked.length > 5) reasons.push(`and ${ranked.length - 5} more`);
    if (i.vulns.some((v) => v.kev)) floor = atLeast(floor, 'critical');
    else if (i.vulns.some((v) => (v.score ?? 0) >= 9)) floor = atLeast(floor, 'high');
    else if (i.vulns.some((v) => (v.score ?? 0) >= 7)) floor = atLeast(floor, 'medium');
  }

  if (i.cycleEol === 'true' || (i.cycleEol && /^\d{4}-\d{2}-\d{2}$/.test(i.cycleEol))) {
    const eolAt = i.cycleEol === 'true' ? -Infinity : Date.parse(`${i.cycleEol}T00:00:00Z`);
    const label = i.cycle ?? i.version;
    if (eolAt <= i.now) {
      score += 30;
      floor = atLeast(floor, 'medium');
      reasons.push(
        i.cycleEol === 'true'
          ? `release cycle ${label} is end-of-life`
          : `release cycle ${label} is end-of-life since ${i.cycleEol}`,
      );
    } else if (eolAt - i.now <= 90 * DAY) {
      score += 10;
      reasons.push(`release cycle ${label} reaches end-of-life on ${i.cycleEol}`);
    }
  }

  const pinned = i.pinnedCycle ? sameCycle(i.version, i.pinnedCycle) : false;
  // When pinned, only releases inside the pinned cycle count; a `latest` from another cycle is ignored.
  const target =
    i.latestInCycle ??
    (pinned || (i.pinnedCycle && i.latest && !sameCycle(i.latest, i.pinnedCycle)) ? null : i.latest);
  if (target) {
    const cmp = compareVersions(i.version, target);
    if (cmp < 0) {
      const n = patchesBehind(i.version, target);
      if (n !== null && n > 0) {
        score += Math.min(4 * n, 20);
        reasons.push(`${n} patch release${n === 1 ? '' : 's'} behind (${i.version} → ${target})`);
      } else {
        score += 8;
        reasons.push(`behind latest ${target}`);
      }
    } else if (cmp > 0 && i.latest && compareVersions(i.version, i.latest) > 0) {
      reasons.push(`ahead of the latest known release (${i.latest})`);
    }
  }
  if (i.latest && i.latestInCycle && compareVersions(i.latest, i.latestInCycle) > 0) {
    if (i.pinnedCycle) reasons.push(`pinned to release cycle ${i.pinnedCycle} (${i.latest} available)`);
    else {
      score += 10;
      reasons.push(`newer release cycle available (${i.latest})`);
    }
  }
  if (i.pinnedCycle && !pinned)
    reasons.push(`running ${i.version}, not in the pinned cycle ${i.pinnedCycle}`);

  score = Math.max(0, Math.min(100, Math.round(score)));
  let level = atLeast(levelOf(score), floor);
  if (dataMissing) {
    level = 'unknown';
    reasons.unshift('vulnerability data unavailable');
  }
  if (!i.track) reasons.push('vulnerability tracking disabled');
  return { level, score, reasons };
}
