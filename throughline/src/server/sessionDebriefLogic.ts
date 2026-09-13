/**
 * PURE coach's debrief for a NON-run session (bike / swim / strength) — the
 * multisport twin of runDebriefLogic, producing the same shape so the same card
 * renders it. "How training is going" should evaluate your LAST session,
 * whatever the sport, not reach back days for the last run.
 *
 * Grounded, never invented: every signal is a fact the data supports. Rides
 * carry no power here, so effort is read from heart rate only when there's a
 * reference to read it against; otherwise it's reported, not judged.
 */
import type { RunDebriefResult } from '@/server/runDebrief';
import type { RunSignal } from '@/server/runDebriefLogic';
import { fmtDistance, fmtSpeed, type Units } from '@/lib/units';

export type SessionSport = 'bike' | 'swim' | 'strength';

export interface SessionDebriefInput {
  sport: SessionSport;
  distanceMeters: number | null;
  durationSeconds: number | null;
  avgHr: number | null;
  maxHr: number | null;
  elevationGainMeters: number | null;
  /** The session planned for that day in THIS sport, if any. */
  planned: {
    sessionType: string;
    durationSeconds: number | null; // bike / strength prescription
    distanceMeters: number | null; // swim prescription
  } | null;
  /** Lactate-threshold HR (bike), when the athlete has one — lets us judge an easy day. */
  lthrBpm?: number | null;
  units: Units;
}

const NOUN: Record<SessionSport, string> = { bike: 'ride', swim: 'swim', strength: 'strength session' };
const EASY = new Set(['easy', 'recovery', 'endurance', 'aerobic', 'long']);
const FT_PER_M = 3.280839895;

function fmtDur(sec: number): string {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m} min`;
}

export function buildSessionDebrief(input: SessionDebriefInput): RunDebriefResult {
  const { sport, planned, units } = input;
  const noun = NOUN[sport];
  const signals: RunSignal[] = [];
  const wentWell: string[] = [];
  const focusNext: string[] = [];
  const dur = input.durationSeconds ?? 0;
  const dist = input.distanceMeters ?? 0;

  // ── Did you do the planned session? (the one thing that matters most) ──
  let completion: 'hit' | 'short' | 'over' | 'unplanned' = 'unplanned';
  if (planned && planned.sessionType !== 'rest') {
    // Bike/strength are prescribed by time; swim by distance.
    const target = sport === 'swim' ? planned.distanceMeters : planned.durationSeconds;
    const actual = sport === 'swim' ? dist : dur;
    if (target && target > 0 && actual > 0) {
      const ratio = actual / target;
      completion = ratio >= 0.85 && ratio <= 1.25 ? 'hit' : ratio < 0.85 ? 'short' : 'over';
      const pct = Math.round(ratio * 100);
      signals.push({
        key: 'showed_up',
        polarity: completion === 'hit' ? 'positive' : 'caution',
        fact:
          completion === 'hit'
            ? `Planned ${planned.sessionType} ${noun}, done (${pct}% of the target)`
            : completion === 'short'
              ? `${pct}% of the planned ${planned.sessionType} ${noun}`
              : `${pct}% of the planned ${noun}, went long`,
      });
    } else {
      completion = 'hit';
      signals.push({ key: 'showed_up', polarity: 'positive', fact: `Planned ${planned.sessionType} ${noun}, done` });
    }
  } else {
    signals.push({ key: 'showed_up', polarity: 'context', fact: `Unplanned ${noun}` });
  }

  // ── Size of the session ──
  if (dur > 0) {
    let fact = fmtDur(dur);
    if (sport === 'bike' && dist > 0) fact += ` · ${fmtDistance(dist, units)} at ${fmtSpeed(dur / (dist / 1000), units)}`;
    if (sport === 'swim' && dist > 0) fact += ` · ${Math.round(dist).toLocaleString()} m`;
    signals.push({ key: 'duration', polarity: 'context', fact });
  }

  // ── Climbing (bike) ──
  if (sport === 'bike' && input.elevationGainMeters != null && input.elevationGainMeters >= 150) {
    const climb =
      units === 'km'
        ? `${Math.round(input.elevationGainMeters).toLocaleString()} m`
        : `${Math.round(input.elevationGainMeters * FT_PER_M).toLocaleString()} ft`;
    signals.push({ key: 'climbing', polarity: 'context', fact: `${climb} of climbing` });
  }

  // ── Effort: only JUDGE against a reference; otherwise report ──
  const easyDay = !!planned && EASY.has(planned.sessionType);
  let tooHard = false;
  if (input.avgHr) {
    if (input.lthrBpm && input.lthrBpm > 0) {
      const pct = input.avgHr / input.lthrBpm;
      if (easyDay && pct >= 0.9) {
        tooHard = true;
        signals.push({
          key: 'effort',
          polarity: 'caution',
          fact: `Avg ${input.avgHr} bpm, ${Math.round(pct * 100)}% of threshold on an easy day`,
        });
      } else {
        signals.push({ key: 'effort', polarity: 'context', fact: `Avg ${input.avgHr} bpm, ${Math.round(pct * 100)}% of threshold` });
      }
    } else {
      signals.push({
        key: 'effort',
        polarity: 'context',
        fact: input.maxHr ? `Avg ${input.avgHr} bpm, peaked at ${input.maxHr}` : `Avg ${input.avgHr} bpm`,
      });
    }
  }

  // ── Words ──
  let headline: string;
  switch (completion) {
    case 'hit':
      headline = sport === 'strength' ? 'Strength banked' : `Solid ${noun}`;
      wentWell.push(
        sport === 'strength'
          ? 'You did the strength work, that is what keeps the endurance training injury-free.'
          : `You did the ${noun} that was on the plan, and did it properly. That is the whole job.`,
      );
      break;
    case 'short':
      headline = `Cut the ${noun} short`;
      wentWell.push(`You got out and did part of it, which beats skipping the day.`);
      focusNext.push(`If you were tired, that was the right call. If life got in the way, protect the next planned ${noun}.`);
      break;
    case 'over':
      headline = `Went long on the ${noun}`;
      wentWell.push(`Plenty of aerobic work in the legs.`);
      focusNext.push(`Going well past the plan adds fatigue the next sessions have to absorb. Bank the number, then hit the plan.`);
      break;
    default:
      headline = sport === 'strength' ? 'Bonus strength session' : `Bonus ${noun}`;
      wentWell.push(
        sport === 'bike'
          ? 'Aerobic work in the legs without the pounding. It all builds the engine.'
          : sport === 'swim'
            ? 'Time in the water builds feel and fitness the run and bike cannot.'
            : 'Extra strength work, durability for everything else.',
      );
      focusNext.push(`Unplanned sessions are fine, just make sure they do not steal from the key days on the plan.`);
  }
  if (tooHard) {
    focusNext.unshift(`That was an easy day and the heart rate says it was not easy. Back it off so the hard days can be hard.`);
  }
  if (focusNext.length === 0) focusNext.push('Nothing to change, bank it and recover well. Keep stacking days like this.');

  return {
    headline,
    signals,
    wentWell: wentWell.join(' '),
    focusNext: focusNext.join(' '),
    narrated: false,
  };
}
