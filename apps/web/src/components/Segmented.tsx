export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
  size = 'md',
  columns,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  size?: 'sm' | 'md';
  /** Lay the options out in rows of this many instead of one line. */
  columns?: number;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`${columns ? 'grid gap-0.5' : 'flex'} rounded-md bg-fill p-0.5`}
      style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={`flex-1 rounded-sm font-medium whitespace-nowrap transition-colors ${size === 'sm' ? 'h-6 px-2 text-xs' : 'h-[26px] px-2.5 text-xs'} ${on ? 'bg-surface text-text shadow-[0_0_0_1px_var(--hair)]' : 'text-sec hover:text-text'}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
