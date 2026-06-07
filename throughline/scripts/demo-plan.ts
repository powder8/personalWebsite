/**
 * Phase 3 demo: the SAME engine + SAME coach templates produce sane plans for
 * very different athletes, because every pace is anchored on the athlete's own
 * threshold. Proves "fidelity to her model now, generalizable later".
 *
 * Run: `npm run demo:plan`
 */
import {
  buildZones,
  estimateThresholdSecPerKm,
  generatePlan,
  adaptWeek,
  paceRangeLabel,
  metersToMiles,
  secPerKmToMinPerMile,
  type PlannedWeek,
} from '../src/engine/plan';

interface Athlete {
  name: string;
  thresholdSecPerKm: number;
  startVolumeMiles: number;
  peakVolumeMiles: number;
}

// Elite (Olympic Trials qualifier-level): threshold from a 1:13 half.
const eliteThreshold = estimateThresholdSecPerKm({ distanceMeters: 21097.5, timeSeconds: 73 * 60 });
// Recreational: threshold from a 4:00 marathon-ish 10K (52:00).
const recThreshold = estimateThresholdSecPerKm({ distanceMeters: 10000, timeSeconds: 52 * 60 });

const athletes: Athlete[] = [
  { name: 'Elite (1:13 half)', thresholdSecPerKm: eliteThreshold, startVolumeMiles: 55, peakVolumeMiles: 72 },
  { name: 'Recreational (52:00 10K)', thresholdSecPerKm: recThreshold, startVolumeMiles: 22, peakVolumeMiles: 38 },
];

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function printWeek(w: PlannedWeek) {
  const total = w.days.reduce((s, d) => s + metersToMiles(d.distanceMeters), 0);
  console.log(
    `\n  ${w.weekStart}  [${w.phase}, cycle ${w.cycle}]  target ${metersToMiles(
      w.targetVolumeMeters,
    ).toFixed(0)} mi / planned ${total.toFixed(1)} mi`,
  );
  for (const d of w.days) {
    const mi = metersToMiles(d.distanceMeters).toFixed(1).padStart(4);
    console.log(`   ${DOW[d.dow]}  ${mi} mi  ${d.description}`);
  }
}

for (const a of athletes) {
  const zones = buildZones(a.thresholdSecPerKm);
  console.log('\n' + '='.repeat(90));
  console.log(`${a.name}  —  threshold ${secPerKmToMinPerMile(a.thresholdSecPerKm)}/mi`);
  console.log(
    `   easy ${paceRangeLabel(zones.zones.easy)} · maintenance ${paceRangeLabel(
      zones.zones.maintenance,
    )} · threshold ${paceRangeLabel(zones.zones.threshold)} · rep ${paceRangeLabel(zones.zones.rep)}`,
  );

  const plan = generatePlan(
    {
      startDay: '2026-01-05',
      goalRaceDay: '2026-04-12',
      startVolumeMiles: a.startVolumeMiles,
      peakVolumeMiles: a.peakVolumeMiles,
    },
    zones,
  );

  console.log(`   ${plan.length}-week build. Showing first base week + a peak week:`);
  printWeek(plan[0]);
  const peak = plan.find((w) => w.phase === 'peak') ?? plan[plan.length - 2];
  printWeek(peak);
}

// Adaptation showcase on the elite's first build week.
console.log('\n' + '='.repeat(90));
console.log('ADAPTATION — elite build week, athlete wakes up unready + sore, with a niggle');
const zones = buildZones(eliteThreshold);
const plan = generatePlan(
  { startDay: '2026-01-05', goalRaceDay: '2026-04-12', startVolumeMiles: 55, peakVolumeMiles: 72 },
  zones,
);
const week = plan.find((w) => w.phase === 'build')!;
const quality = week.days.find((d) => d.runType === 'quality')!;
const { week: adapted, changes } = adaptWeek(week, {
  readiness: { [quality.day]: 'easy' },
  soreness: { [quality.day]: 8 },
  missedSessionsLast7: 2,
});
console.log(`\n  Before: ${quality.description}`);
const after = adapted.days.find((d) => d.day === quality.day)!;
console.log(`  After:  ${after.description}`);
console.log('\n  Changes logged (labeled training data):');
for (const c of changes) console.log(`   • [${c.reason}] ${c.note}`);
