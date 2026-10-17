/**
 * Mobile bottom navigation for pages OUTSIDE the tabbed portal: fixed bar on
 * small screens linking to the portal's tabs. (The portal renders its own,
 * stateful bar in PortalTabs.) Hidden on ≥sm.
 */

import { TAB_ICONS } from '@/components/portalTabIcons';

// Same five tabs as the portal (PortalTabs), as plain links for the pages
// around it (health, settings, setup flows).
const ITEMS = (athleteId: string) => [
  { href: `/me/${athleteId}`, label: 'Today', d: TAB_ICONS.today },
  { href: `/me/${athleteId}?tab=progress`, label: 'Progress', d: TAB_ICONS.progress },
  { href: `/me/${athleteId}?tab=training`, label: 'Training', d: TAB_ICONS.training },
  { href: `/me/${athleteId}?tab=body`, label: 'Body', d: TAB_ICONS.body },
  { href: `/me/${athleteId}?tab=coach`, label: 'Coach', d: TAB_ICONS.coach },
];

export function BottomNav({ athleteId }: { athleteId: string }) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-card/95 backdrop-blur sm:hidden"
      aria-label="Sections"
    >
      <div className="mx-auto grid max-w-2xl grid-cols-5 pb-[env(safe-area-inset-bottom)]">
        {ITEMS(athleteId).map((it) => (
          <a
            key={it.label}
            href={it.href}
            className="flex flex-col items-center gap-0.5 py-2 text-slate-400 hover:text-lime-300"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d={it.d} />
            </svg>
            <span className="text-[10px] font-semibold">{it.label}</span>
          </a>
        ))}
      </div>
    </nav>
  );
}
