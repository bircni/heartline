import { markdownToText } from '@heartline/shared';
import type { AppContext } from '../context.ts';

export interface PageMeta {
  title: string;
  description: string;
  /** Keep the page out of search engines. */
  noindex: boolean;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const clip = (s: string, n = 200) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/**
 * Title and description of a page, for link previews and search engines; the web app is rendered in the
 * browser, so crawlers and chat apps only see what the server puts in the HTML. Private sites, sign-in,
 * admin and e-mail link pages get the site title only and are not indexed.
 */
export async function pageMeta(app: AppContext, path: string): Promise<PageMeta> {
  const site = app.site();
  const generic = (noindex: boolean): PageMeta => ({
    title: site.title,
    description: site.description ?? `Current status of ${site.title}`,
    noindex,
  });
  if (!app.config().site.public) return generic(true);
  if (/^\/(admin|login|consent|subscriptions|embed)(\/|$)/.test(path)) return generic(true);
  try {
    if (path === '/') {
      const o = await app.queries.overview(1);
      return { title: site.title, description: `${o.headline}. ${o.summary}`, noindex: false };
    }
    if (path === '/incidents')
      return {
        title: `Incident history · ${site.title}`,
        description: `Incidents and their updates on ${site.title}`,
        noindex: false,
      };
    if (path === '/subscribe')
      return {
        title: `Get notified · ${site.title}`,
        description: `E-mail and feed updates from ${site.title}`,
        noindex: false,
      };
    let m = path.match(/^\/incidents\/([^/]+)$/);
    if (m?.[1]) {
      const i = await app.incidents.get(decodeURIComponent(m[1]));
      const latest = i.updates[0];
      return {
        title: `${i.title} · ${site.title}`,
        description: clip(
          `${i.resolvedAt ? 'Resolved' : 'Ongoing'}. ${latest ? markdownToText(latest.message) : ''}`.trim(),
        ),
        noindex: false,
      };
    }
    m = path.match(/^\/maintenance\/([^/]+)$/);
    if (m?.[1]) {
      const w = app.maintenance.get(decodeURIComponent(m[1]));
      const start = new Date(w.nextStartsAt ?? w.startsAt).toUTCString();
      return {
        title: `${w.title} · ${site.title}`,
        description: clip(
          `Maintenance, ${w.status.replace('_', ' ')}: ${start}. ${w.description ? markdownToText(w.description) : ''}`.trim(),
        ),
        noindex: false,
      };
    }
    m = path.match(/^\/services\/([^/]+)$/);
    if (m?.[1]) {
      const id = decodeURIComponent(m[1]);
      const s = (await app.queries.summaries(30)).find((x) => x.id === id);
      if (s)
        return {
          title: `${s.name} · ${site.title}`,
          description: `${s.name} is ${s.status === 'operational' ? 'operational' : s.status}${s.uptime === null ? '' : `, ${s.uptime.toFixed(2)}% uptime over 30 days`}.`,
          noindex: false,
        };
    }
  } catch {
    // Unknown incident or service: the app shows its own error.
  }
  return generic(false);
}

/** index.html with the page's title, meta tags, favicon and canonical URL. */
export function renderIndex(
  template: string,
  meta: PageMeta,
  opts: { url: string; siteName: string; favicon: string | null; image: string | null },
): string {
  const t = escapeHtml(meta.title);
  const d = escapeHtml(meta.description);
  const tags = [
    `<meta name="description" content="${d}" />`,
    meta.noindex ? '<meta name="robots" content="noindex" />' : '',
    `<link rel="canonical" href="${escapeHtml(opts.url)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${escapeHtml(opts.siteName)}" />`,
    `<meta property="og:title" content="${t}" />`,
    `<meta property="og:description" content="${d}" />`,
    `<meta property="og:url" content="${escapeHtml(opts.url)}" />`,
    opts.image ? `<meta property="og:image" content="${escapeHtml(opts.image)}" />` : '',
    `<meta name="twitter:card" content="${opts.image ? 'summary_large_image' : 'summary'}" />`,
  ]
    .filter(Boolean)
    .join('\n    ');
  let html = template
    .replace(/<title>[^<]*<\/title>/, `<title>${t}</title>`)
    .replace('<!--app-head-->', tags);
  if (opts.favicon)
    html = html.replace(/<link rel="icon"[^>]*>/, `<link rel="icon" href="${escapeHtml(opts.favicon)}" />`);
  return html;
}
