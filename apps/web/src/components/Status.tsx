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
      className="inline-flex h-6 items-center gap-2 rounded-full px-2.5 text-[12px] font-medium tracking-normal shadow-[inset_0_0_0_1px_var(--hair)] [font-stretch:100%]"
      style={{ color: STATUS_TONE[status].text }}
    >
      <StatusDot status={status} />
      {STATUS_LABEL[status]}
    </span>
  );
}

/**
 * The rule under the page statement: a heart trace in the colour of the current status, running out
 * into a plain hairline. It draws itself once when the page opens.
 */
export function Pulse({ status }: { status: ServiceStatus }) {
  const tone = STATUS_TONE[status].dot;
  return (
    <div aria-hidden="true" className="flex h-8 items-center" style={{ color: tone }}>
      <span className="block h-[1.5px] w-5 shrink-0 bg-current" />
      <svg width="72" height="32" viewBox="0 0 72 32" fill="none" className="shrink-0 overflow-visible">
        <path
          className="trace-beat"
          pathLength={1}
          d="M0 16h9l3.5-4 3.5 4h6l3 4 6-19 6 26 4-11h5.5l4.5-6 4.5 6H72"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span
        className="trace-run block h-[1.5px] min-w-0 flex-1"
        style={{ background: `linear-gradient(to right, ${tone}, var(--hair) min(40%, 320px))` }}
      />
    </div>
  );
}
