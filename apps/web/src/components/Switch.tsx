export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors disabled:opacity-50"
      style={{ background: checked ? 'var(--ok)' : 'var(--fill-2)' }}
    >
      <span
        className="absolute top-[2px] h-[18px] w-[18px] rounded-full bg-knob shadow-[0_1px_3px_rgb(0_0_0/0.3)] transition-[left]"
        style={{ left: checked ? 18 : 2 }}
      />
    </button>
  );
}
