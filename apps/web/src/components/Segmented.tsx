export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
  size = 'md',
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div role="group" aria-label={label} className="flex rounded-md bg-fill p-0.5">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={`flex-1 rounded-sm font-medium whitespace-nowrap transition-colors ${size === 'sm' ? 'h-6 px-2 text-[12px]' : 'h-[26px] px-2.5 text-[12.5px]'} ${on ? 'bg-surface text-text shadow-[0_0_0_1px_var(--hair)]' : 'text-sec hover:text-text'}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
