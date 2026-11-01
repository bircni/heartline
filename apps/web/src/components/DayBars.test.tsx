import type { DayBar } from '@heartline/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DayBars } from './DayBars.tsx';

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
    expect(screen.getByText(/1 outage days, 0 degraded days in the last 3 days/)).toBeTruthy();
  });

  it('shows details for the hovered day', () => {
    const { container } = render(<DayBars bars={bars} />);
    fireEvent.mouseEnter(container.querySelectorAll('[aria-hidden="true"] > span')[1] as Element);
    const tip = screen.getByRole('tooltip');
    expect(tip.textContent).toContain('Outage');
    expect(tip.textContent).toContain('96.50%');
    expect(tip.textContent).toContain('p95 900 ms');
  });
});
