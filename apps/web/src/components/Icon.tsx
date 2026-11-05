import type { SVGProps } from 'react';

const PATHS = {
  pulse: 'M3 12h4l2-5 4 10 2-5h6',
  moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  search: 'M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM20 20l-4-4',
  list: 'M4 6h16M4 12h16M4 18h16',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z',
  alert: 'M12 3l9 16H3zM12 10v4M12 17h.01',
  wrench: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-.5-.5-2.5z',
  bell: 'M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 21h4',
  key: 'M14 10a4 4 0 1 0-4 4M10 14l-6 6M7 17l2 2',
  users: 'M16 19a4 4 0 0 0-8 0M12 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  arrowLeft: 'M15 18l-6-6 6-6',
  chevron: 'M9 18l6-6-6-6',
  plus: 'M12 5v14M5 12h14',
  play: 'M7 5l12 7-12 7z',
  pause: 'M8 5v14M16 5v14',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  check: 'M5 12l5 5 9-10',
  x: 'M6 6l12 12M18 6L6 18',
  gitea: 'M8 12a4 4 0 1 0 0 .01M12 12h9M18 12v3M21 12v2',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  shield: 'M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6zM9 12l2 2 4-4',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  edit: 'M4 20h4l10-10-4-4L4 16zM13 7l4 4',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 16,
  strokeWidth = 1.8,
  ...rest
}: { name: IconName; size?: number; strokeWidth?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

export function Logo({ size = 26 }: { size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center bg-text text-bg"
      style={{ width: size, height: size, borderRadius: size * 0.27 }}
      aria-hidden="true"
    >
      <Icon name="pulse" size={size * 0.58} strokeWidth={2.2} />
    </span>
  );
}
