const UNITS: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/** Parses durations like `800ms`, `30s`, `15m`, `26h`, `1d` or `1h30m` into milliseconds. */
export function parseDuration(input: string | number): number {
  if (typeof input === 'number') return input;
  const text = input.trim();
  const re = /(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)/gy;
  let total = 0;
  let consumed = 0;
  for (const match of text.matchAll(re)) {
    total += Number(match[1]) * (UNITS[match[2] as string] ?? 0);
    consumed += match[0].length;
  }
  if (consumed === 0 || consumed !== text.length) throw new Error(`Invalid duration: "${input}"`);
  return Math.round(total);
}

export function formatDuration(ms: number): string {
  if (ms % 86_400_000 === 0) return `${ms / 86_400_000}d`;
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
  if (ms % 60_000 === 0) return `${ms / 60_000}m`;
  if (ms % 1000 === 0) return `${ms / 1000}s`;
  return `${ms}ms`;
}
