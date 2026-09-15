/** Pure freshness and recovery-trend rules. No wearable score is a diagnosis. */
import { addDays, computeBaseline, type DailyReading } from '@/engine';

export function currentSignal(readings: DailyReading[], today: string) {
  // Collapse duplicates deterministically so syncing two providers doesn't
  // turn one date into two baseline days. Provider choice remains upstream.
  const byDay = new Map<string, number[]>();
  for (const r of readings) {
    if (r.day > today || !Number.isFinite(r.value) || r.value <= 0) continue;
    byDay.set(r.day, [...(byDay.get(r.day) ?? []), r.value]);
  }
  const clean = [...byDay].map(([day, vals]) => ({ day, value: vals.reduce((a, b) => a + b, 0) / vals.length }))
    .sort((a, b) => a.day.localeCompare(b.day));
  const latest = clean.at(-1) ?? null;
  const fresh = latest != null && latest.day >= addDays(today, -1);
  const base = computeBaseline(clean, today);
  return { readings: clean, day: latest?.day ?? null, fresh, n: base.n,
    value: latest?.value ?? null, z: fresh && base.n >= 7 ? base.latestZ : null };
}

export interface RecoveryPattern {
  kind: 'strained' | 'settling' | 'steady' | 'unknown';
  title: string;
  body: string;
  lowDays: number;
  observedDays: number;
}

export function recoveryPattern(days: { day: string; band: string | null }[], today: string): RecoveryPattern {
  const observed = new Map(days.filter((d) => d.day >= addDays(today, -6) && d.day <= today && d.band != null)
    .map((d) => [d.day, d.band]));
  const ordered = [...observed].sort(([a], [b]) => a.localeCompare(b));
  const lowDays = ordered.filter(([, band]) => band === 'easy').length;
  const recent = ordered.filter(([day]) => day >= addDays(today, -2));
  const base = { lowDays, observedDays: ordered.length };
  if (recent.filter(([, band]) => band === 'easy').length >= 2) {
    return { ...base, kind: 'strained', title: 'Recovery needs more room',
      body: 'Low readiness on at least two of the last three days. Give recovery priority before adding intensity; training and life both count.' };
  }
  if (recent.length >= 2 && recent.slice(-2).every(([, band]) => band !== 'easy') && lowDays >= 2) {
    return { ...base, kind: 'settling', title: 'Your signals are settling',
      body: 'The latest two readings improved after a rough patch. Return gradually; one good day is not a reason to catch up on missed work.' };
  }
  if (ordered.length < 3 || recent.length === 0) {
    return { ...base, kind: 'unknown', title: 'Building your recovery picture',
      body: 'A few daily check-ins will help distinguish an off day from a pattern. Missing days are left unknown.' };
  }
  return { ...base, kind: 'steady', title: 'No sustained low-readiness pattern',
    body: 'Keep the planned easy and rest days. Feeling good is a reason to follow the plan, not add extra work.' };
}

/** Small, explainable actions from reported signals; never infer a diagnosis. */
export function recoveryFocus(input: {
  lifeStress?: number | null; sleepQuality?: number | null; energy?: number | null; soreness?: number | null;
  sleepZ?: number | null; strained?: boolean;
}): string[] {
  const actions: string[] = [];
  if ((input.lifeStress ?? 0) >= 7) actions.push('Make the day fit your available energy: remove optional training and leave a break between work and exercise.');
  if ((input.sleepQuality != null && input.sleepQuality <= 3) || (input.sleepZ != null && input.sleepZ <= -1)) {
    actions.push('Protect tonight’s sleep opportunity. Keep today flexible rather than trying to make up training after a poor night.');
  }
  if ((input.soreness ?? 0) >= 6) actions.push('Reassess soreness during gentle movement. Pain that changes how you move belongs in “Report pain or injury”, not just a soreness score.');
  if ((input.energy != null && input.energy <= 3) || input.strained) actions.push('Choose an easy session or a recovery break, then check in again tomorrow before adding intensity.');
  return actions.slice(0, 3);
}
