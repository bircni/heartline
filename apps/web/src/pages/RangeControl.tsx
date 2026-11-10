import { useNavigate, useSearch } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { Icon } from '../components/Icon.tsx';
import { usePopover } from '../components/Popover.tsx';
import { Segmented } from '../components/Segmented.tsx';
import { useBootstrap } from '../lib/api.ts';
import { addDays, dayIn, shortDate, shortDay } from '../lib/format.ts';

export const RANGES = [7, 30, 90] as const;
/** Longest range the API serves. */
export const MAX_DAYS = 365;

export interface Range {
  days: number;
  /** Last day (`YYYY-MM-DD`); undefined means today. */
  to?: string;
}

export function useRange(fallback = 90): Range {
  const { days, to } = useSearch({ strict: false }) as { days?: number; to?: string };
  return { days: days ?? fallback, to };
}

/** Search params of a range, for links that keep the current one. */
export function rangeSearch(range: Range): Record<string, unknown> {
  return { days: range.days, to: range.to };
}

/** "Aug 13 – Nov 10, 2026" for the range ending on `to`, or on `today` when it has no end day. */
export function rangeLabel({ days, to }: Range, today: string): string {
  const end = to ?? today;
  return `${shortDay(addDays(end, 1 - days))} – ${shortDate(end)}`;
}

/** Last N days presets, plus a button that opens a custom from/to range. */
export function RangeControl({ fallback = 90 }: { fallback?: number }) {
  const range = useRange(fallback);
  const navigate = useNavigate();
  const { ref: popRef, ...pop } = usePopover();
  // Fixed for the lifetime of the control; a range picked across midnight still ends on the day shown.
  const timeZone = useBootstrap().data?.site.timezone ?? 'UTC';
  // The server's days follow the site time zone, so "today" does too. Fixed for the lifetime of the control.
  const [now] = useState(() => Date.now());
  const today = dayIn(now, timeZone);
  const end = range.to ?? today;
  const [from, setFrom] = useState(addDays(end, 1 - range.days));
  const [to, setTo] = useState(end);
  const go = (next: Range) =>
    void navigate({
      to: '.',
      search: (prev: Record<string, unknown>) => ({ ...prev, days: next.days, to: next.to }),
    });
  const preset = !range.to && (RANGES as readonly number[]).includes(range.days);

  const span = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
  const invalid =
    !from || !to
      ? 'Pick both days.'
      : span < 1
        ? 'The first day must come before the last.'
        : span > MAX_DAYS
          ? `Pick at most ${MAX_DAYS} days.`
          : to > today
            ? 'The last day cannot be in the future.'
            : null;
  const apply = (e: FormEvent) => {
    e.preventDefault();
    if (invalid) return;
    go({ days: span, to: to === today ? undefined : to });
    pop.setOpen(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented
        label="Time range"
        value={preset ? range.days : 0}
        onChange={(v) => go({ days: v })}
        options={RANGES.map((r) => ({ value: r, label: `${r} days` }))}
      />
      <div ref={popRef} className="relative">
        <button
          type="button"
          className={`btn ${preset ? '' : 'border-accent'}`}
          aria-haspopup="dialog"
          aria-expanded={pop.open}
          onClick={() => {
            setFrom(addDays(end, 1 - range.days));
            setTo(end);
            pop.toggle();
          }}
        >
          <Icon name="calendar" size={14} />
          {rangeLabel(range, today)}
        </button>
        {pop.open && (
          <form
            role="dialog"
            aria-label="Date range"
            onSubmit={apply}
            className="popover right-0 top-9 flex w-64 flex-col gap-2.5 p-3"
          >
            <div>
              <label htmlFor="range-from" className="label">
                From
              </label>
              <input
                id="range-from"
                type="date"
                className="field"
                value={from}
                max={to || today}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="range-to" className="label">
                To
              </label>
              <input
                id="range-to"
                type="date"
                className="field"
                value={to}
                min={from}
                max={today}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
            {invalid && from && to && <p className="m-0 text-[12px] text-bad-text">{invalid}</p>}
            <div className="flex gap-2">
              <button type="submit" className="btn-primary flex-1" disabled={invalid !== null}>
                Show range
              </button>
              <button type="button" className="btn" onClick={() => pop.setOpen(false)}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
