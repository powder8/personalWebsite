import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { getDb } from "@/db";
import { countActiveEscalations } from "@/server/escalations";
import { countOpenFeedback } from "@/server/feedback";
import { FeedbackWidget } from "@/components/FeedbackWidget";
import { Analytics } from "@/components/Analytics";
import { VercelAnalyticsMasked } from "@/components/VercelAnalyticsMasked";
import { auth, signOut } from "@/auth";
import { authConfigured } from "@/auth.config";
import "./globals.css";
import { ServiceWorkerRegistration } from '@/components/ServiceWorkerRegistration';

async function counts(): Promise<{ escalations: number; feedback: number }> {
  try {
    const db = await getDb();
    return { escalations: await countActiveEscalations(db), feedback: await countOpenFeedback(db) };
  } catch {
    return { escalations: 0, feedback: 0 };
  }
}

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Throughline. Coach Console",
  description: "AI endurance coach: readiness-aware training.",
  applicationName: "Throughline",
  // Installed-app behaviour on iOS (Safari ignores most of the manifest and
  // reads these instead): full-screen, dark status bar, app title.
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Throughline" },
  formatDetection: { telephone: false },
  // Next emits the modern `mobile-web-app-capable`; iOS before 17.4 only reads
  // the Apple-prefixed one. Emit both so older iPhones launch full-screen too.
  other: { "apple-mobile-web-app-capable": "yes" },
};

// Viewport lives apart from metadata in the App Router. `viewport-fit=cover`
// lets the dark shell extend under the notch/home bar; safe-area padding is
// applied where content sits at the edges.
export const viewport: Viewport = {
  themeColor: "#0a0a0b",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = authConfigured() ? await auth() : null;
  const role = session?.user?.role;
  // Console = admin or coach (or dev mode). Admin additionally sees site-wide
  // views (Analytics, Import, product Feedback); a coach sees only their roster.
  const isAdmin = !authConfigured() || role === 'admin';
  const isConsole = isAdmin || role === 'coach';
  // A real visitor who hasn't signed in — distinct from dev mode, where
  // authConfigured() is false but we still want the full console for
  // convenience. Only this case gets the public/marketing nav.
  const signedOut = authConfigured() && !session?.user;
  // Escalation/feedback badge counts are site-wide (admin-only concern).
  const { escalations: openEscalations, feedback: openFeedback } = isAdmin && !signedOut
    ? await counts()
    : { escalations: 0, feedback: 0 };
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-slate-900">
        <ServiceWorkerRegistration />
        <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-[#0a0a0b]/80 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
          <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-5">
            <Link href="/" className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-white">
              {/* The app icon's rising line, as a mark. */}
              <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-lg bg-lime-300">
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="#0a0a0b" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 17l5-5 4 3 9-9" />
                </svg>
              </span>
              Throughline
            </Link>
            {!signedOut && (
              <span className="hidden rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] font-medium text-slate-400 sm:inline">
                {isAdmin ? 'Admin' : isConsole ? 'Coach' : 'Athlete'}
              </span>
            )}
            {/* min-w-0 + overflow-x-auto: on a phone a long console nav scrolls
                inside the header instead of widening the whole page (which
                pushed the fixed bottom nav off-screen). */}
            <nav className="ml-auto flex min-w-0 items-center gap-4 overflow-x-auto whitespace-nowrap text-sm">
              {signedOut ? null : isConsole ? (
                <>
                  <Link href="/coach" className="text-slate-400 transition hover:text-white">
                    Roster
                  </Link>
                  <Link href="/coach/analytics" className="text-slate-400 transition hover:text-white">
                    Analytics
                  </Link>
                  {/* Site-wide tools are admin-only. */}
                  {isAdmin && (
                    <>
                      <Link href="/import" className="text-slate-400 transition hover:text-white">
                        Import
                      </Link>
                      <Link href="/escalations" className="flex items-center gap-1 text-slate-400 transition hover:text-white">
                        Escalations
                        {openEscalations > 0 && (
                          <span className="rounded-full bg-rose-600 px-1.5 text-[10px] font-semibold text-white">
                            {openEscalations}
                          </span>
                        )}
                      </Link>
                      <Link href="/feedback" className="flex items-center gap-1 text-slate-400 transition hover:text-white">
                        Feedback
                        {openFeedback > 0 && (
                          <span className="rounded-full bg-sky-600 px-1.5 text-[10px] font-semibold text-white">
                            {openFeedback}
                          </span>
                        )}
                      </Link>
                    </>
                  )}
                </>
              ) : (
                <>
                  <Link href="/me" className="text-slate-400 transition hover:text-white">
                    My training
                  </Link>
                  <Link href="/me/health" className="text-slate-400 transition hover:text-white">
                    Health
                  </Link>
                  <Link href="/me/settings" className="text-slate-400 transition hover:text-white">
                    Settings
                  </Link>
                </>
              )}
              {authConfigured() &&
                (session?.user ? (
                  <form
                    action={async () => {
                      'use server';
                      await signOut({ redirectTo: '/signin' });
                    }}
                    className="flex items-center gap-2"
                  >
                    <span className="hidden text-xs text-slate-400 sm:inline">{session.user.email}</span>
                    <button type="submit" className="text-slate-500 transition hover:text-white">
                      Sign out
                    </button>
                  </form>
                ) : (
                  <Link
                    href="/signin"
                    className="rounded-full bg-white px-4 py-1.5 font-semibold text-[#0a0a0b] transition hover:bg-slate-800"
                  >
                    Sign in
                  </Link>
                ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-6">{children}</main>
        {/* Signed-out visitors can't post feedback (the API needs a session), so
            the landing and sign-in pages don't offer it. */}
        {!signedOut && <FeedbackWidget sentAs={session?.user?.name || session?.user?.email || null} />}
        {/* GoatCounter (shared badoo.goatcounter.com). Server-rendered inline so
            it's in the SSR HTML and runs on first load: set the UUID-masking
            path filter, then inject count.js. SPA navigations are counted by
            <Analytics />. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "window.goatcounter={path:function(p){return p.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,':id')}};" +
              "(function(){var s=document.createElement('script');s.async=true;" +
              "s.dataset.goatcounter='https://badoo.goatcounter.com/count';" +
              "s.src='//gc.zgo.at/count.js';document.head.appendChild(s);})();",
          }}
        />
        <Analytics />
        <VercelAnalyticsMasked />
      </body>
    </html>
  );
}
