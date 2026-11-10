import type { DayBar, DayState, LatencyPoint } from '@heartline/shared';
import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DAY_COLOR, DAY_LABEL, dateTime, ms, pct, shortDay } from '../lib/format.ts';

/** How high each day rises, in px: quiet while healthy, tallest on an outage. */
const DAY_HEIGHT: Record<DayState, number> = {
  nodata: 4,
  operational: 8,
  maintenance: 12,
  degraded: 20,
  down: 28,
};

interface Mark {
  key: string;
  state: DayState;
  tip: () => ReactNode;
}

/** Availability as a heart trace: one mark per period, rising only when something was wrong. */
function StateBars({ marks, summary }: { marks: Mark[]; summary: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const gap = marks.length > 120 ? 1 : marks.length > 45 ? 2 : marks.length > 14 ? 3 : 4;
  // On phones 90 separated marks turn into stripes, so they join into one continuous line.
  const dense = marks.length > 45;
  const active = hover === null ? null : marks[hover];
  const wrap = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  useLayoutEffect(() => {
    if (hover === null || !wrap.current || !tip.current) return;
    const box = wrap.current.getBoundingClientRect();
    const tipWidth = tip.current.offsetWidth;
    const center = ((hover + 0.5) / marks.length) * box.width;
    setPos({
      left: box.left + Math.min(Math.max(center - tipWidth / 2, 0), Math.max(box.width - tipWidth, 0)),
      top: box.top - tip.current.offsetHeight - 8,
    });
  }, [hover, marks.length]);
  useEffect(() => {
    if (hover === null) return;
    const hide = () => setHover(null); // a fixed tooltip would drift away from its bar
    window.addEventListener('scroll', hide, { capture: true, passive: true });
    return () => window.removeEventListener('scroll', hide, { capture: true });
  }, [hover]);
  return (
    <div ref={wrap} className="relative" onMouseLeave={() => setHover(null)}>
      <div
        className={`flex h-7 gap-(--day-gap) ${dense ? 'max-sm:gap-0' : ''}`}
        style={{ '--day-gap': `${gap}px` } as CSSProperties}
        aria-hidden="true"
      >
        {marks.map((b, i) => (
          <span
            key={b.key}
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
      {active && (
        <div
          ref={tip}
          role="tooltip"
          className="pointer-events-none fixed z-50 w-max max-w-[240px] rounded-[8px] bg-surface px-3 py-2 text-[12px] shadow-pop ring-1 ring-hair"
          style={pos}
        >
          {active.tip()}
        </div>
      )}
      <span className="sr-only">{summary}</span>
    </div>
  );
}

function StateLine({ state, children }: { state: DayState; children?: ReactNode }) {
  return (
    <div className="mt-0.5 flex items-center gap-2 text-sec">
      <span className="block h-2 w-2 rounded-[2px]" style={{ background: DAY_COLOR[state] }} />
      {DAY_LABEL[state]}
      {children}
    </div>
  );
}

export function DayBars({ bars }: { bars: DayBar[] }) {
  const marks = bars.map((b): Mark => ({
    key: b.day,
    state: b.state,
    tip: () => (
      <>
        <div className="font-medium">{shortDay(b.day)}</div>
        <StateLine state={b.state}>
          {b.uptime !== null && <span className="font-mono">· {pct(b.uptime)} uptime</span>}
        </StateLine>
        {b.avgLatencyMs !== null && (
          <div className="font-mono text-sec">
            avg {ms(b.avgLatencyMs)}
            {b.p95LatencyMs !== null && ` · p95 ${ms(b.p95LatencyMs)}`}
          </div>
        )}
      </>
    ),
  }));
  const count = (s: DayState) => bars.filter((b) => b.state === s).length;
  return (
    <StateBars
      marks={marks}
      summary={`${count('down')} outage days, ${count('degraded')} degraded days in the last ${bars.length} days`}
    />
  );
}

const hm = (at: number) =>
  new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);

/** The same trace at the series resolution, so an outage shows when it happened instead of filling its day. */
export function BucketBars({
  points,
  from,
  to,
  bucketMs,
}: {
  points: LatencyPoint[];
  from: number;
  to: number;
  bucketMs: number;
}) {
  const byBucket = new Map(points.map((p) => [Math.floor(p.at / bucketMs), p]));
  const marks: Mark[] = [];
  for (let k = Math.floor(from / bucketMs); k <= Math.floor(to / bucketMs); k++) {
    const p = byBucket.get(k);
    const start = k * bucketMs;
    const state = p?.state ?? 'nodata';
    marks.push({
      key: String(k),
      state,
      tip: () => (
        <>
          <div className="font-medium">
            {dateTime(start)} – {hm(start + bucketMs)}
          </div>
          <StateLine state={state}>
            {p?.checks ? (
              <span className="font-mono">
                · {p.down ? `${p.down} of ${p.checks} checks down` : `${p.checks} checks`}
              </span>
            ) : null}
          </StateLine>
          {p && p.avgLatencyMs !== null && (
            <div className="font-mono text-sec">
              avg {ms(p.avgLatencyMs)}
              {p.highLatencyMs !== null && ` · peak ${ms(p.highLatencyMs)}`}
            </div>
          )}
        </>
      ),
    });
  }
  const down = marks.filter((m) => m.state === 'down').length;
  const minutes = Math.round(bucketMs / 60_000);
  return (
    <StateBars
      marks={marks}
      summary={`${down} of ${marks.length} ${minutes}-minute periods with an outage`}
    />
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
