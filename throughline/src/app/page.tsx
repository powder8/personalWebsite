import Link from 'next/link';
import { getRoster, TODAY } from '@/server/console';
import { BandBadge, Flag } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function RosterPage() {
  const roster = await getRoster();

  return (
    <div>
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="text-lg font-semibold text-slate-900">Roster</h1>
        <span className="text-sm text-slate-500">{TODAY} · sorted by needs-attention</span>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
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
                  <Link href={`/athletes/${a.id}`} className="font-medium text-sky-700 hover:underline">
                    {a.name}
                  </Link>
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
