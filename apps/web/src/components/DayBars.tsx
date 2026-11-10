import type { DayBar, DayState, LatencyPoint } from '@heartline/shared';
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  DAY_BG,
  DAY_COLOR,
  DAY_LABEL,
  type Tick,
  dateTime,
  ms,
  pct,
  shortDay,
  timeTicks,
} from '../lib/format.ts';
import { useStoredChoice } from '../lib/store.ts';
import { Segmented } from './Segmented.tsx';

/** Availability drawn as a stepped uptime line (graph) or as one coloured bar per period (timeline). */
export type TraceView = 'graph' | 'timeline';
const VIEWS = ['graph', 'timeline'] as const;

/** The viewer's preferred availability view, shared by every trace on the page; the graph is the default. */
export function useTraceView(): [TraceView, (view: TraceView) => void] {
  return useStoredChoice('availability-view', VIEWS, 'graph');
}

/** Switch between the graph and the timeline; every trace on the page follows it. */
export function TraceViewToggle() {
  const [view, setView] = useTraceView();
  return (
    <Segmented
      label="Show availability as"
      value={view}
      onChange={setView}
      options={[
        { value: 'graph', label: 'Graph' },
        { value: 'timeline', label: 'Timeline' },
      ]}
    />
  );
}

/** Line colour of a troubled period; healthy periods use the plain green line. */
const STROKE: Partial<Record<DayState, string>> = {
  degraded: 'var(--warn)',
  maintenance: 'var(--maint)',
  down: 'var(--bad)',
};

interface Mark {
  key: string;
  state: DayState;
  /** Percentage of successful checks, null without data. */
  uptime: number | null;
  tip: () => ReactNode;
}

/**
 * Lowest uptime the graph shows, so small dips stay visible: 99% when every period is above it, then 95%,
 * then the next 10% step below the worst value. Pass the same floor to traces that are compared row by row.
 */
export function traceFloor(values: (number | null)[]): number {
  let min = 100;
  for (const v of values) if (v !== null && v < min) min = v;
  if (min >= 99) return 99;
  if (min >= 95) return 95;
  return Math.max(0, Math.floor(min / 10) * 10);
}

/** SVG path of a stepped line over `marks`, one unit per mark; it breaks where a period has no data. */
function steps(marks: Mark[], y: (u: number) => number, only?: (m: Mark) => boolean): string {
  let d = '';
  let drawing = false;
  marks.forEach((m, i) => {
    if (m.uptime === null || (only && !only(m))) {
      drawing = false;
      return;
    }
    const v = y(m.uptime).toFixed(2);
    d += `${drawing ? 'L' : 'M'}${i} ${v}H${i + 1}`;
    drawing = true;
  });
  return d;
}

