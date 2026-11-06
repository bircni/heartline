import type { MonitorSpec, SoftwareConfig } from '@heartline/shared';
import { fetch as undiciFetch } from 'undici';
import { errorMessage } from '../checks/types.ts';
import { insecureDispatcher } from '../util/insecure.ts';
import type { CatalogEntry } from './catalog.ts';
import { type ProbeResponse, type VersionExtractor, extractVersion } from './version.ts';

export type ResolvedProbe =
  | { mode: 'static'; version: string }
  | { mode: 'inline'; extractor: VersionExtractor }
  | {
      mode: 'separate';
      url: string;
      method: 'GET' | 'HEAD' | 'POST';
      headers: Record<string, string>;
      extractor: VersionExtractor;
      ignoreTls: boolean;
      intervalMs: number;
    }
  | { mode: 'plugin' }
  | { mode: 'none'; error: string };

const hasExtractor = (e: VersionExtractor | undefined) =>
  Boolean(e && (e.json !== undefined || e.header || e.regex));

/** Decides how the running version of a monitor is found. Pure. */
export function resolveProbe(spec: MonitorSpec, entry: CatalogEntry | undefined): ResolvedProbe {
  const sw: SoftwareConfig | undefined = spec.software;
  if (!sw) return { mode: 'none', error: 'no software block' };
  const v = sw.version;
  if (v?.static) return { mode: 'static', version: v.static };
  const explicit = hasExtractor(v);
  const catalogProbe = entry?.probe ?? null;
  const separate = (url: string, extractor: VersionExtractor): ResolvedProbe => ({
    mode: 'separate',
    url,
    method: v?.method ?? 'GET',
    headers: v?.headers ?? {},
    extractor,
    ignoreTls: v?.ignoreTls ?? (spec.type === 'http' ? spec.ignoreTls : false),
    intervalMs: v?.interval ?? 3_600_000,
  });
  if (v?.url) {
    if (explicit) return separate(v.url, v);
    if (catalogProbe) return separate(v.url, catalogProbe);
    return { mode: 'none', error: 'software.version needs json, header or regex' };
  }
  if (spec.type === 'http') {
    if (explicit) return { mode: 'inline', extractor: v as VersionExtractor };
    if (catalogProbe) {
      let url: string;
      try {
        url = new URL(catalogProbe.path, spec.url).toString();
      } catch {
        return { mode: 'none', error: 'cannot resolve the catalog probe against the monitor URL' };
      }
      return separate(url, catalogProbe);
    }
    return { mode: 'none', error: 'no version probe configured' };
  }
  if (spec.type === 'plugin') return { mode: 'plugin' };
  return { mode: 'none', error: 'no version probe configured' };
}

const MAX_BODY = 256 * 1024;

export interface ProbeOutcome {
  version: string | null;
  error: string | null;
}

/** Fetches a separate version endpoint and extracts the version. Never throws. */
export async function probeVersion(
  probe: Extract<ResolvedProbe, { mode: 'separate' }>,
  fetchImpl: typeof fetch,
  userAgent: string,
  signal?: AbortSignal,
): Promise<ProbeOutcome> {
  try {
    const init: RequestInit = {
      method: probe.method,
      headers: { 'user-agent': userAgent, accept: 'application/json, text/plain, */*', ...probe.headers },
      redirect: 'follow',
      signal: AbortSignal.any([AbortSignal.timeout(10_000), ...(signal ? [signal] : [])]),
    };
    const res = probe.ignoreTls
      ? ((await undiciFetch(probe.url, {
          ...(init as object),
          dispatcher: insecureDispatcher(),
        })) as unknown as Response)
      : await fetchImpl(probe.url, init);
    let body = '';
    if (probe.extractor.header) await res.body?.cancel();
    else body = (await res.text()).slice(0, MAX_BODY);
    if (res.status >= 400) return { version: null, error: `HTTP ${res.status}` };
    const response: ProbeResponse = { status: res.status, headers: res.headers, body };
    const version = extractVersion(probe.extractor, response);
    return version ? { version, error: null } : { version: null, error: 'version not found in the response' };
  } catch (error) {
    return { version: null, error: errorMessage(error) };
  }
}
