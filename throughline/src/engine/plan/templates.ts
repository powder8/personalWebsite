/**
 * The coach's microcycle, encoded as the default TemplateSet.
 *
 * Pattern observed in her builds: a weekend long run, a Wednesday quality
 * anchor, a second quality day (Sat) once in build/peak, maintenance + easy
 * fill, a Monday recovery run, and optional Thursday strides. Volume weights
 * distribute the week's non-long mileage; the long run is a fraction of weekly
 * volume (capped in generate).
 *
 * This is config, not hardcoded logic — swapping the TemplateSet generalizes
 * the engine to other coaches/athletes without code changes.
 */
import type { TemplateSet, WeekTemplate, DayTemplate, ZoneKey } from './types';

// dow: 0=Mon 1=Tue 2=Wed 3=Thu 4=Fri 5=Sat 6=Sun

const recovery = (dow: number, w = 1.0): DayTemplate => ({ dow, runType: 'recovery', volumeWeight: w });
const easy = (dow: number, w = 1.0, strides = false): DayTemplate => ({
  dow,
  runType: 'easy',
  volumeWeight: w,
  optionalStrides: strides,
});
const maintenance = (dow: number, w = 1.1): DayTemplate => ({ dow, runType: 'maintenance', volumeWeight: w });
const long = (dow: number): DayTemplate => ({ dow, runType: 'long', volumeWeight: 0 });
const rest = (dow: number): DayTemplate => ({ dow, runType: 'rest', volumeWeight: 0 });
const quality = (dow: number, zone: ZoneKey, workFraction: number, w: number): DayTemplate => ({
  dow,
  runType: 'quality',
  volumeWeight: w,
  quality: { zone, workFraction },
});

const base: WeekTemplate = {
  phase: 'base',
  longRunFraction: 0.22,
  days: [
    recovery(0),
    maintenance(1),
    quality(2, 'threshold', 0.45, 1.4),
    easy(3, 1.0, true),
    maintenance(4),
    easy(5, 1.1),
    long(6),
  ],
};

const build: WeekTemplate = {
  phase: 'build',
  longRunFraction: 0.26,
  days: [
    recovery(0),
    maintenance(1, 1.1),
    quality(2, 'threshold', 0.45, 1.4),
    easy(3, 1.0, true),
    maintenance(4, 1.1),
    quality(5, 'interval', 0.4, 1.2),
    long(6),
  ],
};

const peak: WeekTemplate = {
  phase: 'peak',
  longRunFraction: 0.28,
  days: [
    recovery(0),
    maintenance(1, 1.1),
    quality(2, 'threshold', 0.45, 1.4),
    easy(3, 1.0, true),
    maintenance(4, 1.1),
    quality(5, 'marathon', 0.5, 1.3),
    long(6),
  ],
};

const taper: WeekTemplate = {
  phase: 'taper',
  longRunFraction: 0.18,
  days: [
    recovery(0),
    easy(1, 1.0),
    quality(2, 'threshold', 0.35, 1.0),
    easy(3, 0.9, true),
    rest(4),
    easy(5, 0.9, true),
    long(6),
  ],
};

export const COACH_TEMPLATE_SET: TemplateSet = { base, build, peak, taper };
