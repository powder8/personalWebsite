/**
 * Portal tab ids and their icons. Kept out of the 'use client' PortalTabs
 * module so server components (BottomNav, the portal page) get real values,
 * not client references.
 */
export type PortalTabId = 'today' | 'progress' | 'training' | 'body' | 'coach';

/** SVG paths (24×24, stroked). */
export const TAB_ICONS: Record<PortalTabId, string> = {
  today: 'M13 2L4.5 12.5h5L11 22l8.5-10.5h-5L13 2z',
  progress: 'M22 12h-4l-3 9L9 3l-3 9H2',
  training: 'M7 2v3M17 2v3M3.5 8.5h17M5 4h14a1.5 1.5 0 011.5 1.5V19A1.5 1.5 0 0119 20.5H5A1.5 1.5 0 013.5 19V5.5A1.5 1.5 0 015 4z',
  body: 'M12 21s-7.5-4.9-10-9.4C.6 8.9 1.9 5.5 5 5.5c1.9 0 3.2 1.1 4 2.3.8-1.2 2.1-2.3 4-2.3 3.1 0 4.4 3.4 3 6.1-2.5 4.5-10 9.4-10 9.4z',
  coach: 'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z',
};
