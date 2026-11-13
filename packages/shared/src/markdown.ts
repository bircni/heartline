import MarkdownIt from 'markdown-it';

/*
 * Markdown for incident updates, postmortems and maintenance descriptions. Raw HTML is escaped and
 * images are off, so text from any editor renders the same and loads nothing from elsewhere; links get
 * safe attributes. Single line breaks are kept, like the plain text written before Markdown support.
 */
const md = new MarkdownIt({ html: false, linkify: true, breaks: true, typographer: false }).disable([
  'image',
]);

const defaultLink =
  md.renderer.rules.link_open ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  if (token) {
    token.attrSet('target', '_blank');
    token.attrSet('rel', 'noopener noreferrer nofollow');
  }
  return defaultLink(tokens, idx, options, env, self);
};

/** Safe HTML for a Markdown text. */
export function renderMarkdown(text: string): string {
  return md.render(text);
}

/** Plain text of a Markdown text, for previews, feeds and meta descriptions. */
export function markdownToText(text: string): string {
  return md
    .render(text)
    .replace(/<\/(p|li|h[1-6]|blockquote|pre)>/g, '\n')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{2,}/g, '\n')
    .trim();
}
