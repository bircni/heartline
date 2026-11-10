import type { ServiceStatus } from '@heartline/shared';
import { STATUS_LABEL, STATUS_TONE } from '../lib/format.ts';
import { Icon } from './Icon.tsx';

export function StatusDot({ status, size = 8 }: { status: ServiceStatus; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="block shrink-0 rounded-full"
      style={{ width: size, height: size, background: STATUS_TONE[status].dot }}
    />
  );
}

/** Filled circle with a check or an exclamation mark, the status icon of a service row. */
export function StatusIcon({ status, size = 16 }: { status: ServiceStatus; size?: number }) {
  const tone = STATUS_TONE[status];
  if (status === 'paused' || status === 'unknown') return <StatusDot status={status} size={size / 2} />;
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-full"
      style={{ width: size, height: size, background: tone.dot, color: 'var(--surface)' }}
    >
      <Icon
        name={status === 'operational' ? 'check' : status === 'maintenance' ? 'wrench' : 'x'}
        size={size * 0.68}
        strokeWidth={2.6}
      />
    </span>
  );
}

export function StatusPill({ status }: { status: ServiceStatus }) {
  const tone = STATUS_TONE[status];
  return (
    <span
      className="inline-flex h-[22px] items-center gap-1.5 rounded-sm px-2 text-[12px] font-medium"
      style={{ color: tone.text, background: tone.bg }}
    >
      <StatusDot status={status} size={6} />
      {STATUS_LABEL[status]}
    </span>
  );
}
