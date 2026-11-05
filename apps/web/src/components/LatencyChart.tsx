import type { LatencyPoint } from '@heartline/shared';
import { curveMonotoneX } from '@visx/curve';
import { localPoint } from '@visx/event';
import { Group } from '@visx/group';
import { ParentSize } from '@visx/responsive';
import { scaleLinear } from '@visx/scale';
import { AreaClosed, Line, LinePath } from '@visx/shape';
import { useState } from 'react';
import { ms } from '../lib/format.ts';

const MARGIN = { top: 8, right: 4, bottom: 8, left: 56 };

interface Props {
  points: LatencyPoint[];
  from: number;
  to: number;
  bucketMs: number;
  highLabel: string;
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
  width,
  height,
}: Props & { width: number; height: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const data = points.filter((p) => p.avgLatencyMs !== null);
  const innerW = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerH = Math.max(0, height - MARGIN.top - MARGIN.bottom);
  const top = Math.max(1, ...data.map((p) => Math.max(p.highLatencyMs ?? 0, p.avgLatencyMs ?? 0))) * 1.1;
  const x = scaleLinear({ domain: [from, to], range: [0, innerW], clamp: true });
  const y = scaleLinear({ domain: [0, top], range: [innerH, 0], nice: true });
  const active = hover === null ? null : data[hover];

  if (data.length === 0)
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-sec">
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
              <text
                x={-8}
                y={y(t)}
                dy="0.32em"
                textAnchor="end"
                fontSize={12}
                fontFamily="var(--font-mono)"
                fill="var(--muted)"
              >
                {ms(t)}
              </text>
            </g>
          ))}
          <LinePath<LatencyPoint>
            data={data}
            x={(p) => x(p.at)}
            y={(p) => y(p.highLatencyMs ?? 0)}
            defined={(p) => p.highLatencyMs !== null}
            curve={curveMonotoneX}
            stroke="var(--chart-2)"
            strokeWidth={1.5}
            strokeDasharray="1 4"
            strokeLinecap="round"
          />
          <AreaClosed<LatencyPoint>
            data={data}
            x={(p) => x(p.at)}
            y={(p) => y(p.avgLatencyMs ?? 0)}
            yScale={y}
            curve={curveMonotoneX}
            fill="var(--area)"
          />
          <LinePath<LatencyPoint>
            data={data}
            x={(p) => x(p.at)}
            y={(p) => y(p.avgLatencyMs ?? 0)}
            curve={curveMonotoneX}
            stroke="var(--chart)"
            strokeWidth={1.75}
          />
          {data.length === 1 && (
            <circle
              cx={x((data[0] as LatencyPoint).at)}
              cy={y((data[0] as LatencyPoint).avgLatencyMs ?? 0)}
              r={3}
              fill="var(--chart)"
            />
          )}
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
                fill="var(--chart)"
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
          className="pointer-events-none absolute top-0 z-10 rounded-[8px] bg-surface px-3 py-2 text-[12px] shadow-pop ring-1 ring-hair"
          style={{ left: Math.min(width - 170, Math.max(0, MARGIN.left + x(active.at) + 12)) }}
        >
          <div className="font-medium">{label(active.at, bucketMs)}</div>
          <div className="font-mono text-sec">
            avg {ms(active.avgLatencyMs)} · {highLabel} {ms(active.highLatencyMs)}
          </div>
        </div>
      )}
    </div>
  );
}

export function LatencyChart({ height = 280, ...props }: Props & { height?: number }) {
  return (
    <div style={{ height }}>
      <ParentSize debounceTime={50}>
        {({ width }) => (width > 0 ? <Chart {...props} width={width} height={height} /> : null)}
      </ParentSize>
    </div>
  );
}
