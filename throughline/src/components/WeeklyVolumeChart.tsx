/**
 * 12-week mileage + elevation chart (pure SVG server component). Mileage as
 * bars on the left axis; weekly elevation gain as an overlaid line on the right
 * axis (only when elevation data exists). Below, a table of labeled efforts.
 */
import Link from 'next/link';
import { fmtPace, distanceUnit, distanceValue, type Units } from '@/lib/units';
import type { TrainingSummary, EffortKind } from '@/server/weeklyVolume';
import type { WeekTime } from '@/server/weeklyVolumeLogic';

const W = 640;
const H = 160;
const PAD_T = 8; // headroom above the tallest bar
const PAD_B = 18; // room for week labels
const PAD_L = 30; // left axis (miles) labels
const PAD_R_BASE = 10;
const PAD_R_ELEV = 34; // right axis (elevation) labels when present

/** A "nice" rounded-up axis maximum (1/2/5 × 10^k) so tick labels are clean. */
function niceTop(v: number): number {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / pow;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return nice * pow;
}

const KIND_LABEL: Record<EffortKind, string> = { race: 'Race', workout: 'Workout', long_run: 'Long run' };
const KIND_STYLE: Record<EffortKind, string> = {
  race: 'bg-violet-400/15 text-violet-200 ring-violet-400/30',
  workout: 'bg-amber-400/15 text-amber-200 ring-amber-400/30',
  long_run: 'bg-sky-400/15 text-sky-200 ring-sky-400/30',
};

function fmtMonthDay(day: string): string {
  const [, m, d] = day.split('-');
  return `${Number(m)}/${Number(d)}`;
}

const SPORT_COLOR: Record<string, string> = { swim: '#22d3ee', bike: '#f97316', run: '#a78bfa', strength: '#34d399' };
const SPORT_LABEL: Record<string, string> = { swim: 'Swim', bike: 'Bike', run: 'Run', strength: 'Strength' };
const SPORT_FALLBACK = '#94a3b8';
const sportColor = (s: string) => SPORT_COLOR[s] ?? SPORT_FALLBACK;
const sportLabel = (s: string) => SPORT_LABEL[s] ?? s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Stacked weekly TRAINING TIME by sport — the multisport volume view. Time is
 * the only currency that adds up across swim/bike/run/strength, so this is hours,
 * not distance. Rendered only when the athlete trains more than one sport.
 */
function MultiSportTimeChart({ timeByWeek, sports }: { timeByWeek: WeekTime[]; sports: string[] }) {
  const totalsMin = timeByWeek.map((w) => sports.reduce((sum, s) => sum + (w.bySport[s] ?? 0), 0));
  const peakMin = Math.max(...totalsMin, 0);
  if (peakMin <= 0) return null;

  const n = timeByWeek.length;
  const padR = PAD_R_BASE;
  const plotW = W - PAD_L - padR;
  const plotBottom = H - PAD_B;
  const plotTop = PAD_T;
  const plotHeight = plotBottom - plotTop;

  const topHours = niceTop(peakMin / 60);
  const topMin = topHours * 60;
  const slot = plotW / n;
  const barW = slot * 0.62;
  const yFor = (min: number) => (min / topMin) * plotHeight;
  const ticks = [0, 0.5, 1];

  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Weekly training time by sport</h3>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Weekly training time by sport, last 12 weeks">
        {ticks.map((t) => {
          const y = plotBottom - t * plotHeight;
          return (
            <g key={t}>
              <line x1={PAD_L} x2={W - padR} y1={y} y2={y} stroke="#26304a" strokeWidth={1} />
              <text x={PAD_L - 4} y={y + 3} textAnchor="end" className="fill-slate-400" fontSize={9}>
                {Math.round(t * topHours)}
              </text>
            </g>
          );
        })}
        <text x={PAD_L - 4} y={plotTop - 1} textAnchor="end" className="fill-slate-400" fontSize={8}>
          h
        </text>

        {/* stacked bars: sports bottom-up */}
        {timeByWeek.map((w, i) => {
          const x = PAD_L + i * slot + (slot - barW) / 2;
          let yCursor = plotBottom;
          return (
            <g key={w.weekStart}>
              {sports.map((s) => {
                const min = w.bySport[s] ?? 0;
                if (min <= 0) return null;
                const h = yFor(min);
                yCursor -= h;
                return (
                  <rect key={s} x={x.toFixed(1)} y={yCursor.toFixed(1)} width={barW.toFixed(1)} height={h.toFixed(1)} fill={sportColor(s)} fillOpacity={0.85} />
                );
              })}
            </g>
          );
        })}

        {timeByWeek.map((w, i) =>
          i % 2 === 0 ? (
            <text key={w.weekStart} x={(PAD_L + i * slot + slot / 2).toFixed(1)} y={H - 5} textAnchor="middle" className="fill-slate-400" fontSize={9}>
              {fmtMonthDay(w.weekStart)}
            </text>
          ) : null,
        )}
      </svg>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-slate-500">
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {sports.map((s) => (
            <span key={s} className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-3 rounded-sm" style={{ backgroundColor: sportColor(s) }} /> {sportLabel(s)}
            </span>
          ))}
        </div>
        <span className="text-slate-400">peak {(peakMin / 60).toFixed(1)} h/wk</span>
      </div>
    </div>
  );
}