/** The uptime line with its status bands. It only changes with the data, not while the pointer moves. */
function TraceGraph({ marks, floor }: { marks: Mark[]; floor: number }) {
  // Keeps the line off the very top and bottom so a 100% day is not hidden by the edge.
  const pad = 8;
  const y = (u: number) =>
    pad + ((100 - Math.max(floor, Math.min(100, u))) / (100 - floor)) * (100 - 2 * pad);
  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${marks.length} 100`}
      preserveAspectRatio="none"
      className="absolute inset-0 h-full w-full"
    >
      {marks.map((m, i) => {
        const band = DAY_BG[m.state];
        return band ? <rect key={m.key} x={i} y={0} width={1} height={100} fill={band} /> : null;
      })}
      <path
        d={steps(marks, y)}
        fill="none"
        stroke="var(--ok)"
        strokeWidth={1.5}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {Object.entries(STROKE).map(([state, stroke]) => (
        <path
          key={state}
          d={steps(marks, y, (m) => m.state === state)}
          fill="none"
          stroke={stroke}
          strokeWidth={2}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

function Trace({
  marks,
  summary,
  view,
  height,
  floor: sharedFloor,
}: {
  marks: Mark[];
  summary: string;
  view: TraceView;
  height: number;
  floor?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const gap = view === 'graph' ? 0 : marks.length > 120 ? 1 : marks.length > 45 ? 2 : 3;
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
    const hide = () => setHover(null); // a fixed tooltip would drift away from its mark
    window.addEventListener('scroll', hide, { capture: true, passive: true });
    return () => window.removeEventListener('scroll', hide, { capture: true });
  }, [hover]);
  // Built once per data change; hovering only re-renders the hit areas and the tooltip.
  const graph = useMemo(
    () =>
      view === 'graph' ? (
        <TraceGraph marks={marks} floor={sharedFloor ?? traceFloor(marks.map((m) => m.uptime))} />
      ) : null,
    [marks, sharedFloor, view],
  );

  return (
    <div ref={wrap} className="relative" style={{ height }} onMouseLeave={() => setHover(null)}>
      {graph}
      <div className="absolute inset-0 flex" style={{ gap }} aria-hidden="true">
        {marks.map((m, i) => (
          <span
            key={m.key}
            onMouseEnter={() => setHover(i)}
            className="min-w-0 flex-1 rounded-xs transition-opacity"
            style={
              view === 'graph'
                ? { background: hover === i ? 'var(--fill-2)' : 'transparent', opacity: 0.5 }
                : { background: DAY_COLOR[m.state], opacity: hover !== null && hover !== i ? 0.55 : 1 }
            }
          />
        ))}
      </div>
      {active && (
        <div
          ref={tip}
          role="tooltip"
          className="pointer-events-none fixed z-50 w-max max-w-[240px] rounded-md bg-surface px-3 py-2 text-[12px] font-normal text-text shadow-pop"
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
      <span className="block h-2 w-2 rounded-xs" style={{ background: DAY_COLOR[state] }} />
      {DAY_LABEL[state]}
      {children}
    </div>
  );
}

export function DayBars({
  bars,
  view = 'graph',
  height = 28,
  floor,
}: {
  bars: DayBar[];
  view?: TraceView;
  height?: number;
  floor?: number;
}) {
  const marks = bars.map((b): Mark => ({
    key: b.day,
    state: b.state,
    uptime: b.uptime,
    tip: () => (
      <>
        <div className="font-medium">{shortDay(b.day)}</div>
        <StateLine state={b.state}>{b.uptime !== null && <span>, {pct(b.uptime)} uptime</span>}</StateLine>
        {b.avgLatencyMs !== null && (
          <div className="text-sec">
            avg {ms(b.avgLatencyMs)}
            {b.p95LatencyMs !== null && `, p95 ${ms(b.p95LatencyMs)}`}
          </div>
        )}
      </>
    ),
  }));
  const count = (s: DayState) => bars.filter((b) => b.state === s).length;
  return (
    <Trace
      marks={marks}
      view={view}
      height={height}
      floor={floor}
      summary={`${count('down')} outage days, ${count('degraded')} degraded days in these ${bars.length} days`}
    />
  );
}

const bucketRange = (from: number, to: number, bucketMs: number): [number, number] => [
  Math.floor(from / bucketMs),
  Math.floor(to / bucketMs),
];

/** Axis ticks for the marks `BucketBars` draws for the same arguments. */
export function bucketTicks(from: number, to: number, bucketMs: number): Tick[] {
  const [first, last] = bucketRange(from, to, bucketMs);
  return timeTicks(first * bucketMs, (last + 1) * bucketMs, last - first + 1);
}

/** Dates under a trace; the right edge names the end of the range. */
export function TraceAxis({
  ticks,
  end,
  className = '',
}: {
  ticks: Tick[];
  end: string;
  className?: string;
}) {
  return (
    <div className={`relative h-4 text-[12px] leading-4 text-muted ${className}`} aria-hidden="true">
      {ticks
        .filter((t) => t.pos < 0.88)
        .map((t) => (
          <span
            key={t.pos}
            className={`absolute top-0 whitespace-nowrap ${t.pos > 0.7 ? 'max-sm:hidden' : ''}`}
            style={{ left: `${t.pos * 100}%` }}
          >
            {t.label}
          </span>
        ))}
      <span className="absolute top-0 right-0">{end}</span>
    </div>
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
  view = 'graph',
  height = 28,
}: {
  points: LatencyPoint[];
  from: number;
  to: number;
  bucketMs: number;
  view?: TraceView;
  height?: number;
}) {
  const byBucket = new Map(points.map((p) => [Math.floor(p.at / bucketMs), p]));
  const marks: Mark[] = [];
  const [first, last] = bucketRange(from, to, bucketMs);
  for (let k = first; k <= last; k++) {
    const p = byBucket.get(k);
    const start = k * bucketMs;
    const state = p?.state ?? 'nodata';
    marks.push({
      key: String(k),
      state,
      uptime: p?.checks ? ((p.checks - (p.down ?? 0)) / p.checks) * 100 : null,
      tip: () => (
        <>
          <div className="font-medium">
            {dateTime(start)} – {hm(start + bucketMs)}
          </div>
          <StateLine state={state}>
            {p?.checks ? (
              <span>, {p.down ? `${p.down} of ${p.checks} checks down` : `${p.checks} checks`}</span>
            ) : null}
          </StateLine>
          {p && p.avgLatencyMs !== null && (
            <div className="text-sec">
              avg {ms(p.avgLatencyMs)}
              {p.highLatencyMs !== null && `, peak ${ms(p.highLatencyMs)}`}
            </div>
          )}
        </>
      ),
    });
  }
  const down = marks.filter((m) => m.state === 'down').length;
  const minutes = Math.round(bucketMs / 60_000);
  return (
    <Trace
      marks={marks}
      view={view}
      height={height}
      summary={`${down} of ${marks.length} ${minutes}-minute periods with an outage`}
    />
  );
}

export function DayLegend() {
  const items: [string, DayState][] = [
    ['Operational', 'operational'],
    ['Degraded', 'degraded'],
    ['Outage', 'down'],
    ['Maintenance', 'maintenance'],
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted" aria-hidden="true">
      {items.map(([label, state]) => (
        <span key={label} className="flex items-center gap-1.5">
          <span className="block h-2 w-2 rounded-xs" style={{ background: DAY_COLOR[state] }} />
          {label}
        </span>
      ))}
    </div>
  );
}
