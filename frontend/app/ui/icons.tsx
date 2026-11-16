/* Inline stroke icons (24px grid). Same set as the design canvas. */
import type { SVGProps } from 'react';

const paths = {
  today: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  labs: <><path d="M9 3h6" /><path d="M10 3v6L5 19a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3L14 9V3" /></>,
  meds: <><rect x="6" y="3" width="12" height="18" rx="3" /><path d="M6 12h12" /></>,
  imaging: <><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="12" cy="12" r="4" /></>,
  more: <><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></>,
  check: <path d="M5 12l5 5L20 7" />,
  warn: <><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 3.9 2.5 17.5a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></>,
  chevron: <path d="M9 6l6 6-6 6" />,
  back: <path d="M15 6l-6 6 6 6" />,
  upload: <><path d="M12 16V4" /><path d="M7 9l5-5 5 5" /><path d="M4 20h16" /></>,
  download: <><path d="M12 4v12" /><path d="M7 11l5 5 5-5" /><path d="M4 20h16" /></>,
  timeline: <><path d="M7 3v18" /><circle cx="7" cy="7" r="2" /><circle cx="7" cy="17" r="2" /><path d="M12 7h8" /><path d="M12 17h8" /></>,
  doc: <><path d="M4 21V5a2 2 0 0 1 2-2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" /><path d="M8 13h8" /><path d="M8 17h5" /></>,
  close: <><path d="M6 6l12 12" /><path d="M18 6L6 18" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 8h.01" /></>,
  symptoms: <><path d="M4 21V5a2 2 0 0 1 2-2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" /><path d="M8 13h8" /><path d="M8 17h5" /></>,
  drip: <><path d="M12 3v5" /><path d="M8 8h8l-1.5 12h-5L8 8z" /></>,
  consult: <><path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" /><circle cx="10" cy="7" r="4" /></>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.5-2.4.9a7 7 0 0 0-1.7-1L14.5 3h-5l-.3 2.4a7 7 0 0 0-1.7 1L5.1 5.5l-2 3.5 2 1.5a7 7 0 0 0 0 2l-2 1.5 2 3.5 2.4-.9a7 7 0 0 0 1.7 1l.3 2.4h5l.3-2.4a7 7 0 0 0 1.7-1l2.4.9 2-3.5-2-1.5c.1-.3.1-.7.1-1z" /></>,
  logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></>,
  plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  chat: <><circle cx="12" cy="12" r="9" /><circle cx="9" cy="10" r=".8" fill="currentColor" /><circle cx="15" cy="10" r=".8" fill="currentColor" /><path d="M8.5 14.5c1 1.2 2.1 1.8 3.5 1.8s2.5-.6 3.5-1.8" /></>,
  search: <><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.5-4.5" /></>,
  refresh: <><path d="M20 12a8 8 0 1 1-2.3-5.7" /><path d="M20 4v5h-5" /></>,
  ai: <><path d="M10 3.5l1.9 5.1 5.1 1.9-5.1 1.9L10 17.5l-1.9-5.1L3 10.5l5.1-1.9z" /><path d="M18 14l.9 2.1L21 17l-2.1.9L18 20l-.9-2.1L15 17l2.1-.9z" /></>,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a14 14 0 0 1 0 18" /><path d="M12 3a14 14 0 0 0 0 18" /></>,
  heart: <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />,
  spark: <><path d="M12 3v4" /><path d="M12 17v4" /><path d="M3 12h4" /><path d="M17 12h4" /><path d="M6 6l2.5 2.5" /><path d="M15.5 15.5 18 18" /><path d="M18 6l-2.5 2.5" /><path d="M8.5 15.5 6 18" /></>,
  server: <><rect x="4" y="4" width="16" height="7" rx="2" /><rect x="4" y="13" width="16" height="7" rx="2" /><path d="M8 7.5h.01" /><path d="M8 16.5h.01" /></>,
  send: <><path d="M21 3 3 10.5l7 2.5 2.5 7L21 3z" /><path d="M10 13l4.5-4.5" /></>,
  ruler: <><path d="M4 16 16 4l4 4L8 20z" /><path d="M8 12l2 2" /><path d="M11 9l2 2" /><path d="M14 6l2 2" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" /></>,
};

export type IconName = keyof typeof paths;

export default function Icon({ name, size = 24, strokeWidth = 2, ...rest }: { name: IconName; size?: number; strokeWidth?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {paths[name]}
    </svg>
  );
}
