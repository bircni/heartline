import type { DayBar } from '@heartline/shared';
import { useState } from 'react';
import { DAY_COLOR, DAY_LABEL, ms, pct, shortDay } from '../lib/format.ts';

/** Claude/GitHub-style availability bars, one per day, with a hover card. */
export function DayBars({ bars, height = 34 }: { bars: DayBar[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const gap = bars.length > 45 ? 2 : bars.length > 14 ? 3 : 4;
  const active = hover === null ? null : bars[hover];
  return (
    <div className="relative" onMouseLeave={() => setHover(null)}>
      <div className="flex" style={{ gap, height }} aria-hidden="true">
        {bars.map((b, i) => (
          <span
            key={b.day}
            onMouseEnter={() => setHover(i)}
            className="min-w-0 flex-1 rounded-[2px] transition-opacity"
            style={{ background: DAY_COLOR[b.state], opacity: hover !== null && hover !== i ? 0.55 : 1 }}
          />
        ))}
      </div>
      {active && hover !== null && (
        <div
          role="tooltip"
          className="pointer-events-none absolute bottom-full z-20 mb-2 w-max max-w-[220px] -translate-x-1/2 rounded-[10px] bg-surface px-3 py-2 text-[12px] shadow-[0_8px_30px_rgb(0_0_0/0.25)] ring-1 ring-hair"
          style={{ left: `${((hover + 0.5) / bars.length) * 100}%` }}
        >
          <div className="font-semibold">{shortDay(active.day)}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-sec">
            <span className="block h-2 w-2 rounded-[2px]" style={{ background: DAY_COLOR[active.state] }} />
            {DAY_LABEL[active.state]}
            {active.uptime !== null && ` · ${pct(active.uptime)}`}
          </div>
          {active.avgLatencyMs !== null && (
            <div className="text-sec">
              avg {ms(active.avgLatencyMs)}
              {active.p95LatencyMs !== null && ` · p95 ${ms(active.p95LatencyMs)}`}
            </div>
          )}
        </div>
      )}
      <span className="sr-only">
        {bars.filter((b) => b.state === 'down').length} outage days,{' '}
        {bars.filter((b) => b.state === 'degraded').length} degraded days in the last {bars.length} days
      </span>
    </div>
  );
}

export function DayLegend() {
  const items: [string, string][] = [
    ['Operational', DAY_COLOR.operational],
    ['Degraded', DAY_COLOR.degraded],
    ['Outage', DAY_COLOR.down],
    ['Maintenance', DAY_COLOR.maintenance],
  ];
  return (
    <div className="flex flex-wrap gap-3.5 text-[12px] text-sec" aria-hidden="true">
      {items.map(([label, color]) => (
        <span key={label} className="flex items-center gap-1.5">
          <span className="block h-2 w-2 rounded-[2px]" style={{ background: color }} />
          {label}
        </span>
      ))}
    </div>
  );
}
