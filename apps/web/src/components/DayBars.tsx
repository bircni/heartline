import type { DayBar, DayState } from '@heartline/shared';
import { type CSSProperties, useLayoutEffect, useRef, useState } from 'react';
import { DAY_COLOR, DAY_LABEL, ms, pct, shortDay } from '../lib/format.ts';

/** How high each day rises, in px: quiet while healthy, tallest on an outage. */
const DAY_HEIGHT: Record<DayState, number> = {
  nodata: 4,
  operational: 8,
  maintenance: 12,
  degraded: 20,
  down: 28,
};

/** Availability as a heart trace: one mark per day, rising only when something was wrong. */
export function DayBars({ bars }: { bars: DayBar[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const gap = bars.length > 45 ? 2 : bars.length > 14 ? 3 : 4;
  // On phones 90 separated marks turn into stripes, so they join into one continuous line.
  const dense = bars.length > 45;
  const active = hover === null ? null : bars[hover];
  const wrap = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState(0);
  useLayoutEffect(() => {
    if (hover === null || !wrap.current || !tip.current) return;
    const width = wrap.current.clientWidth;
    const tipWidth = tip.current.offsetWidth;
    const center = ((hover + 0.5) / bars.length) * width;
    setLeft(Math.min(Math.max(center - tipWidth / 2, 0), Math.max(width - tipWidth, 0))); // stay inside clipping cards
  }, [hover, bars.length]);
  return (
    <div ref={wrap} className="relative" onMouseLeave={() => setHover(null)}>
      <div
        className={`flex h-7 gap-(--day-gap) ${dense ? 'max-sm:gap-0' : ''}`}
        style={{ '--day-gap': `${gap}px` } as CSSProperties}
        aria-hidden="true"
      >
        {bars.map((b, i) => (
          <span
            key={b.day}
            onMouseEnter={() => setHover(i)}
            className="flex min-w-0 flex-1 items-end transition-opacity"
            style={{ opacity: hover !== null && hover !== i ? 0.55 : 1 }}
          >
            <span
              className={`block w-full rounded-[2px] ${dense ? 'max-sm:rounded-none' : ''}`}
              style={{ height: DAY_HEIGHT[b.state], background: DAY_COLOR[b.state] }}
            />
          </span>
        ))}
      </div>
      {active && hover !== null && (
        <div
          ref={tip}
          role="tooltip"
          className="pointer-events-none absolute bottom-full z-20 mb-2 w-max max-w-[220px] rounded-[8px] bg-surface px-3 py-2 text-[12px] shadow-pop ring-1 ring-hair"
          style={{ left }}
        >
          <div className="font-medium">{shortDay(active.day)}</div>
          <div className="mt-0.5 flex items-center gap-2 text-sec">
            <span className="block h-2 w-2 rounded-[2px]" style={{ background: DAY_COLOR[active.state] }} />
            {DAY_LABEL[active.state]}
            {active.uptime !== null && <span className="font-mono">{pct(active.uptime)}</span>}
          </div>
          {active.avgLatencyMs !== null && (
            <div className="font-mono text-sec">
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
  const items: [string, DayState][] = [
    ['Operational', 'operational'],
    ['Maintenance', 'maintenance'],
    ['Degraded', 'degraded'],
    ['Outage', 'down'],
  ];
  return (
    <div className="flex flex-wrap items-end gap-4 text-[12px] text-muted" aria-hidden="true">
      {items.map(([label, state]) => (
        <span key={label} className="flex items-end gap-2">
          <span
            className="mb-0.5 block w-2 rounded-[2px]"
            style={{ height: DAY_HEIGHT[state] / 2, background: DAY_COLOR[state] }}
          />
          {label}
        </span>
      ))}
    </div>
  );
}
