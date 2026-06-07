/**
 * Pace-model comparison for the Daniels debate. Shows, per athlete:
 *   - Daniels VDOT zones (canonical)
 *   - the threshold-offset zones
 *   - an individual customization (run tempos easier, as the coach often does)
 *
 * Run: `npm run demo:zones`
 */
import {
  vdotFromRace,
  resolvePaceZones,
  paceRangeLabel,
  secPerKmToMinPerMile,
  type PaceZones,
  type ZoneKey,
} from '../src/engine/plan';

const ZONES: ZoneKey[] = ['recovery', 'easy', 'maintenance', 'marathon', 'threshold', 'interval', 'rep'];

const athletes = [
  { name: 'Moira (elite)', race: { distanceMeters: 21097.5, timeSeconds: 73 * 60 } },
  { name: 'Recreational', race: { distanceMeters: 10000, timeSeconds: 52 * 60 } },
];

function row(label: string, z: PaceZones) {
  console.log(`  ${label}`);
  for (const k of ZONES) console.log(`    ${k.padEnd(12)} ${paceRangeLabel(z.zones[k])}`);
}

for (const a of athletes) {
  console.log('\n' + '='.repeat(72));
  console.log(`${a.name}  —  VDOT ${vdotFromRace(a.race).toFixed(1)}`);
  row('Daniels (VDOT):', resolvePaceZones({ kind: 'vdot', race: a.race }));
  row('Threshold-offset:', resolvePaceZones({ kind: 'threshold_offset', race: a.race }));
  const tweaked = resolvePaceZones({
    kind: 'vdot',
    race: a.race,
    zoneOverrides: { threshold: { fastAdjust: 25, slowAdjust: 25 } },
  });
  console.log(
    `  Individual tweak — tempos 25 s/km easier: threshold ${paceRangeLabel(tweaked.zones.threshold)} ` +
      `(was ${secPerKmToMinPerMile(resolvePaceZones({ kind: 'vdot', race: a.race }).zones.threshold.fastSecPerKm)}/mi fast)`,
  );
}
