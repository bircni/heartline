import { type ReactNode, createContext, useContext } from 'react';
import { ApiError } from '../lib/api.ts';
import { usePageTitle } from '../lib/title.ts';

/** Field id → message for the fields of the enclosing form that the server rejected. */
const FieldErrorsContext = createContext<Record<string, string>>({});

/**
 * Maps a failed request's per-field issues onto the form's fields. `fields` maps a request path (`spec.url`) to
 * the id of the input showing it (`m-url`); a nested path such as `spec.expect.0` uses its longest listed prefix.
 */
export function fieldErrorsOf(
  error: unknown,
  fields: Record<string, string>,
): {
  byId: Record<string, string>;
  /** Problems no field shows; the form lists these in its summary. */
  rest: string[];
} {
  const byId: Record<string, string> = {};
  const rest: string[] = [];
  if (!(error instanceof ApiError)) return { byId, rest: error instanceof Error ? [error.message] : [] };
  if (error.issues.length === 0) return { byId, rest: [error.message] };
  for (const issue of error.issues) {
    const key = Object.keys(fields)
      .filter((k) => issue.path === k || issue.path.startsWith(`${k}.`))
      .sort((a, b) => b.length - a.length)[0];
    const id = key ? fields[key] : undefined;
    if (id) byId[id] ??= issue.message;
    else rest.push(issue.path ? `${issue.path}: ${issue.message}` : issue.message);
  }
  return { byId, rest };
}

/** Provides per-field errors to every `Field` inside, keyed by the field's input id. */
export function FieldErrors({ errors, children }: { errors: Record<string, string>; children: ReactNode }) {
  return <FieldErrorsContext.Provider value={errors}>{children}</FieldErrorsContext.Provider>;
}

/** Headline figures of a record, side by side on one surface. */
export function Stats({ items }: { items: { label: string; value: ReactNode; hint?: string }[] }) {
  return (
    <dl className="card m-0 grid grid-cols-2 overflow-hidden md:auto-cols-fr md:grid-flow-col md:grid-cols-none">
      {items.map((i) => (
        <div key={i.label} className="-mr-px -mb-px border-r border-b border-hair px-3.5 py-3">
          <dt className="text-xs text-sec">
            {i.label}
            {i.hint && <span className="text-muted"> ({i.hint})</span>}
          </dt>
          <dd className="m-0 mt-0.5 text-3xl leading-7 font-semibold tracking-[-0.01em]">{i.value}</dd>
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
  pageTitle,
  subtitle,
  actions,
}: {
  title: ReactNode;
  /** Tab title when `title` is markup rather than text. */
  pageTitle?: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  usePageTitle(pageTitle ?? (typeof title === 'string' ? title : undefined));
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <h1 className="m-0 text-xl leading-snug font-semibold tracking-[-0.01em]">{title}</h1>
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
          {title && <h2 className="m-0 flex-1 text-base font-semibold">{title}</h2>}
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
  // A session that ended (or a private page) gets a way back in instead of the raw API message.
  if (error instanceof ApiError && error.status === 401)
    return (
      <div role="alert" className="card px-3.5 py-3">
        Sign in to see this page.{' '}
        <a
          href={`/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`}
          className="font-medium text-text"
        >
          Sign in
        </a>
      </div>
    );
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
  error,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
  hint?: ReactNode;
  /** A problem with the value, shown in place of the hint. Defaults to the enclosing `FieldErrors`. */
  error?: string;
}) {
  const fromForm = useContext(FieldErrorsContext)[htmlFor];
  error ??= fromForm;
  return (
    <div className={`mt-3 ${error ? 'field-invalid' : ''}`}>
      <label htmlFor={htmlFor} className="label">
        {label}
      </label>
      {children}
      {error ? (
        <div id={`${htmlFor}-error`} className="mt-1 text-xs text-bad-text">
          {error}
        </div>
      ) : (
        hint && <div className="mt-1 text-xs text-sec">{hint}</div>
      )}
    </div>
  );
}

/** An empty list: what is missing and, optionally, how to add the first entry. */
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-3.5 py-8 text-center">
      <div className="font-medium">{title}</div>
      {children && <div className="mx-auto mt-1 max-w-[28rem] text-sec">{children}</div>}
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
  return <div className={`rounded-md px-3 py-2 text-base ${NOTICE[tone]}`}>{children}</div>;
}
