import type { CheckStatus, MonitorSpec } from '@heartline/shared';

export interface CheckOutcome {
  status: CheckStatus;
  latencyMs: number | null;
  message: string | null;
  /** Running version read from the response or plugin output; only set when extraction was attempted. */
  version?: string | null;
}

export type Checker<S extends MonitorSpec = MonitorSpec> = (
  spec: S,
  signal: AbortSignal,
) => Promise<CheckOutcome>;

export const up = (latencyMs: number | null, message: string | null = null): CheckOutcome => ({
  status: 'up',
  latencyMs,
  message,
});
export const down = (message: string, latencyMs: number | null = null): CheckOutcome => ({
  status: 'down',
  latencyMs,
  message,
});

/** Applies a `degradedAfter` latency threshold to an otherwise successful check. */
export function withLatencyThreshold(outcome: CheckOutcome, degradedAfter: number | undefined): CheckOutcome {
  if (
    outcome.status === 'up' &&
    degradedAfter !== undefined &&
    outcome.latencyMs !== null &&
    outcome.latencyMs > degradedAfter
  ) {
    return {
      ...outcome,
      status: 'degraded',
      message: outcome.message ?? `slow: ${outcome.latencyMs} ms > ${degradedAfter} ms`,
    };
  }
  return outcome;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') return 'timed out';
    let cause = (error as Error & { cause?: unknown }).cause as
      | { code?: string; message?: string; errors?: { code?: string; message?: string }[] }
      | undefined;
    // Happy-eyeballs connects fail with an AggregateError holding one error per address.
    if (cause && !cause.code && Array.isArray(cause.errors) && cause.errors[0]) cause = cause.errors[0];
    if (cause?.code)
      return cause.message && !cause.message.includes(cause.code)
        ? `${cause.code}: ${cause.message}`
        : (cause.message ?? cause.code);
    if (cause?.message) return cause.message;
    return error.message;
  }
  return String(error);
}
