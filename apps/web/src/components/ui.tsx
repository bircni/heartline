import type { ReactNode } from 'react';

/** Headline figures of a record, side by side on one surface. */
export function Stats({ items }: { items: { label: string; value: ReactNode; hint?: string }[] }) {
  return (
    <dl className="card m-0 grid grid-cols-2 overflow-hidden md:auto-cols-fr md:grid-flow-col md:grid-cols-none">
      {items.map((i) => (
        <div key={i.label} className="-mr-px -mb-px border-r border-b border-hair px-3.5 py-3">
          <dt className="text-[12px] text-sec">
            {i.label}
            {i.hint && <span className="text-muted"> ({i.hint})</span>}
          </dt>
          <dd className="m-0 mt-0.5 text-[22px] leading-7 font-semibold tracking-[-0.01em]">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase() || '?';
}

/** A user's picture, or their initials on a grey disc. */
export function Avatar({ name, image, size = 28 }: { name: string; image?: string | null; size?: number }) {
  if (image)
    return (
      <img
        src={image}
        alt=""
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-full bg-fill-2 font-semibold"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.41) }}
    >
      {initials(name)}
    </span>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <h1 className="m-0 text-[18px] leading-snug font-semibold tracking-[-0.01em]">{title}</h1>
        {subtitle && <div className="mt-1 text-sec">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Section({
  title,
  actions,
  children,
  className = '',
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card overflow-hidden ${className}`}>
      {(title || actions) && (
        <div className="panel-head">
          {title && <h2 className="m-0 flex-1 text-[13px] font-semibold">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="m-0 px-3.5 py-4 text-sec">{children}</p>;
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-10 text-sec" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-fill-2 border-t-text" />
      {label}
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  return (
    <div role="alert" className="card border-bad-line bg-bad-bg px-3.5 py-3 text-bad-text">
      {error instanceof Error ? error.message : 'Something went wrong.'}
    </div>
  );
}

export function Field({
  label,
  htmlFor,
  children,
  hint,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="mt-3">
      <label htmlFor={htmlFor} className="label">
        {label}
      </label>
      {children}
      {hint && <div className="mt-1 text-[12px] text-sec">{hint}</div>}
    </div>
  );
}

const NOTICE = {
  neutral: 'bg-fill text-sec',
  warn: 'bg-warn-bg text-warn-text',
  bad: 'bg-bad-bg text-bad-text',
  ok: 'bg-ok-bg text-ok-text',
} as const;

export function Notice({ tone = 'neutral', children }: { tone?: keyof typeof NOTICE; children: ReactNode }) {
  return <div className={`rounded-md px-3 py-2 text-[13px] ${NOTICE[tone]}`}>{children}</div>;
}
