import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { activities, shoes } from '@/db/schema';
import { Card } from '@/components/ui';
import { RouteMap } from '@/components/RouteMap';
import { secPerKmToMinPerMile } from '@/engine/plan';

export const dynamic = 'force-dynamic';

interface Split {
  distanceMeters: number;
  durationSeconds: number;
  paceSecPerKm: number | null;
  avgHr: number | null;
  elevDiffMeters: number | null;
}

const MI = 1609.344;
const fmtDur = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.round(s % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};
const paceMi = (secPerKm: number | null) => (secPerKm == null ? '—' : `${secPerKmToMinPerMile(secPerKm)}/mi`);

/** Run detail: stats, route map, and mile splits. Athlete-owned (gated by path). */
export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string; activityId: string }>;
}) {
  const { id, activityId } = await params;
  // Malformed UUIDs would make Postgres throw — treat them as not-found.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(id) || !UUID_RE.test(activityId)) notFound();
  const db = await getDb();
  const [run] = await db
    .select()
    .from(activities)
    .where(and(eq(activities.id, activityId), eq(activities.athleteId, id)))
    .limit(1);
  if (!run) notFound();

  let shoeName: string | null = null;
  if (run.shoeId) {
    const [s] = await db.select({ name: shoes.name }).from(shoes).where(eq(shoes.id, run.shoeId)).limit(1);
    shoeName = s?.name ?? null;
  }

  const day = run.startTime.toISOString().slice(0, 10);
  const miles = run.distanceMeters != null ? run.distanceMeters / MI : null;
  const splits = (run.splits as Split[] | null) ?? [];
  // Pace bars: faster split → longer bar (scaled between slowest and fastest).
  const paces = splits.map((s) => s.paceSecPerKm).filter((p): p is number => p != null);
  const fastest = paces.length ? Math.min(...paces) : null;
  const slowest = paces.length ? Math.max(...paces) : null;
  const barPct = (p: number | null) => {
    if (p == null || fastest == null || slowest == null) return 30;
    if (slowest === fastest) return 85;
    return 35 + 55 * ((slowest - p) / (slowest - fastest)); // 35–90%
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link href={`/me/${id}`} className="text-sm text-sky-700 hover:underline">
        ← Back to your training
      </Link>

      {/* Header stats */}
      <div className="rounded-3xl bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950 p-6 text-white shadow-lg">
        <p className="text-sm text-slate-400">{day}{shoeName ? ` · ${shoeName}` : ''}</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{run.name ?? 'Run'}</h1>
        <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4">
          <Stat label="Distance" value={miles != null ? `${miles.toFixed(2)} mi` : '—'} />
          <Stat label="Time" value={run.durationSeconds != null ? fmtDur(run.durationSeconds) : '—'} />
          <Stat label="Avg pace" value={paceMi(run.avgPaceSecPerKm)} />
          <Stat
            label="Elevation"
            value={run.elevationGainMeters != null ? `${Math.round(run.elevationGainMeters * 3.28084)} ft` : '—'}
          />
          {run.avgHr != null && <Stat label="Avg HR" value={`${run.avgHr} bpm`} />}
          {run.maxHr != null && <Stat label="Max HR" value={`${run.maxHr} bpm`} />}
          {run.cadence != null && <Stat label="Cadence" value={`${run.cadence} spm`} />}
        </div>
      </div>

      {/* Route */}
      {run.mapPolyline ? (
        <Card title="Route">
          <RouteMap polyline={run.mapPolyline} />
          <p className="mt-2 text-[11px] text-slate-400">
            <span className="mr-3"><span className="mr-1 inline-block h-2 w-2 rounded-full bg-lime-400" />start</span>
            <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-slate-900" />finish</span>
          </p>
        </Card>
      ) : (
        <Card title="Route">
          <p className="text-sm text-slate-500">No route captured for this run yet — newly synced runs include it.</p>
        </Card>
      )}

      {/* Splits */}
      <Card title="Splits">
        {splits.length ? (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="w-10 py-1 font-medium">Mi</th>
                <th className="py-1 font-medium">Pace</th>
                <th className="w-20 py-1 text-right font-medium">Elev</th>
                <th className="w-16 py-1 text-right font-medium">HR</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {splits.map((s, i) => (
                <tr key={i}>
                  <td className="py-1.5 font-medium tabular-nums text-slate-500">
                    {s.distanceMeters < MI * 0.9 ? (s.distanceMeters / MI).toFixed(1) : i + 1}
                  </td>
                  <td className="py-1.5">
                    <div className="flex items-center gap-2">
                      <div
                        className={`h-4 rounded ${s.paceSecPerKm != null && s.paceSecPerKm === fastest ? 'bg-lime-400' : 'bg-indigo-400'}`}
                        style={{ width: `${barPct(s.paceSecPerKm)}%` }}
                      />
                      <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-700">
                        {paceMi(s.paceSecPerKm)}
                      </span>
                    </div>
                  </td>
                  <td className="py-1.5 text-right text-xs tabular-nums text-slate-500">
                    {s.elevDiffMeters != null
                      ? `${s.elevDiffMeters >= 0 ? '+' : ''}${Math.round(s.elevDiffMeters * 3.28084)} ft`
                      : '—'}
                  </td>
                  <td className="py-1.5 text-right text-xs tabular-nums text-slate-500">{s.avgHr ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-slate-500">
            No splits for this run yet. Splits arrive with newly synced runs (and the fastest one glows lime).
          </p>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-lg font-bold tabular-nums tracking-tight">{value}</div>
    </div>
  );
}
