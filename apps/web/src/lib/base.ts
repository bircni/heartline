/**
 * The sub-path the app is served under (`/status` for BASE_URL=https://example.com/status), or `''` at the
 * root. The server writes it into index.html as `<base href>`.
 */
export const BASE_PATH =
  typeof document === 'undefined' ? '' : new URL(document.baseURI).pathname.replace(/\/+$/, '');

/** A root-relative app or API path (`/api/v1/...`) as a URL path on this site. */
export const withBase = (path: string): string => `${BASE_PATH}${path}`;

/** The public URL of this site, e.g. for snippets that other pages embed. */
export const siteUrl = (): string => `${window.location.origin}${BASE_PATH}`;

/** The current location as a router path, without the sub-path: for `?redirect=` after signing in. */
export function currentAppPath(): string {
  const { pathname, search } = window.location;
  const path =
    BASE_PATH && pathname.startsWith(BASE_PATH) ? pathname.slice(BASE_PATH.length) || '/' : pathname;
  return path + search;
}