export function WeeklyVolumeChart({ summary, runLinkBase, units }: { summary: TrainingSummary; runLinkBase?: string; units: Units }) {
  const { weeks, efforts, hasElevation, timeByWeek, sports } = summary;
  const anyMiles = weeks.some((w) => w.miles > 0);
  const multiSport = sports.length > 1;
  if (!anyMiles) {
    // A cyclist / swimmer with no runs still has training volume — show the
    // by-sport time chart rather than an empty "connect Strava" message.
    if (multiSport) {
      return (
        <div className="space-y-4">
          <MultiSportTimeChart timeByWeek={timeByWeek} sports={sports} />
        </div>
      );
    }
    return <p className="text-sm text-slate-400">No runs in the last 12 weeks yet, connect Strava to populate this.</p>;
  }

  const n = weeks.length;
  const showElev = hasElevation && weeks.some((w) => w.elevationFt > 0);
  const padR = showElev ? PAD_R_ELEV : PAD_R_BASE;
  const plotW = W - PAD_L - padR;
  const plotBottom = H - PAD_B;
  const plotTop = PAD_T;
  const plotHeight = plotBottom - plotTop;

  const milesTop = niceTop(Math.max(...weeks.map((w) => w.miles), 1));
  const elevTop = niceTop(Math.max(...weeks.map((w) => w.elevationFt), 1));
  const slot = plotW / n;
  const barW = slot * 0.62;

  const cx = (i: number) => PAD_L + i * slot + slot / 2;
  const yMiles = (v: number) => plotBottom - (v / milesTop) * plotHeight;
  const yElev = (v: number) => plotBottom - (v / elevTop) * plotHeight;
  const ticks = [0, 0.5, 1]; // fractions of the top → gridlines + labels

  const elevPath = weeks
    .map((w, i) => `${i === 0 ? 'M' : 'L'} ${cx(i).toFixed(1)} ${yElev(w.elevationFt).toFixed(1)}`)
    .join(' ');
  const peakMiles = Math.max(...weeks.map((w) => w.miles));

  return (
    <div className="space-y-4">
      {/* Multisport athletes lead with cross-sport TIME; the run-mileage chart
          below stays the run-specific detail. Runners see only the miles chart. */}
      {multiSport && <MultiSportTimeChart timeByWeek={timeByWeek} sports={sports} />}
      <div>
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Weekly mileage and elevation, last 12 weeks">
          {/* horizontal gridlines + left (miles) and right (elevation) axis labels */}
          {ticks.map((t) => {
            const y = plotBottom - t * plotHeight;
            return (
              <g key={t}>
                <line x1={PAD_L} x2={W - padR} y1={y} y2={y} stroke="#26304a" strokeWidth={1} />
                <text x={PAD_L - 4} y={y + 3} textAnchor="end" className="fill-slate-400" fontSize={9}>
                  {Math.round(t * distanceValue(milesTop * 1609.344, units))}
                </text>
                {showElev && (
                  <text x={W - padR + 4} y={y + 3} textAnchor="start" className="fill-orange-400" fontSize={9}>
                    {Math.round(t * elevTop)}
                  </text>
                )}
              </g>
            );
          })}
          {/* axis captions */}
          <text x={PAD_L - 4} y={plotTop - 1} textAnchor="end" className="fill-slate-400" fontSize={8}>
            {distanceUnit(units)}
          </text>
          {showElev && (
            <text x={W - padR + 4} y={plotTop - 1} textAnchor="start" className="fill-orange-400" fontSize={8}>
              ft
            </text>
          )}

          {/* mileage bars */}
          {weeks.map((w, i) => {
            const y = yMiles(w.miles);
            const x = PAD_L + i * slot + (slot - barW) / 2;
            return (
              <rect
                key={w.weekStart}
                x={x.toFixed(1)}
                y={y.toFixed(1)}
                width={barW.toFixed(1)}
                height={Math.max(0, plotBottom - y).toFixed(1)}
                rx={1.5}
                fill="#0ea5e9"
                fillOpacity={0.7}
              />
            );
          })}
          {/* elevation line */}
          {showElev && <path d={elevPath} fill="none" stroke="#f97316" strokeWidth={1.5} strokeLinejoin="round" />}
          {/* week labels: every other week to avoid crowding */}
          {weeks.map((w, i) =>
            i % 2 === 0 ? (
              <text key={w.weekStart} x={cx(i).toFixed(1)} y={H - 5} textAnchor="middle" className="fill-slate-400" fontSize={9}>
                {fmtMonthDay(w.weekStart)}
              </text>
            ) : null,
          )}
        </svg>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-slate-500">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-3 rounded-sm bg-sky-500/70" /> Weekly run {distanceUnit(units)}
            </span>
            {hasElevation && (
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-0 w-3 border-t-2 border-orange-500" /> Weekly elevation (ft)
              </span>
            )}
          </div>
          <span className="text-slate-400">peak {distanceValue(peakMiles * 1609.344, units).toFixed(0)} {distanceUnit(units)}/wk</span>
        </div>
      </div>

      {/* Labeled efforts table */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Workouts, long runs &amp; races
        </h3>
        {efforts.length ? (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="py-1 font-medium">Date</th>
                <th className="py-1 font-medium">Type</th>
                <th className="py-1 font-medium">Run</th>
                <th className="py-1 text-right font-medium">{distanceUnit(units) === "km" ? "Km" : "Miles"}</th>
                <th className="py-1 text-right font-medium">Pace</th>
                {hasElevation && <th className="py-1 text-right font-medium">Elev</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {efforts.map((e, i) => (
                <tr key={`${e.day}-${i}`}>
                  <td className="py-1.5 text-slate-600">{e.day}</td>
                  <td className="py-1.5">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${KIND_STYLE[e.kind]}`}
                    >
                      {KIND_LABEL[e.kind]}
                    </span>
                  </td>
                  <td className="py-1.5 text-slate-700">
                    {runLinkBase ? (
                      <Link href={`${runLinkBase}/${e.id}`} className="text-sky-300 hover:underline">
                        {e.name ?? 'Run'}
                      </Link>
                    ) : (
                      e.name ?? '-'
                    )}
                  </td>
                  <td className="py-1.5 text-right text-slate-700">{distanceValue(e.miles * 1609.344, units).toFixed(1)}</td>
                  <td className="py-1.5 text-right text-slate-600">
                    {e.paceSecPerKm != null ? fmtPace(e.paceSecPerKm, units) : '-'}
                  </td>
                  {hasElevation && (
                    <td className="py-1.5 text-right text-slate-500">{Math.round(e.elevationFt)} ft</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-slate-500">
            No runs tagged as workout, long run, or race in this window. Tag runs in Strava (set the run’s type) and they’ll appear here.
          </p>
        )}
      </div>
    </div>
  );
}
