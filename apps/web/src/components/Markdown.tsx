import { renderMarkdown } from '@heartline/shared';
import { useMemo } from 'react';

/**
 * Incident updates, postmortems and maintenance descriptions. The renderer escapes raw HTML and allows no
 * images, so its output is safe to insert.
 */
export function Markdown({ text, className = '' }: { text: string; className?: string }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  return (
    // oxlint-disable-next-line react/no-danger -- renderMarkdown escapes HTML and drops images
    <div className={`markdown ${className}`} dangerouslySetInnerHTML={{ __html: html }} />
  );
}
