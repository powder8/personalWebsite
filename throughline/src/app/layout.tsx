import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { getDb } from "@/db";
import { countActiveEscalations } from "@/server/escalations";
import { countOpenFeedback } from "@/server/feedback";
import { FeedbackWidget } from "@/components/FeedbackWidget";
import { Analytics } from "@/components/Analytics";
import { auth, signOut } from "@/auth";
import { authConfigured } from "@/auth.config";
import "./globals.css";

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
  title: "Throughline — Coach Console",
  description: "AI endurance coach: readiness-aware training.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = authConfigured() ? await auth() : null;
  const role = session?.user?.role;
  // Open/dev mode (auth unconfigured) keeps the full coach console visible.
  const isCoach = !authConfigured() || role === 'coach';
  const { escalations: openEscalations, feedback: openFeedback } = isCoach
    ? await counts()
    : { escalations: 0, feedback: 0 };
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-slate-50 text-slate-900">
        <header className="border-b border-slate-200 bg-card">
          <div className="mx-auto flex max-w-5xl items-center gap-3 px-5 py-3">
            <Link href="/" className="font-semibold tracking-tight text-slate-900">
              Throughline
            </Link>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
              {isCoach ? 'Coach Console' : 'Athlete'}
            </span>
            <nav className="ml-auto flex items-center gap-4 text-sm">
              {isCoach ? (
                <>
                  <Link href="/" className="text-slate-600 hover:text-slate-900">
                    Roster
                  </Link>
                  <Link href="/import" className="text-slate-600 hover:text-slate-900">
                    Import
                  </Link>
                  <Link href="/escalations" className="flex items-center gap-1 text-slate-600 hover:text-slate-900">
                    Escalations
                    {openEscalations > 0 && (
                      <span className="rounded-full bg-rose-600 px-1.5 text-[10px] font-semibold text-white">
                        {openEscalations}
                      </span>
                    )}
                  </Link>
                  <Link href="/feedback" className="flex items-center gap-1 text-slate-600 hover:text-slate-900">
                    Feedback
                    {openFeedback > 0 && (
                      <span className="rounded-full bg-sky-600 px-1.5 text-[10px] font-semibold text-white">
                        {openFeedback}
                      </span>
                    )}
                  </Link>
                </>
              ) : (
                <Link href="/me" className="text-slate-600 hover:text-slate-900">
                  My training
                </Link>
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
                    <button type="submit" className="text-slate-500 hover:text-slate-900">
                      Sign out
                    </button>
                  </form>
                ) : (
                  <Link href="/signin" className="font-medium text-sky-300 hover:text-sky-200">
                    Sign in
                  </Link>
                ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-6">{children}</main>
        <FeedbackWidget />
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
      </body>
    </html>
  );
}
