import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { activities, athletes } from '@/db/schema';
import { fmtDistance, fmtSpeed, asUnits, type Units } from '@/lib/units';
import { Card } from '@/components/ui';
import { RouteMap } from '@/components/RouteMap';

export const dynamic = 'force-dynamic';

const FT_PER_M = 3.280839895;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NOUN: Record<string, string> = { bike: 'Ride', swim: 'Swim', strength: 'Strength session' };
const EMOJI: Record<string, string> = { bike: '🚴', swim: '🏊', strength: '🏋️' };

function fmtDur(s: number): string {
  const sec = Math.round(s);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const ss = sec % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`;
}
/** Swim pace m:ss / 100 m. */
function per100(distanceMeters: number, durationSeconds: number): string {
  const p = durationSeconds / (distanceMeters / 100);
  const m = Math.floor(p / 60);
  const s = Math.round(p - m * 60);
  return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, '0')}`;
}

interface Split {
  distanceMeters: number;
  durationSeconds: number;
  paceSecPerKm: number | null;
  avgHr: number | null;
  elevDiffMeters: number | null;
}

/**
 * Non-run session detail (bike / swim / strength). The run detail lives at
 * /runs/[id] with its pace-specific analysis; this is the sport-native twin —
 * cycling in speed (mph/kph), swimming in pace/100m — with no fabricated power
 * data (the schema carries none for rides). A run id redirects to the run page.
 */
export default async function SessionDetailPage({ params }: { params: Promise<{ id: string; activityId: string }> }) {
  const { id, activityId } = await params;
  if (!UUID_RE.test(id) || !UUID_RE.test(activityId)) notFound();

  const db = await getDb();
  const [act] = await db
    .select()
    .from(activities)
    .where(and(eq(activities.id, activityId), eq(activities.athleteId, id)))
    .limit(1);
  if (!act) notFound();
  if (act.sport === 'run') redirect(`/me/${id}/runs/${activityId}`);

  const [ath] = await db.select({ units: athletes.units }).from(athletes).where(eq(athletes.id, id)).limit(1);
  const units: Units = asUnits(ath?.units);
  const day = act.startTime.toISOString().slice(0, 10);
  const sport = act.sport;
  const dist = act.distanceMeters ?? 0;
  const dur = act.durationSeconds ?? 0;

  const tiles: { label: string; value: string }[] = [];
  if (sport === 'bike') {
    if (dist > 0) tiles.push({ label: 'Distance', value: fmtDistance(dist, units) });
    if (dist > 0 && dur > 0) tiles.push({ label: 'Avg speed', value: fmtSpeed(dur / (dist / 1000), units) });
    if (dur > 0) tiles.push({ label: 'Moving time', value: fmtDur(dur) });
    if (act.elevationGainMeters != null && act.elevationGainMeters > 0)
      tiles.push({ label: 'Climbing', value: units === 'km' ? `${Math.round(act.elevationGainMeters).toLocaleString()} m` : `${Math.round(act.elevationGainMeters * FT_PER_M).toLocaleString()} ft` });
  } else if (sport === 'swim') {
    if (dist > 0) tiles.push({ label: 'Distance', value: `${Math.round(dist).toLocaleString()} m` });
    if (dist > 0 && dur > 0) tiles.push({ label: 'Pace', value: `${per100(dist, dur)}/100m` });
    if (dur > 0) tiles.push({ label: 'Time', value: fmtDur(dur) });
  } else {
    if (dur > 0) tiles.push({ label: 'Duration', value: fmtDur(dur) });
  }
  if (act.avgHr) tiles.push({ label: 'Avg HR', value: `${act.avgHr} bpm` });
  if (act.cadence) tiles.push({ label: sport === 'bike' ? 'Cadence' : 'Cadence', value: `${act.cadence} ${sport === 'bike' ? 'rpm' : 'spm'}` });

  const splits = (act.splits as Split[] | null) ?? [];
  const showSplits = (sport === 'bike' || sport === 'swim') && splits.length > 1;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link href={`/me/${id}`} className="text-sm text-sky-300 hover:underline">
        ← Back to your training
      </Link>

      <div className="rounded-3xl bg-gradient-to-br from-[#141b2e] via-[#10141f] to-indigo-950 p-6 text-white shadow-lg">
        <p className="text-sm text-slate-400">{day}</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">
          <span aria-hidden className="mr-1.5">{EMOJI[sport] ?? '🏅'}</span>
          {act.name ?? NOUN[sport] ?? 'Session'}
        </h1>
        {tiles.length > 0 && (
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {tiles.map((t) => (
              <div key={t.label} className="rounded-2xl bg-white/[0.04] px-3 py-2.5 ring-1 ring-inset ring-white/10">
                <div className="text-[10px] font-medium uppercase tracking-wide text-white/40">{t.label}</div>
                <div className="mt-0.5 text-lg font-bold tabular-nums text-white/90">{t.value}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {act.mapPolyline && (
        <Card title="Route">
          <RouteMap polyline={act.mapPolyline} />
        </Card>
      )}

      {showSplits && (
        <Card title="Splits">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="py-1 font-medium">#</th>
                <th className="py-1 text-right font-medium">Distance</th>
                <th className="py-1 text-right font-medium">{sport === 'bike' ? 'Speed' : 'Pace'}</th>
                <th className="py-1 text-right font-medium">HR</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-500/10">
              {splits.map((s, i) => {
                const secPerKm = s.paceSecPerKm ?? (s.distanceMeters > 0 ? s.durationSeconds / (s.distanceMeters / 1000) : null);
                const rate =
                  secPerKm == null || s.distanceMeters <= 0
                    ? '-'
                    : sport === 'bike'
                      ? fmtSpeed(secPerKm, units)
                      : `${per100(s.distanceMeters, s.durationSeconds)}/100m`;
                return (
                  <tr key={i}>
                    <td className="py-1.5 text-slate-500">{i + 1}</td>
                    <td className="py-1.5 text-right tabular-nums text-slate-700">
                      {sport === 'swim' ? `${Math.round(s.distanceMeters)} m` : fmtDistance(s.distanceMeters, units)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-slate-700">{rate}</td>
                    <td className="py-1.5 text-right tabular-nums text-slate-500">{s.avgHr ? `${s.avgHr}` : '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
