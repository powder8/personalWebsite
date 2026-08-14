/**
 * The cycling microcycle, encoded as the default bike TemplateSet — the
 * power-side twin of `templates.ts` (running). Same shape, same weekly rhythm
 * (a weekend long ride, a midweek quality anchor, a second quality day in
 * build/peak, endurance + recovery fill), so the shared distribution logic in
 * `bikeGenerate.ts` mirrors `generate.ts` exactly. Only the currency changes:
 * days carry POWER zones (`PowerZoneKey`) and the week distributes TSS, not miles.
 *
 * `volumeWeight`, `longRunFraction` (here the long-RIDE fraction) and the day
 * layout are deliberately kept parallel to the running set so both disciplines
 * periodize identically; the quality zones are the cycling staples — sweet-spot
 * and threshold for muscular endurance / FTP, VO2max to sharpen in build/peak.
 *
 * Config, not hardcoded logic: swapping the TemplateSet re-coaches the bike
 * plan without code changes, exactly like the running set.
 */
import type { TemplateSet, WeekTemplate, DayTemplate, PowerZoneKey } from './types';

// dow: 0=Mon 1=Tue 2=Wed 3=Thu 4=Fri 5=Sat 6=Sun

/**
 * A recovery spin. Low weight ON PURPOSE: recovery power (IF ~0.55) buys little
 * TSS per minute, so a full-weight share would balloon into a multi-hour "easy"
 * ride. A small share keeps the spin short (~30–60 min), the way a coach means it.
 */
const recovery = (dow: number, w = 0.4): DayTemplate => ({ dow, runType: 'recovery', volumeWeight: w });
/** A Z2 endurance ride (the bike's "easy" fill). */
const endurance = (dow: number, w = 1.0): DayTemplate => ({ dow, runType: 'easy', volumeWeight: w });
const long = (dow: number): DayTemplate => ({ dow, runType: 'long', volumeWeight: 0 });
const rest = (dow: number): DayTemplate => ({ dow, runType: 'rest', volumeWeight: 0 });
const quality = (dow: number, zone: PowerZoneKey, workFraction: number, w: number): DayTemplate => ({
  dow,
  runType: 'quality',
  volumeWeight: w,
  quality: { zone, workFraction },
});

const base: WeekTemplate = {
  phase: 'base',
  longRunFraction: 0.24,
  days: [
    recovery(0),
    endurance(1, 1.1),
    quality(2, 'sweetspot', 0.55, 1.4),
    endurance(3, 1.0),
    endurance(4, 1.1),
    endurance(5, 1.1),
    long(6),
  ],
};

const build: WeekTemplate = {
  phase: 'build',
  longRunFraction: 0.28,
  days: [
    recovery(0),
    endurance(1, 1.1),
    quality(2, 'threshold', 0.5, 1.4),
    endurance(3, 1.0),
    endurance(4, 1.1),
    quality(5, 'vo2max', 0.35, 1.2),
    long(6),
  ],
};

const peak: WeekTemplate = {
  phase: 'peak',
  longRunFraction: 0.3,
  days: [
    recovery(0),
    endurance(1, 1.1),
    quality(2, 'threshold', 0.5, 1.4),
    endurance(3, 1.0),
    endurance(4, 1.1),
    quality(5, 'vo2max', 0.4, 1.3),
    long(6),
  ],
};

const taper: WeekTemplate = {
  phase: 'taper',
  longRunFraction: 0.22,
  days: [
    recovery(0),
    endurance(1, 1.0),
    quality(2, 'threshold', 0.4, 1.0),
    endurance(3, 0.9),
    rest(4),
    endurance(5, 0.9),
    long(6),
  ],
};

export const COACH_BIKE_TEMPLATE_SET: TemplateSet = { base, build, peak, taper };
