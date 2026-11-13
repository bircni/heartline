import { useState } from 'react';
import { Markdown } from './Markdown.tsx';

/** A textarea for Markdown with a preview toggle. */
export function MarkdownField({
  id,
  value,
  onChange,
  rows = 4,
  placeholder,
  required,
  className = '',
  label,
}: {
  /** Accessible name when no <label> points at the field. */
  label?: string;
  id: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
  required?: boolean;
  className?: string;
}) {
  const [preview, setPreview] = useState(false);
  return (
    <div className={className}>
      {preview ? (
        <div className="min-h-[5rem] rounded-md border border-hair bg-bg px-2.5 py-2">
          {value.trim() ? <Markdown text={value} /> : <span className="text-muted">Nothing to preview</span>}
        </div>
      ) : (
        <textarea
          id={id}
          aria-label={label}
          rows={rows}
          required={required}
          className="field h-auto resize-y py-2"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      <div className="mt-1 flex items-center justify-between text-xs text-muted">
        <span>Markdown: **bold**, _italic_, lists, `code`, [links](https://…)</span>
        <button type="button" className="text-sec hover:text-text" onClick={() => setPreview(!preview)}>
          {preview ? 'Edit' : 'Preview'}
        </button>
      </div>
    </div>
  );
}
