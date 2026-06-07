import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { getDb } from "@/db";
import { countActiveEscalations } from "@/server/escalations";
import { countOpenFeedback } from "@/server/feedback";
import { FeedbackWidget } from "@/components/FeedbackWidget";
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
  const { escalations: openEscalations, feedback: openFeedback } = await counts();
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-slate-50 text-slate-900">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-5xl items-center gap-3 px-5 py-3">
            <Link href="/" className="font-semibold tracking-tight text-slate-900">
              Throughline
            </Link>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Coach Console
            </span>
            <nav className="ml-auto flex gap-4 text-sm">
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
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-6">{children}</main>
        <FeedbackWidget />
      </body>
    </html>
  );
}
