import type { MonitorSpec } from '@heartline/shared';
import { fetch as undiciFetch } from 'undici';
import { resolveProbe } from '../software/probe.ts';
import { extractVersion, readPath } from '../software/version.ts';
import { insecureDispatcher } from '../util/insecure.ts';
import { USER_AGENT } from '../util/pkg.ts';
import { type CheckOutcome, down, errorMessage, up, withLatencyThreshold } from './types.ts';

type HttpSpec = Extract<MonitorSpec, { type: 'http' }>;

export function evaluateResponse(spec: HttpSpec, status: number, body: string): string | null {
  const expected = spec.expect.status;
  if (expected ? !expected.includes(status) : status < 200 || status >= 400) {
    return `HTTP ${status}${expected ? ` (expected ${expected.join(', ')})` : ''}`;
  }
  if (spec.expect.bodyContains && !body.includes(spec.expect.bodyContains)) {
    return `body does not contain "${spec.expect.bodyContains}"`;
  }
  if (spec.expect.bodyRegex && !new RegExp(spec.expect.bodyRegex).test(body)) {
    return `body does not match /${spec.expect.bodyRegex}/`;
  }
  if (spec.expect.json) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return 'body is not valid JSON';
    }
    for (const [path, want] of Object.entries(spec.expect.json)) {
      const got = readPath(parsed, path);
      if (String(got) !== String(want))
        return `${path} is ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`;
    }
  }
  return null;
}

export async function checkHttp(spec: HttpSpec, signal: AbortSignal): Promise<CheckOutcome> {
  const started = performance.now();
  // Version extraction from the check response itself (software.version with json/header/regex, no url).
  const probe = spec.software ? resolveProbe(spec, undefined) : null;
  const inline = probe?.mode === 'inline' ? probe.extractor : null;
  try {
    const init: RequestInit = {
      method: spec.method,
      headers: { 'user-agent': USER_AGENT, ...spec.headers },
      redirect: spec.followRedirects ? 'follow' : 'manual',
      signal,
    };
    if (spec.body !== undefined && spec.method !== 'GET' && spec.method !== 'HEAD') init.body = spec.body;
    const res = spec.ignoreTls
      ? ((await undiciFetch(spec.url, {
          ...(init as object),
          dispatcher: insecureDispatcher(),
        })) as unknown as Response)
      : await fetch(spec.url, init);
    const needsBody = Boolean(
      spec.expect.bodyContains ||
      spec.expect.bodyRegex ||
      spec.expect.json ||
      (inline && !inline.header && (inline.json !== undefined || inline.regex)),
    );
    const body = needsBody ? await res.text() : '';
    if (!needsBody) await res.body?.cancel();
    const latency = Math.round(performance.now() - started);
    const failure = evaluateResponse(spec, res.status, body);
    if (failure) return down(failure, latency);
    const outcome = withLatencyThreshold(up(latency, `HTTP ${res.status}`), spec.degradedAfter);
    if (inline) outcome.version = extractVersion(inline, { status: res.status, headers: res.headers, body });
    return outcome;
  } catch (error) {
    return down(errorMessage(error), Math.round(performance.now() - started));
  }
}
