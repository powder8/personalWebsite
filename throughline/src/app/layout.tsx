import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
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
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-6">{children}</main>
      </body>
    </html>
  );
}
