import type { Overview } from '@heartline/shared';
import { describe, expect, it } from 'vitest';
import { groupPastDays } from './OverviewParts.tsx';

type PastDay = Overview['pastIncidents'][number];
const quiet = (day: string): PastDay => ({ day, incidents: [] });
const busy = (day: string): PastDay => ({ day, incidents: [{ id: day } as PastDay['incidents'][number]] });

describe('groupPastDays', () => {
  const days = (groups: PastDay[][]) => groups.map((g) => g.map((d) => d.day));

  it('joins runs of days without incidents and keeps today on its own', () => {
    const input = [quiet('05'), quiet('04'), quiet('03'), busy('02'), quiet('01')];
    expect(days(groupPastDays(input))).toEqual([['05'], ['04', '03'], ['02'], ['01']]);
  });

  it('keeps days with incidents apart', () => {
    expect(days(groupPastDays([busy('03'), busy('02'), busy('01')]))).toEqual([['03'], ['02'], ['01']]);
  });
});
