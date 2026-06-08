/**
 * Race "purpose" — the coach-facing reason an athlete is racing. Richer than the
 * engine's structural `priority` (goal / tune_up / training), which only encodes
 * taper behavior. Each purpose maps to a priority so the planner keeps working,
 * while the coach/athlete pick from vocabulary that matches how they actually
 * think about a season. (Heather's feedback.)
 */
export type EnginePriority = 'goal' | 'tune_up' | 'training';

export interface RacePurpose {
  value: string;
  label: string;
  priority: EnginePriority;
  hint?: string;
}

/**
 * Selectable purposes for key (non-goal) races. `tune_up` races get a sharpening
 * mini-taper from the engine; `training` races are run through with no taper.
 */
export const RACE_PURPOSES: RacePurpose[] = [
  { value: 'tune_up', label: 'Tune-up', priority: 'tune_up', hint: 'Sharpening race on the path to the goal' },
  { value: 'sharpening', label: 'Sharpening race', priority: 'tune_up', hint: 'Race-specific sharpening, mini-taper' },
  { value: 'competitive', label: 'Competitive effort', priority: 'tune_up', hint: 'All-out race effort' },
  { value: 'rust_buster', label: 'Rust-buster', priority: 'training', hint: 'Shake off rust, run through it' },
  { value: 'vo2_5k_block', label: 'VO2 max / 5K block', priority: 'training', hint: 'Raced as part of a speed block' },
  { value: 'pacing', label: 'Pacing effort', priority: 'training', hint: 'Controlled / pacing, no taper' },
  { value: 'training', label: 'Training race', priority: 'training', hint: 'Run through within the build' },
];

const BY_VALUE = new Map(RACE_PURPOSES.map((p) => [p.value, p]));

/** Resolve a purpose value to its engine priority (defaults to tune_up). */
export function purposeToPriority(purpose: string | null | undefined): EnginePriority {
  if (!purpose) return 'tune_up';
  return BY_VALUE.get(purpose)?.priority ?? 'tune_up';
}

/** Human label for a purpose value (falls back to the raw value). */
export function purposeLabel(purpose: string | null | undefined): string {
  if (!purpose) return '';
  return BY_VALUE.get(purpose)?.label ?? purpose;
}
