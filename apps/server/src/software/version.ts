/** Version strings as seen in the wild: `v1.24.3`, `11.0.1+gitea-1.22.0`, `RELEASE.2025-01-20T14-49-07Z`, `16.2`. */

export interface ParsedVersion {
  parts: number[];
  /** Pre-release segments (`rc1` → ['rc', 1]); null for a final release. */
  pre: (string | number)[] | null;
  raw: string;
}

/** Reads `a.b.0.c` style paths; array indexes are numeric segments. An empty path is the root. */
export function readPath(value: unknown, path: string): unknown {
  if (path === '' || path === '.') return value;
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined) return undefined;
    if (Array.isArray(acc) && /^\d+$/.test(key)) return acc[Number(key)];
    return typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined;
  }, value);
}

/** Normalises a raw version: trims, drops a leading `v`, build metadata and anything after whitespace. */
export function cleanVersion(raw: string): string {
  let v = raw.trim();
  v = v.split(/\s+/)[0] ?? '';
  v = v.replace(/^[vV](?=\d)/, '');
  const plus = v.indexOf('+');
  if (plus > 0) v = v.slice(0, plus);
  v = v.replace(/[^0-9A-Za-z.-]/g, '');
  return v.replace(/\.+$/, '');
}

export function parseVersion(input: string): ParsedVersion {
  const raw = cleanVersion(input);
  const m = /^(\d+(?:\.\d+)*)(.*)$/.exec(raw);
  if (!m) {
    // No leading numeric run: fall back to every numeric run (MinIO RELEASE.2025-01-20T14-49-07Z).
    const nums = raw.match(/\d+/g) ?? [];
    return { parts: nums.map(Number), pre: null, raw };
  }
  const parts = (m[1] as string).split('.').map(Number);
  let rest = m[2] as string;
  let pre: (string | number)[] | null = null;
  if (rest) {
    rest = rest.replace(/^[-.]/, '');
    if (rest) {
      pre = rest
        .split(/[.-]/)
        .flatMap((seg) => seg.match(/\d+|[A-Za-z]+/g) ?? [])
        .map((s) => (/^\d+$/.test(s) ? Number(s) : s.toLowerCase()));
    }
  }
  return { parts, pre, raw };
}

function comparePre(a: (string | number)[] | null, b: (string | number)[] | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1; // release > pre-release
  if (b === null) return -1;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (typeof x === 'number' && typeof y === 'number') {
      if (x !== y) return x < y ? -1 : 1;
    } else if (typeof x === 'number') return -1;
    else if (typeof y === 'number') return 1;
    else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** Tolerant semver-ish comparison: `1.24` equals `1.24.0`, `1.24.0-rc1` is older than `1.24.0`. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const n = Math.max(pa.parts.length, pb.parts.length);
  for (let i = 0; i < n; i++) {
    const x = pa.parts[i] ?? 0;
    const y = pb.parts[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  const pre = comparePre(pa.pre, pb.pre);
  return pre < 0 ? -1 : pre > 0 ? 1 : 0;
}

/** True when `cycle` (e.g. `1.24` or `16`) is a numeric prefix of `version`. */
export function sameCycle(version: string, cycle: string): boolean {
  const v = parseVersion(version).parts;
  const c = parseVersion(cycle).parts;
  if (c.length === 0 || c.length > v.length) return false;
  return c.every((p, i) => v[i] === p);
}

/** Number of patch releases between two versions that differ only in their last numeric part. */
export function patchesBehind(version: string, latest: string): number | null {
  const v = parseVersion(version).parts;
  const l = parseVersion(latest).parts;
  if (v.length === 0 || v.length !== l.length) return null;
  for (let i = 0; i < v.length - 1; i++) if (v[i] !== l[i]) return null;
  const diff = (l.at(-1) as number) - (v.at(-1) as number);
  return diff > 0 ? diff : 0;
}

export interface VersionExtractor {
  json?: string | undefined;
  header?: string | undefined;
  regex?: string | undefined;
}

export interface ProbeResponse {
  status: number;
  headers: Headers;
  body: string;
}

const VERSION_SHAPE = /^\d+[0-9A-Za-z.-]*$/;

/**
 * Pulls a version out of a response: a header, a JSON path or the body, optionally refined by a regex
 * whose capture groups are joined with dots (`{"major":1,"minor":2}` → `1.2`).
 */
export function extractVersion(ex: VersionExtractor, res: ProbeResponse): string | null {
  let source: string | null = null;
  if (ex.header) {
    source = res.headers.get(ex.header);
  } else if (ex.json !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(res.body);
    } catch {
      return null;
    }
    const value = readPath(parsed, ex.json);
    if (value === null || value === undefined) return null;
    if (typeof value === 'object') {
      const o = value as Record<string, unknown>;
      // Immich-style {major, minor, patch}
      if ('major' in o && 'minor' in o) {
        source = [o.major, o.minor, o.patch].filter((p) => p !== undefined && p !== null).join('.');
      } else source = JSON.stringify(value);
    } else source = String(value);
  } else {
    source = res.body;
  }
  if (source === null) return null;
  if (ex.regex) {
    const m = new RegExp(ex.regex).exec(source);
    if (!m) return null;
    const groups = m.slice(1).filter((g): g is string => g !== undefined);
    source = groups.length ? groups.join('.') : m[0];
  }
  const cleaned = cleanVersion(source);
  return cleaned && VERSION_SHAPE.test(cleaned) ? cleaned.slice(0, 100) : null;
}
