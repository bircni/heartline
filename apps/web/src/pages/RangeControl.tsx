import { useNavigate, useSearch } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { Icon } from '../components/Icon.tsx';
import { usePopover } from '../components/Popover.tsx';
import { Segmented } from '../components/Segmented.tsx';
import { MAX_RANGE_DAYS, addDays, dayKey, isDayKey } from '@heartline/shared';
import { type Range, useBootstrap } from '../lib/api.ts';
import { DAY_MS, shortDate, shortDay } from '../lib/format.ts';

const RANGES = [7, 30, 90] as const;

export function useRange(fallback = 90): Range {
  // Non-strict search also carries the root route's raw params, so the range is checked here as well.
  const { days, to } = useSearch({ strict: false }) as { days?: unknown; to?: unknown };
  const n = Number(days);
  return {
    days: Number.isInteger(n) && n >= 1 && n <= MAX_RANGE_DAYS ? n : fallback,
    to: typeof to === 'string' && isDayKey(to) ? to : undefined,
  };
}

/** Label at the right end of a time axis: the range's last day, or "Today". */
export function rangeEndLabel({ to }: Range): string {
  return to ? shortDay(to) : 'Today';
}

/** "Aug 13 – Nov 10, 2026" for the range ending on `to`, or on `today` when it has no end day. */
function rangeLabel({ days, to }: Range, today: string): string {
  const end = to ?? today;
  return `${shortDay(addDays(end, 1 - days))} – ${shortDate(end)}`;
}

/** Last N days presets, plus a button that opens a custom from/to range. */
export function RangeControl({ fallback = 90 }: { fallback?: number }) {
  const range = useRange(fallback);
  const navigate = useNavigate();
  const { ref: popRef, ...pop } = usePopover();
  const timeZone = useBootstrap().data?.site.timezone ?? 'UTC';
  // The server's days follow the site time zone, so "today" does too. Fixed for the lifetime of the
  // control, so a range picked across midnight still ends on the day shown.
  const [now] = useState(() => Date.now());
  const today = dayKey(now, timeZone);
  const end = range.to ?? today;
  // Filled from the current range each time the picker opens.
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const go = (next: Range) =>
    void navigate({
      to: '.',
      search: (prev: Record<string, unknown>) => ({ ...prev, days: next.days, to: next.to }),
    });
  const preset = !range.to && (RANGES as readonly number[]).includes(range.days);

  const span = Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1;
  // While a field is empty the button is simply disabled; the message explains real conflicts only.
  const incomplete = !from || !to;
  const invalid =
    span < 1
      ? 'The first day must come before the last.'
      : span > MAX_RANGE_DAYS
        ? `Pick at most ${MAX_RANGE_DAYS} days.`
        : to > today
          ? 'The last day cannot be in the future.'
          : null;
  const apply = (e: FormEvent) => {
    e.preventDefault();
    if (incomplete || invalid) return;
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
            {!incomplete && invalid && <p className="m-0 text-xs text-bad-text">{invalid}</p>}
            <div className="flex gap-2">
              <button type="submit" className="btn-primary flex-1" disabled={incomplete || invalid !== null}>
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
