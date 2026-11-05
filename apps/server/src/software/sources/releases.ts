import { cleanVersion, compareVersions, extractVersion } from '../version.ts';
import { type SourceOpts, fetchCached } from './cache.ts';

export const GITHUB_API = 'https://api.github.com';
const TTL = 12 * 3_600_000;

export interface LatestRelease {
  version: string;
  url: string | null;
  publishedAt: number | null;
}

export interface ReleaseSpec {
  gitea?: string | undefined;
  repo?: string | undefined;
  github?: string | undefined;
  url?: string | undefined;
  json?: string | undefined;
  regex?: string | undefined;
  headers?: Record<string, string> | undefined;
  prerelease?: boolean | undefined;
}

interface ReleaseEntry {
  tag: string;
  url: string | null;
  publishedAt: number | null;
  draft: boolean;
  prerelease: boolean;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const date = (v: unknown): number | null => {
  const t = typeof v === 'string' ? Date.parse(v) : Number.NaN;
  return Number.isFinite(t) ? t : null;
};

/** Gitea, Forgejo and GitHub share the same release JSON shape. */
export function parseReleases(text: string): ReleaseEntry[] {
  const raw = JSON.parse(text) as unknown;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
    .map((r) => ({
      tag: str(r.tag_name) ?? str(r.name) ?? '',
      url: str(r.html_url),
      publishedAt: date(r.published_at) ?? date(r.created_at),
      draft: Boolean(r.draft),
      prerelease: Boolean(r.prerelease),
    }))
    .filter((r) => r.tag);
}

/** Tag lists (`/tags`) only carry names; links are built by the caller. */
export function parseTags(text: string): string[] {
  const raw = JSON.parse(text) as unknown;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((t) => (typeof t === 'object' && t !== null ? str((t as Record<string, unknown>).name) : null))
    .filter((n): n is string => n !== null);
}

/** The highest version among releases that are published and (unless allowed) not pre-releases. */
export function pickLatest(entries: ReleaseEntry[], prerelease: boolean): LatestRelease | null {
  let best: { release: ReleaseEntry; version: string } | null = null;
  for (const r of entries) {
    if (r.draft || (r.prerelease && !prerelease)) continue;
    const version = cleanVersion(r.tag);
    if (!/^\d/.test(version)) continue;
    if (!best || compareVersions(version, best.version) > 0) best = { release: r, version };
  }
  return best
    ? { version: best.version, url: best.release.url, publishedAt: best.release.publishedAt }
    : null;
}

export class ReleasesClient {
  #opts: SourceOpts;
  #githubToken: string | null;
  constructor(opts: SourceOpts, githubToken: string | null) {
    this.#opts = opts;
    this.#githubToken = githubToken;
  }

  async latest(spec: ReleaseSpec): Promise<LatestRelease | null> {
    if (spec.github) return this.github(spec.github, spec.prerelease ?? false);
    if (spec.gitea && spec.repo)
      return this.gitea(spec.gitea, spec.repo, spec.headers ?? {}, spec.prerelease ?? false);
    if (spec.url) return this.generic(spec.url, spec, spec.headers ?? {});
    return null;
  }

  async github(repo: string, prerelease: boolean): Promise<LatestRelease | null> {
    const headers: Record<string, string> = { accept: 'application/vnd.github+json' };
    if (this.#githubToken) headers.authorization = `Bearer ${this.#githubToken}`;
    const releases = await fetchCached(
      `gh:releases:${repo}`,
      `${GITHUB_API}/repos/${repo}/releases?per_page=30`,
      { method: 'GET', headers },
      TTL,
      parseReleases,
      this.#opts,
    );
    const best = pickLatest(releases.data, prerelease);
    if (best) return best;
    const tags = await fetchCached(
      `gh:tags:${repo}`,
      `${GITHUB_API}/repos/${repo}/tags?per_page=30`,
      { method: 'GET', headers },
      TTL,
      parseTags,
      this.#opts,
    );
    const fromTags = pickLatest(
      tags.data.map((tag) => ({
        tag,
        url: `https://github.com/${repo}/releases/tag/${encodeURIComponent(tag)}`,
        publishedAt: null,
        draft: false,
        prerelease: false,
      })),
      true,
    );
    return fromTags;
  }

  async gitea(
    base: string,
    repo: string,
    headers: Record<string, string>,
    prerelease: boolean,
  ): Promise<LatestRelease | null> {
    const root = base.replace(/\/$/, '');
    const releases = await fetchCached(
      `gitea:releases:${root}/${repo}`,
      `${root}/api/v1/repos/${repo}/releases?limit=30`,
      { method: 'GET', headers: { accept: 'application/json', ...headers } },
      TTL,
      parseReleases,
      this.#opts,
    );
    const best = pickLatest(releases.data, prerelease);
    if (best) return best;
    const tags = await fetchCached(
      `gitea:tags:${root}/${repo}`,
      `${root}/api/v1/repos/${repo}/tags?limit=30`,
      { method: 'GET', headers: { accept: 'application/json', ...headers } },
      TTL,
      parseTags,
      this.#opts,
    );
    return pickLatest(
      tags.data.map((tag) => ({
        tag,
        url: `${root}/${repo}/releases/tag/${encodeURIComponent(tag)}`,
        publishedAt: null,
        draft: false,
        prerelease: false,
      })),
      true,
    );
  }

  async generic(
    url: string,
    ex: { json?: string | undefined; regex?: string | undefined },
    headers: Record<string, string>,
  ) {
    const res = await fetchCached(
      `rel:${url}`,
      url,
      { method: 'GET', headers: { accept: 'application/json, text/plain, */*', ...headers } },
      TTL,
      (text) => text,
      this.#opts,
    );
    const version = extractVersion(ex, { status: 200, headers: new Headers(), body: res.data });
    return version ? { version, url: null, publishedAt: null } : null;
  }
}
