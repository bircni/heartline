import type { ComponentStatus, Impact, ServiceStatus } from './types.ts';

const IMPACT_RANK: Record<Impact, number> = { none: 0, degraded: 1, partial: 2, major: 3 };

/** The worse of two impacts. */
export function maxImpact(a: Impact, b: Impact): Impact {
  return IMPACT_RANK[b] > IMPACT_RANK[a] ? b : a;
}

/** The impact the affected services' statuses add up to: their worst, `none` when nothing is affected. */
export function deriveImpact(statuses: ComponentStatus[]): Impact {
  return statuses.reduce<Impact>(
    (acc, s) =>
      maxImpact(
        acc,
        s === 'down' ? 'major' : s === 'partial' ? 'partial' : s === 'degraded' ? 'degraded' : 'none',
      ),
    'none',
  );
}

/** The status a service gets when an incident names it without one. */
export function defaultComponentStatus(impact: Impact | undefined): ComponentStatus {
  return impact === 'major' ? 'down' : impact === 'partial' ? 'partial' : 'degraded';
}

/** The overall status an open incident's impact stands for. */
export function impactStatus(impact: Impact): ServiceStatus {
  return impact === 'major'
    ? 'down'
    : impact === 'partial'
      ? 'partial'
      : impact === 'degraded'
        ? 'degraded'
        : 'operational';
}

/** Normalises `affectedServiceSchema` values to `{ id, status }`. */
export function affected(
  list: (string | { id: string; status: ComponentStatus })[],
  impact: Impact | undefined,
): { id: string; status: ComponentStatus }[] {
  const out = new Map<string, ComponentStatus>();
  for (const s of list)
    out.set(
      typeof s === 'string' ? s : s.id,
      typeof s === 'string' ? defaultComponentStatus(impact) : s.status,
    );
  return [...out].map(([id, status]) => ({ id, status }));
}
