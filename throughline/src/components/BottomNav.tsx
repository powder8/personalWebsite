/**
 * Mobile bottom navigation (app-like, Runna-style): fixed bar on small screens
 * jumping to the portal's main sections. Hidden on ≥sm where the page scrolls
 * comfortably.
 */

const ITEMS = (athleteId: string) => [
  // Today — lightning bolt
  { href: `/me/${athleteId}`, label: 'Today', d: 'M13 2L4.5 12.5h5L11 22l8.5-10.5h-5L13 2z' },
  // Training — calendar
  { href: `/me/${athleteId}#training`, label: 'Training', d: 'M7 2v3M17 2v3M3.5 8.5h17M5 4h14a1.5 1.5 0 011.5 1.5V19A1.5 1.5 0 0119 20.5H5A1.5 1.5 0 013.5 19V5.5A1.5 1.5 0 015 4z' },
  // Chat — speech bubble
  { href: `/me/${athleteId}#chat`, label: 'Chat', d: 'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z' },
  // Settings — cog
  { href: `/me/${athleteId}/settings`, label: 'Settings', d: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1' },
];

export function BottomNav({ athleteId }: { athleteId: string }) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-card/95 backdrop-blur sm:hidden"
      aria-label="Sections"
    >
      <div className="mx-auto grid max-w-2xl grid-cols-4">
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
