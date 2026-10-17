'use client';
/**
 * Tab navigation for the athlete portal. Every panel is server-rendered up
 * front and only the active one is shown, so switching tabs is instant (no
 * round trip). The active tab is mirrored into `?tab=` with replaceState, so a
 * refresh or a shared link lands on the same tab without piling up history.
 *
 * In-page links keep working across tabs: a click on `#goal-setup` (or a page
 * load with that hash) activates whichever panel holds that element, then
 * scrolls to it. Old `/me/<id>#training` bookmarks resolve the same way.
 *
 * Wide screens get a sticky segmented bar under the header; phones get the
 * fixed bottom bar instead.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import type { PortalTabId } from './portalTabIcons';

export type { PortalTabId };

export interface PortalTab {
  id: PortalTabId;
  label: string;
  /** SVG path (24×24, stroked) for the phone bar. */
  icon: string;
  /** A small dot on the tab: something here wants attention today. */
  attention?: boolean;
  panel: ReactNode;
}


export function PortalTabs({ tabs, initial }: { tabs: PortalTab[]; initial: PortalTabId }) {
  const [active, setActive] = useState<PortalTabId>(initial);

  const select = useCallback((id: PortalTabId, opts: { scrollTop?: boolean } = {}) => {
    setActive(id);
    const url = new URL(window.location.href);
    if (id === 'today') url.searchParams.delete('tab');
    else url.searchParams.set('tab', id);
    if (opts.scrollTop) url.hash = '';
    window.history.replaceState(window.history.state, '', url);
    if (opts.scrollTop) window.scrollTo({ top: 0 });
  }, []);

  // Activate the panel that contains `#hash`, then scroll to the target once
  // that panel is visible. Returns false when the id isn't on this page.
  const reveal = useCallback(
    (hash: string): boolean => {
      const id = decodeURIComponent(hash.replace(/^#/, ''));
      if (!id) return false;
      const el = document.getElementById(id);
      const panel = el?.closest<HTMLElement>('[data-tab-panel]');
      if (!el || !panel) return false;
      const tab = panel.dataset.tabPanel as PortalTabId;
      setActive(tab);
      const url = new URL(window.location.href);
      if (tab === 'today') url.searchParams.delete('tab');
      else url.searchParams.set('tab', tab);
      url.hash = id;
      window.history.replaceState(window.history.state, '', url);
      // Wait a frame so the newly shown panel has layout before scrolling.
      requestAnimationFrame(() => el.scrollIntoView({ block: 'start' }));
      // Components that open themselves on their hash (GoalSetup) listen for this.
      window.dispatchEvent(new HashChangeEvent('hashchange'));
      return true;
    },
    [],
  );

  // Deep link on load: `/me/<id>#goal-setup`.
  // Deferred a frame: the hash is external state, read once after hydration.
  useEffect(() => {
    if (!window.location.hash) return;
    const raf = requestAnimationFrame(() => reveal(window.location.hash));
    return () => cancelAnimationFrame(raf);
  }, [reveal]);

  // In-page anchors anywhere in the portal, including ones built by server
  // logic (`#goal-setup` CTAs) or pointing at another tab.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a) return;
      const href = a.getAttribute('href') ?? '';
      const url = new URL(href, window.location.href);
      const samePage = url.origin === window.location.origin && url.pathname === window.location.pathname;
      if (!samePage) return;
      const tabParam = url.searchParams.get('tab') as PortalTabId | null;
      if (url.hash && reveal(url.hash)) {
        e.preventDefault();
        return;
      }
      if (tabParam && tabs.some((t) => t.id === tabParam)) {
        e.preventDefault();
        select(tabParam, { scrollTop: true });
      }
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [reveal, select, tabs]);

  return (
    <>
      <div
        role="tablist"
        aria-label="Your training"
        className="sticky top-[calc(3.5rem+env(safe-area-inset-top,0px)+0.75rem)] z-30 hidden gap-1 rounded-full bg-[#141416]/90 p-1 ring-1 ring-inset ring-white/[0.06] backdrop-blur-xl sm:flex"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={active === t.id}
            aria-controls={`panel-${t.id}`}
            onClick={() => select(t.id, { scrollTop: true })}
            className={`relative flex-1 rounded-full px-3 py-2 text-sm font-medium transition ${
              active === t.id ? 'bg-white text-[#0a0a0b] shadow-sm' : 'text-slate-400 hover:text-white'
            }`}
          >
            {t.label}
            {t.attention && active !== t.id && (
              <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-lime-300" aria-label="needs attention" />
            )}
          </button>
        ))}
      </div>

      {tabs.map((t) => (
        <section
          key={t.id}
          id={`panel-${t.id}`}
          role="tabpanel"
          aria-labelledby={`tab-${t.id}`}
          data-tab-panel={t.id}
          hidden={active !== t.id}
          className="animate-fade-up space-y-4"
        >
          {t.panel}
        </section>
      ))}

      <nav
        aria-label="Sections"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.06] bg-[#0a0a0b]/85 backdrop-blur-xl sm:hidden"
      >
        <div className="mx-auto grid max-w-2xl pb-[env(safe-area-inset-bottom)]" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-current={active === t.id ? 'page' : undefined}
              onClick={() => select(t.id, { scrollTop: true })}
              className={`relative flex flex-col items-center gap-1 pb-1.5 pt-2.5 transition ${active === t.id ? 'text-white' : 'text-slate-500'}`}
            >
              {/* Active tab: icon sits in a soft pill (Material 3 / iOS 18 style). */}
              <span className={`flex h-7 w-12 items-center justify-center rounded-full transition ${active === t.id ? 'bg-white/[0.12]' : ''}`}>
                <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={active === t.id ? 2.1 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d={t.icon} />
                </svg>
              </span>
              <span className="text-[11px] font-medium">{t.label}</span>
              {t.attention && active !== t.id && <span className="absolute right-[30%] top-1.5 h-1.5 w-1.5 rounded-full bg-lime-300" />}
            </button>
          ))}
        </div>
      </nav>
    </>
  );
}
