import type { MonitorSpec } from '@heartline/shared';
import { Agent, fetch as undiciFetch } from 'undici';
import { type CheckOutcome, down, errorMessage, up, withLatencyThreshold } from './types.ts';

type HttpSpec = Extract<MonitorSpec, { type: 'http' }>;

function readPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined) return undefined;
    if (Array.isArray(acc) && /^\d+$/.test(key)) return acc[Number(key)];
    return typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined;
  }, value);
}

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

let insecureAgent: Agent | undefined;
const insecure = () => (insecureAgent ??= new Agent({ connect: { rejectUnauthorized: false } }));

export async function checkHttp(spec: HttpSpec, signal: AbortSignal): Promise<CheckOutcome> {
  const started = performance.now();
  try {
    const init: RequestInit = {
      method: spec.method,
      headers: {
        'user-agent': 'heartline/0.1 (+https://github.com/bircni/heartline)',
        ...spec.headers,
      },
      redirect: spec.followRedirects ? 'follow' : 'manual',
      signal,
    };
    if (spec.body !== undefined && spec.method !== 'GET' && spec.method !== 'HEAD') init.body = spec.body;
    const res = spec.ignoreTls
      ? ((await undiciFetch(spec.url, {
          ...(init as object),
          dispatcher: insecure(),
        })) as unknown as Response)
      : await fetch(spec.url, init);
    const needsBody = Boolean(spec.expect.bodyContains || spec.expect.bodyRegex || spec.expect.json);
    const body = needsBody ? await res.text() : '';
    if (!needsBody) await res.body?.cancel();
    const latency = Math.round(performance.now() - started);
    const failure = evaluateResponse(spec, res.status, body);
    if (failure) return down(failure, latency);
    return withLatencyThreshold(up(latency, `HTTP ${res.status}`), spec.degradedAfter);
  } catch (error) {
    return down(errorMessage(error), Math.round(performance.now() - started));
  }
}
