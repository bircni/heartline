import { useNavigate, useSearch } from '@tanstack/react-router';
import { Segmented } from '../components/Segmented.tsx';

export const RANGES = [7, 30, 90] as const;

export function useRange(fallback = 90): number {
  const { days } = useSearch({ strict: false }) as { days?: number };
  return days ?? fallback;
}

export function RangeControl({ fallback = 90 }: { fallback?: number }) {
  const days = useRange(fallback);
  const navigate = useNavigate();
  return (
    <Segmented
      label="Time range"
      value={days}
      onChange={(v) =>
        void navigate({ to: '.', search: (prev: Record<string, unknown>) => ({ ...prev, days: v }) })
      }
      options={RANGES.map((r) => ({ value: r, label: `${r}D` }))}
    />
  );
}
