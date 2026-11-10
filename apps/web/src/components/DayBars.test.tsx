import type { DayBar } from '@heartline/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BucketBars, DayBars, traceFloor } from './DayBars.tsx';

afterEach(cleanup);

const bars: DayBar[] = [
  {
    day: '2026-10-30',
    state: 'operational',
    uptime: 100,
    avgLatencyMs: 120,
    p95LatencyMs: 180,
    checks: 1440,
  },
  { day: '2026-10-31', state: 'down', uptime: 96.5, avgLatencyMs: 300, p95LatencyMs: 900, checks: 1440 },
  { day: '2026-11-01', state: 'nodata', uptime: null, avgLatencyMs: null, p95LatencyMs: null, checks: 0 },
];

describe('DayBars', () => {
  it('renders one bar per day and a screen-reader summary', () => {
    const { container } = render(<DayBars bars={bars} />);
    expect(container.querySelectorAll('[aria-hidden="true"] > span')).toHaveLength(3);
    expect(screen.getByText(/1 outage days, 0 degraded days in these 3 days/)).toBeTruthy();
  });

  it('shows details for the hovered day', () => {
    const { container } = render(<DayBars bars={bars} />);
    fireEvent.mouseEnter(container.querySelectorAll('[aria-hidden="true"] > span')[1] as Element);
    const tip = screen.getByRole('tooltip');
    expect(tip.textContent).toContain('Outage');
    expect(tip.textContent).toContain('96.50% uptime');
    expect(tip.textContent).toContain('p95 900 ms');
  });

  it('places an outage in its own bucket instead of the whole day', () => {
    const hour = 3_600_000;
    const point = { avgLatencyMs: null, highLatencyMs: null, checks: 60, down: 12 };
    const { container } = render(
      <BucketBars
        points={[{ ...point, at: 1.5 * hour, state: 'down' }]}
        from={0}
        to={3 * hour}
        bucketMs={hour}
      />,
    );
    const marks = container.querySelectorAll('[aria-hidden="true"] > span');
    expect(marks).toHaveLength(4);
    fireEvent.mouseEnter(marks[1] as Element);
    expect(screen.getByRole('tooltip').textContent).toContain('12 of 60 checks down');
    expect(screen.getByText('1 of 4 60-minute periods with an outage')).toBeTruthy();
  });
});

describe('availability graph', () => {
  it('is the default view and draws an outage day in red over a red band', () => {
    const { container } = render(<DayBars bars={bars} />);
    const svg = container.querySelector('svg') as SVGSVGElement;
    expect(svg).toBeTruthy();
    expect(svg.querySelector('rect[fill="var(--bad-band)"]')?.getAttribute('x')).toBe('1');
    const red = svg.querySelector('path[stroke="var(--bad)"]')?.getAttribute('d') ?? '';
    // Only the second day (x 1 to 2) is drawn in red.
    expect(red).toMatch(/^M1 [\d.]+H2$/);
  });

  it('breaks the line on days without data instead of inventing uptime', () => {
    const { container } = render(<DayBars bars={bars} />);
    const line = container.querySelector('path[stroke="var(--ok)"]')?.getAttribute('d') ?? '';
    expect(line).not.toContain('H3');
  });

  it('draws one coloured bar per day in the timeline view, without the graph', () => {
    const { container } = render(<DayBars bars={bars} view="timeline" />);
    expect(container.querySelector('svg')).toBeNull();
    const marks = [...container.querySelectorAll<HTMLElement>('[aria-hidden="true"] > span')];
    expect(marks.map((m) => m.style.background)).toEqual(['var(--ok)', 'var(--bad)', 'var(--fill-2)']);
  });
});

describe('traceFloor', () => {
  it('zooms in on small dips and steps down for large ones', () => {
    expect(traceFloor([100, 99.5, null])).toBe(99);
    expect(traceFloor([100, 96.5])).toBe(95);
    expect(traceFloor([100, 72])).toBe(70);
    expect(traceFloor([null])).toBe(99);
  });
});
