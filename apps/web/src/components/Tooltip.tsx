import { useId, useState } from 'react';

/**
 * A "?" that explains something: opens on hover, keyboard focus and tap. The text is also the button's
 * description for screen readers.
 */
export function InfoTip({ text, label = 'More information' }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={label}
        aria-describedby={id}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-hair text-[10px] leading-none font-semibold text-sec hover:text-text"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => {
          // Inside a link or a toggle the tap only opens the tip.
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        ?
      </button>
      <span
        id={id}
        role="tooltip"
        className={`popover top-6 left-1/2 z-50 w-max max-w-[16rem] -translate-x-1/2 px-2.5 py-1.5 text-xs font-normal whitespace-normal text-text ${open ? '' : 'sr-only'}`}
      >
        {text}
      </span>
    </span>
  );
}
