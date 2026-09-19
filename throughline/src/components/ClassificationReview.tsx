/**
 * Where the classifier disagrees with the provider sport mapping — SHADOW MODE
 * review. Nothing here has changed any activity; this is the evidence for (or
 * against) trusting the model. Pure markup; data from server/activityJudgment.
 */
import Link from 'next/link';
import type { JudgedActivityRow } from '@/server/activityJudgment';

const SPORT: Record<string, string> = { run: '🏃 run', bike: '🚴 ride', swim: '🏊 swim', strength: '🏋️ strength', walk: '🚶 walk', other: '❓ other' };
const label = (s: string) => SPORT[s] ?? s;

export function ClassificationReview({
  athleteId,
  judged,
  rows,
  configured,
}: {
  athleteId: string;
  judged: number;
  rows: JudgedActivityRow[];
  configured: boolean;
}) {
  return (
    <div>
      <p className="mb-3 text-xs text-slate-500">
        A typed-judgment model (TypeSafe) re-classifies each synced activity from its numbers and the result is
        stored NEXT TO the provider&apos;s label. Nothing is changed automatically, this is the disagreement list, so
        the model can earn trust before it gets a vote.
        {judged > 0 && ` ${judged} activities judged in the last 90 days.`}
      </p>

      {!configured ? (
        <p className="text-sm text-amber-600">
          TypeSafe isn&apos;t configured (no <code>TYPESAFE_API_KEY</code>), so nothing has been judged yet.
        </p>
      ) : judged === 0 ? (
        <p className="text-sm text-slate-500">Nothing judged yet, the next Strava sync will classify recent activities.</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-emerald-600">The model agrees with the provider on all {judged} judged activities.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="py-1 font-medium">Date</th>
              <th className="py-1 font-medium">Activity</th>
              <th className="py-1 font-medium">Provider says</th>
              <th className="py-1 font-medium">Model says</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.activityId}>
                <td className="py-1.5 text-slate-600">{r.day}</td>
                <td className="py-1.5 text-slate-700">
                  <Link
                    href={`/me/${athleteId}/${r.providerSport === 'run' ? 'runs' : 'rides'}/${r.activityId}`}
                    className="text-sky-600 hover:underline"
                  >
                    {r.name ?? 'Untitled'}
                  </Link>
                </td>
                <td className="py-1.5 text-slate-600">{label(r.providerSport)}</td>
                <td className="py-1.5">
                  {r.disagreements.map((d, i) =>
                    d.kind === 'sport' ? (
                      <span key={i} className="mr-2 inline-flex items-center rounded-full bg-amber-400/15 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-400/30">
                        {label(d.to)} · {Math.round(d.confidence * 100)}%
                      </span>
                    ) : (
                      <span key={i} className="mr-2 inline-flex items-center rounded-full bg-violet-400/15 px-2 py-0.5 text-[11px] font-medium text-violet-700 ring-1 ring-inset ring-violet-400/30">
                        looks like a race · {Math.round(d.probability * 100)}%
                      </span>
                    ),
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
