import { useState } from 'react';
import { Icon } from './Icon.tsx';

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn-sm shrink-0"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      <Icon name={done ? 'check' : 'copy'} size={16} /> {done ? 'Copied' : label}
    </button>
  );
}

/** One line of code to copy, e.g. an embed snippet or a command. */
export function CodeSnippet({ code, label }: { code: string; label?: string }) {
  return (
    <div className="mt-2">
      {label && <div className="mb-1 text-xs font-medium text-sec">{label}</div>}
      <div className="flex items-center gap-2 rounded-md bg-fill px-3 py-2">
        <code className="min-w-0 flex-1 overflow-x-auto font-mono text-xs whitespace-nowrap">{code}</code>
        <CopyButton text={code} />
      </div>
    </div>
  );
}

/** Snippets that show a service's uptime (and optionally version) badge on another page, e.g. a README. */
export function BadgeSnippet({ id, name, version = false }: { id: string; name: string; version?: boolean }) {
  const origin = window.location.origin;
  const page = `${origin}/services/${encodeURIComponent(id)}`;
  const badge = (kind?: 'version') =>
    `${origin}/api/v1/badge/${encodeURIComponent(id)}.svg${kind ? `?kind=${kind}` : ''}`;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <img src={badge()} alt={`${name} uptime`} height={20} />
        {version && <img src={badge('version')} alt={`${name} version`} height={20} />}
      </div>
      <CodeSnippet label="Markdown" code={`[![${name} uptime](${badge()})](${page})`} />
      <CodeSnippet label="HTML" code={`<a href="${page}"><img src="${badge()}" alt="${name} uptime"></a>`} />
      {version && (
        <CodeSnippet label="Version badge" code={`[![${name} version](${badge('version')})](${page})`} />
      )}
    </div>
  );
}
