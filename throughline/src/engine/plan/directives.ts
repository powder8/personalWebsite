/**
 * Effect-windowed adjustments ("directives"). A single mechanism spans the
 * horizons the coach described AND athlete availability:
 *   - global/ongoing  → no end date
 *   - short-term      → a date range (injury, tiredness)
 *   - near-term       → today / a few days (sick, a meeting)
 *   - availability    → athlete marks days they can't train (travel, busy) → rest
 *
 * Pure overlay: directives are ENGINE INPUTS. We never mutate stored sessions;
 * we compute the adjusted view from (session + active directives), so removing a
 * directive instantly reverts the plan.
 */
const MI_TO_KM = 1.609344;

export type AdjustmentType = 'pace_adjust' | 'reduce_volume' | 'unavailable';

export interface ActiveDirective {
  type: AdjustmentType;
  from: string; // 'YYYY-MM-DD'
  to: string | null; // null = open-ended
  deltaSecPerMile?: number; // pace_adjust: + = slower
  factor?: number; // reduce_volume: multiply distance (e.g. 0.7)
  label?: string; // reason/source ("Out of town", "Achilles niggle")
}

export interface AdjustableSession {
  day: string;
  sessionType: string;
  distanceMeters: number | null;
  paceFastSecPerKm: number | null;
  paceSlowSecPerKm: number | null;
}

export interface AdjustedSession extends AdjustableSession {
  adjustments: string[]; // human-readable notes of what was applied
}

export function directivesActiveOn(day: string, directives: ActiveDirective[]): ActiveDirective[] {
  return directives.filter((d) => day >= d.from && (d.to == null || day <= d.to));
}

export function applyDirectives(
  session: AdjustableSession,
  directives: ActiveDirective[],
): AdjustedSession {
  const active = directivesActiveOn(session.day, directives);
  const adjustments: string[] = [];
  let out: AdjustedSession = { ...session, adjustments };

  if (active.length === 0) return out;

  // Unavailable wins: the day becomes rest.
  const unavailable = active.find((d) => d.type === 'unavailable');
  if (unavailable && session.sessionType !== 'rest') {
    adjustments.push(`Unavailable${unavailable.label ? `, ${unavailable.label}` : ''} → rest`);
    return {
      ...out,
      sessionType: 'rest',
      distanceMeters: 0,
      paceFastSecPerKm: null,
      paceSlowSecPerKm: null,
      adjustments,
    };
  }

  // Pace: sum all pace_adjust deltas (positive = slower).
  const paceDeltaMi = active
    .filter((d) => d.type === 'pace_adjust' && d.deltaSecPerMile)
    .reduce((s, d) => s + (d.deltaSecPerMile ?? 0), 0);
  if (paceDeltaMi !== 0 && out.paceFastSecPerKm != null && out.paceSlowSecPerKm != null) {
    const dKm = paceDeltaMi / MI_TO_KM;
    out = {
      ...out,
      paceFastSecPerKm: out.paceFastSecPerKm + dKm,
      paceSlowSecPerKm: out.paceSlowSecPerKm + dKm,
    };
    const lbl = active.find((d) => d.type === 'pace_adjust')?.label;
    adjustments.push(`${paceDeltaMi > 0 ? '+' : ''}${paceDeltaMi}s/mi${lbl ? `, ${lbl}` : ''}`);
  }

  // Volume: multiply distance by the product of all reduce_volume factors.
  const factor = active
    .filter((d) => d.type === 'reduce_volume' && d.factor)
    .reduce((f, d) => f * (d.factor ?? 1), 1);
  if (factor !== 1 && out.distanceMeters != null) {
    out = { ...out, distanceMeters: out.distanceMeters * factor };
    const lbl = active.find((d) => d.type === 'reduce_volume')?.label;
    adjustments.push(`shortened to ${Math.round(factor * 100)}%${lbl ? `, ${lbl}` : ''}`);
  }

  return { ...out, adjustments };
}
