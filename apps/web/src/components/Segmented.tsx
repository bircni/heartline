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
    <div role="group" aria-label={label} className="flex rounded-[9px] bg-fill p-0.5">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={`flex-1 rounded-[7px] font-medium transition-colors ${size === 'sm' ? 'px-2.5 py-1 text-[12px]' : 'px-3.5 py-1.5 text-[13px]'} ${on ? 'bg-seg text-text shadow-seg' : 'text-sec hover:text-text'}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
