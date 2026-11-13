import type { LatencyPoint } from '@heartline/shared';
import { curveMonotoneX } from '@visx/curve';
import { localPoint } from '@visx/event';
import { Group } from '@visx/group';
import { ParentSize } from '@visx/responsive';
import { scaleLinear } from '@visx/scale';
import { AreaClosed, Line, LinePath } from '@visx/shape';
import { useMemo, useState } from 'react';
import { clearOfEndLabel, ms, timeTicks } from '../lib/format.ts';

const MARGIN = { top: 8, right: 4, bottom: 24, left: 52 };

/** A stretch of the chart shaded in a status colour, e.g. an outage. */
export interface ChartBand {
  from: number;
  to: number;
  fill: string;
}

interface Props {
  points: LatencyPoint[];
  from: number;
  to: number;
  bucketMs: number;
  highLabel: string;
  /** Label at the right end of the time axis. */
  endLabel: string;
  bands?: ChartBand[];
}

function label(at: number, bucketMs: number): string {
  const opts: Intl.DateTimeFormatOptions =
    bucketMs >= 86_400_000
      ? { month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
  return new Intl.DateTimeFormat(undefined, opts).format(at);
}

function Chart({
  points,
  from,
  to,
  bucketMs,
  highLabel,
  endLabel,
  bands = [],
  width,
  height,
}: Props & { width: number; height: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const innerW = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerH = Math.max(0, height - MARGIN.top - MARGIN.bottom);
  // Everything below depends on the data and size only, so moving the pointer does not rebuild it.
  const { data, runs, ticks, x, y } = useMemo(() => {
    const data = points.filter((p) => p.avgLatencyMs !== null);
    const top = Math.max(1, ...data.map((p) => Math.max(p.highLatencyMs ?? 0, p.avgLatencyMs ?? 0))) * 1.1;
    // A line across a stretch without checks would invent response times, so it breaks there instead.
    const runs: LatencyPoint[][] = [];
    for (const p of data) {
      const run = runs.at(-1);
      const last = run?.at(-1);
      if (run && last && p.at - last.at <= bucketMs * 1.5) run.push(p);
      else runs.push([p]);
    }
    return {
      data,
      runs,
      ticks: timeTicks(from, to),
      x: scaleLinear({ domain: [from, to], range: [0, innerW], clamp: true }),
      y: scaleLinear({ domain: [0, top], range: [innerH, 0], nice: true }),
    };
  }, [points, from, to, bucketMs, innerW, innerH]);
  const active = hover === null ? null : data[hover];

  if (data.length === 0)
    return (
      <div className="flex h-full items-center justify-center text-base text-sec">
        No response times in this period yet
      </div>
    );

  const nearest = (px: number) => {
    const at = x.invert(px);
    let best = 0;
    for (let i = 1; i < data.length; i++)
      if (Math.abs((data[i] as LatencyPoint).at - at) < Math.abs((data[best] as LatencyPoint).at - at))
        best = i;
    return best;
  };

  return (
    <div className="relative">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`Response time, ${data.length} points, average ${ms(Math.round(data.reduce((a, p) => a + (p.avgLatencyMs ?? 0), 0) / data.length))}`}
      >
        <Group left={MARGIN.left} top={MARGIN.top}>
          {y.ticks(3).map((t) => (
            <g key={t}>
              <line x1={0} x2={innerW} y1={y(t)} y2={y(t)} stroke="var(--hair)" />
              <text x={-8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={12} fill="var(--muted)">
                {ms(t)}
              </text>
            </g>
          ))}
          {ticks.map((t) => (
            <g key={t.pos}>
              {t.pos > 0 && (
                <line x1={t.pos * innerW} x2={t.pos * innerW} y1={0} y2={innerH + 6} stroke="var(--grid)" />
              )}
              {clearOfEndLabel(t) && (
                <text
                  x={t.pos * innerW + (t.pos > 0 ? 6 : 0)}
                  y={innerH + 18}
                  fontSize={12}
                  fill="var(--muted)"
                >
                  {t.label}
                </text>
              )}
            </g>
          ))}
          <text x={innerW} y={innerH + 18} textAnchor="end" fontSize={12} fill="var(--muted)">
            {endLabel}
          </text>
          {bands.map((b) => (
            <rect
              key={b.from}
              x={x(b.from)}
              y={0}
              width={Math.max(1, x(b.to) - x(b.from))}
              height={innerH}
              fill={b.fill}
            />
          ))}
          {runs.map((run) => {
            const start = run[0] as LatencyPoint;
            if (run.length === 1)
              return (
                <circle
                  key={start.at}
                  cx={x(start.at)}
                  cy={y(start.avgLatencyMs ?? 0)}
                  r={2}
                  fill="var(--accent)"
                />
              );
            return (
              <g key={start.at}>
                <LinePath<LatencyPoint>
                  data={run}
                  x={(p) => x(p.at)}
                  y={(p) => y(p.highLatencyMs ?? 0)}
                  defined={(p) => p.highLatencyMs !== null}
                  curve={curveMonotoneX}
                  stroke="var(--muted)"
                  strokeWidth={1.5}
                  strokeDasharray="1 4"
                  strokeLinecap="round"
                />
                <AreaClosed<LatencyPoint>
                  data={run}
                  x={(p) => x(p.at)}
                  y={(p) => y(p.avgLatencyMs ?? 0)}
                  yScale={y}
                  curve={curveMonotoneX}
                  fill="var(--tint)"
                />
                <LinePath<LatencyPoint>
                  data={run}
                  x={(p) => x(p.at)}
                  y={(p) => y(p.avgLatencyMs ?? 0)}
                  curve={curveMonotoneX}
                  stroke="var(--accent)"
                  strokeWidth={1.75}
                />
              </g>
            );
          })}
          {active && (
            <>
              <Line
                from={{ x: x(active.at), y: 0 }}
                to={{ x: x(active.at), y: innerH }}
                stroke="var(--fill-2)"
              />
              <circle
                cx={x(active.at)}
                cy={y(active.avgLatencyMs ?? 0)}
                r={3.5}
                fill="var(--accent)"
                stroke="var(--surface)"
                strokeWidth={2}
              />
            </>
          )}
          <rect
            width={innerW}
            height={innerH}
            fill="transparent"
            onMouseMove={(e) => {
              const pt = localPoint(e);
              if (pt) setHover(nearest(pt.x - MARGIN.left));
            }}
            onMouseLeave={() => setHover(null)}
          />
        </Group>
      </svg>
      {active && (
        <div
          role="tooltip"
          className="pointer-events-none absolute top-0 z-10 rounded-md bg-surface px-3 py-2 text-xs shadow-pop"
          style={{ left: Math.min(width - 170, Math.max(0, MARGIN.left + x(active.at) + 12)) }}
        >
          <div className="font-medium">{label(active.at, bucketMs)}</div>
          <div className="text-sec">
            avg {ms(active.avgLatencyMs)}, {highLabel} {ms(active.highLatencyMs)}
          </div>
        </div>
      )}
    </div>
  );
}

export function LatencyChart({ height = 260, ...props }: Props & { height?: number }) {
  return (
    <div style={{ height }}>
      <ParentSize debounceTime={50}>
        {({ width }) => (width > 0 ? <Chart {...props} width={width} height={height} /> : null)}
      </ParentSize>
    </div>
  );
}
