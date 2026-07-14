import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getRoster, todayISO } from '@/server/console';
import { consoleViewer } from '@/server/access';
import { BandBadge, Flag } from '@/components/ui';
import { RebuildPlansButton } from '@/components/RebuildPlansButton';

export const dynamic = 'force-dynamic';

export default async function RosterPage() {
  const viewer = await consoleViewer();
  if (!viewer) notFound();
  const roster = await getRoster(viewer);
  const isAdmin = viewer.kind === 'admin';

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg font-semibold text-slate-900">Roster</h1>
        <span className="flex items-center gap-3 text-sm text-slate-500">
          {isAdmin && <RebuildPlansButton />}
          {todayISO()} · sorted by needs-attention
        </span>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-card">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">Athlete</th>
              <th className="px-4 py-2 font-medium">Readiness</th>
              <th className="px-4 py-2 font-medium">Today</th>
              <th className="px-4 py-2 font-medium">Flags</th>
              <th className="px-4 py-2 font-medium">Goal</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {roster.map((a) => (
              <tr key={a.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 align-top">
                  <Link href={`/athletes/${a.id}`} className="font-medium text-sky-300 hover:underline">
                    {a.name}
                  </Link>
                  {a.coachingMode === 'autonomous' && (
                    <span
                      className="ml-2 rounded bg-indigo-400/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-indigo-300 ring-1 ring-inset ring-indigo-400/30"
                      title="Coached autonomously by the app"
                    >
                      auto
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 align-top">
                  <BandBadge band={a.readiness.band} score={a.readiness.score} />
                  {a.readiness.sentence && (
                    <p className="mt-1 max-w-md text-xs text-slate-500">{a.readiness.sentence}</p>
                  )}
                </td>
                <td className="px-4 py-3 align-top text-slate-700">
                  {a.todaySession ? (
                    <span className="font-medium capitalize">{a.todaySession.sessionType}</span>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="px-4 py-3 align-top">
                  <div className="flex flex-wrap gap-1">
                    {a.flags.length ? (
                      a.flags.map((f) => <Flag key={f}>{f}</Flag>)
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 align-top text-slate-600">
                  {a.race ? (
                    <span>
                      {a.race}
                      {a.raceDate && <span className="text-slate-400"> · {a.raceDate}</span>}
                    </span>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {roster.length === 0 && <p className="mt-6 text-sm text-slate-500">No athletes yet.</p>}
    </div>
  );
}
