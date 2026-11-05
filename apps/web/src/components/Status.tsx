import type { ServiceStatus } from '@heartline/shared';
import { STATUS_LABEL, STATUS_TONE } from '../lib/format.ts';

export function StatusDot({
  status,
  size = 8,
  halo = false,
}: {
  status: ServiceStatus;
  size?: number;
  halo?: boolean;
}) {
  const tone = STATUS_TONE[status];
  return (
    <span
      aria-hidden="true"
      className="block shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        background: tone.dot,
        boxShadow: halo ? `0 0 0 ${Math.round(size / 2)}px ${tone.ring}` : undefined,
      }}
    />
  );
}

export function StatusLabel({ status, className = '' }: { status: ServiceStatus; className?: string }) {
  return (
    <span
      className={`flex items-center gap-2 text-[13px] ${className}`}
      style={{ color: STATUS_TONE[status].text }}
    >
      <StatusDot status={status} />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function StatusPill({ status }: { status: ServiceStatus }) {
  return (
    <span
      className="flex h-6 items-center gap-2 rounded-[6px] bg-fill px-2 text-[12px] font-medium"
      style={{ color: STATUS_TONE[status].text }}
    >
      <StatusDot status={status} />
      {STATUS_LABEL[status]}
    </span>
  );
}
