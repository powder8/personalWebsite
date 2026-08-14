/**
 * The swimming microcycle, encoded as the default swim TemplateSet — the
 * swim-side twin of `templates.ts` (running) and `bikeTemplates.ts` (cycling).
 * Same shape, same weekly rhythm, so the shared distribution logic in
 * `swimGenerate.ts` mirrors `bikeGenerate.ts` / `generate.ts` exactly. Only the
 * currency changes: days carry CSS-relative swim zones (`SwimZoneKey`) and the
 * week distributes sTSS, converted per-day into METRES at CSS pace.
 *
 * Swim's distinctive feature vs. run/bike: TECHNIQUE / drill work is a
 * FIRST-CLASS session type (swim-foundation-spec §5 / tri-spec §3.4 — swim's
 * time-yield per hour is high when technique is the limiter). A technique day is
 * a `quality` day flagged `technique: true`; the generator routes it through
 * `buildSwimTechniqueSegments`. The base phase leans on technique (skill unlocks
 * early); build/peak add a VO2/race-pace day above the CSS anchor set.
 *
 * `volumeWeight`, `longRunFraction` (here the long-SWIM fraction) and the day
 * layout are kept parallel to the run/bike sets so all three disciplines
 * periodize identically. Config, not hardcoded logic: swapping the TemplateSet
 * re-coaches the swim plan without code changes, exactly like the other sets.
 */
import type { TemplateSet, WeekTemplate, DayTemplate, SwimZoneKey } from './types';

// dow: 0=Mon 1=Tue 2=Wed 3=Thu 4=Fri 5=Sat 6=Sun

/** An aerobic endurance swim (the swim "easy" fill — CSS+4–10 s/100). */
const aerobic = (dow: number, w = 1.0): DayTemplate => ({ dow, runType: 'easy', volumeWeight: w });
/** The long aerobic pull (the long-run/long-ride analog). */
const long = (dow: number): DayTemplate => ({ dow, runType: 'long', volumeWeight: 0 });
const rest = (dow: number): DayTemplate => ({ dow, runType: 'rest', volumeWeight: 0 });
/** A CSS-relative interval quality day (threshold / vo2max / sprint). */
const quality = (dow: number, zone: SwimZoneKey, workFraction: number, w: number): DayTemplate => ({
  dow,
  runType: 'quality',
  volumeWeight: w,
  quality: { zone, workFraction },
});
/**
 * A first-class TECHNIQUE / drill session — swim's differentiator. Modelled as a
 * quality day flagged `technique`, prescribed by frequency (Friel), swum easy so
 * the CNS learns the stroke; the generator builds it via `buildSwimTechniqueSegments`.
 */
const technique = (dow: number, w = 1.0): DayTemplate => ({
  dow,
  runType: 'quality',
  volumeWeight: w,
  quality: { zone: 'recovery', workFraction: 0.6, technique: true },
});

const base: WeekTemplate = {
  phase: 'base',
  longRunFraction: 0.28,
  days: [
    rest(0),
    quality(1, 'threshold', 0.5, 1.3),
    technique(2, 1.0),
    aerobic(3, 1.1),
    technique(4, 0.8), // base leans on skill — technique twice
    aerobic(5, 1.0),
    long(6),
  ],
};

const build: WeekTemplate = {
  phase: 'build',
  longRunFraction: 0.3,
  days: [
    rest(0),
    quality(1, 'threshold', 0.5, 1.3),
    technique(2, 0.9),
    aerobic(3, 1.0),
    quality(4, 'vo2max', 0.4, 1.1),
    aerobic(5, 1.0),
    long(6),
  ],
};

const peak: WeekTemplate = {
  phase: 'peak',
  longRunFraction: 0.3,
  days: [
    rest(0),
    quality(1, 'threshold', 0.5, 1.3),
    technique(2, 0.8),
    aerobic(3, 1.0),
    quality(4, 'vo2max', 0.45, 1.2),
    aerobic(5, 1.0),
    long(6),
  ],
};

const taper: WeekTemplate = {
  phase: 'taper',
  longRunFraction: 0.24,
  days: [
    rest(0),
    quality(1, 'threshold', 0.4, 1.0),
    technique(2, 0.8),
    rest(3),
    aerobic(4, 0.9),
    rest(5),
    long(6),
  ],
};

export const COACH_SWIM_TEMPLATE_SET: TemplateSet = { base, build, peak, taper };
