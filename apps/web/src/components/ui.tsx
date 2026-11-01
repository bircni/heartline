import type { ReactNode } from 'react';

export function Kpi({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="card px-4 py-3.5">
      <div className="text-[12px] text-sec">{label}</div>
      <div className="mt-0.5 text-[24px] font-semibold tracking-[-0.02em]">{value}</div>
      {hint && <div className="text-[12px] text-sec">{hint}</div>}
    </div>
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
    <div className="flex flex-wrap items-center justify-between gap-3 px-1 pt-2.5">
      <div className="min-w-0">
        <h1 className="m-0 text-[28px] font-semibold tracking-[-0.025em]">{title}</h1>
        {subtitle && <div className="mt-0.5 text-[13px] text-sec">{subtitle}</div>}
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
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-2.5 pt-3.5">
          {title && <h2 className="m-0 text-[14px] font-semibold">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="m-0 border-t border-hair px-4 py-4 text-sec">{children}</p>;
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 px-1 py-10 text-sec" role="status">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-fill-2 border-t-text" />
      {label}
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  return (
    <div role="alert" className="card mt-4 px-4 py-3 text-bad-text">
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

export function Notice({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'warn' | 'bad' | 'ok';
  children: ReactNode;
}) {
  const color =
    tone === 'warn'
      ? 'var(--warn-text)'
      : tone === 'bad'
        ? 'var(--bad-text)'
        : tone === 'ok'
          ? 'var(--ok-text)'
          : 'var(--sec)';
  return (
    <div className="rounded-[10px] bg-fill px-3 py-2.5 text-[13px]" style={{ color }}>
      {children}
    </div>
  );
}
