import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ftpFromRamp,
  ftpFromTwentyMin,
  ftpFromEightMin,
  ftpFromSixtyMin,
  ftpFromPowerCurve,
  criticalPowerFit,
  ftpFromTest,
  resolveFtp,
  resolvePowerZones,
  DEFAULT_GLOBAL_POWER_MODEL,
  type FtpTest,
  type GlobalPowerModel,
} from '../index';

// --- individual estimators (the vdotFrom* analogs) ---

test('ramp test: FTP = 0.75 × best 1-min power', () => {
  assert.equal(ftpFromRamp(400), 300);
  assert.equal(ftpFromRamp(400, 0.72), 288); // tunable factor
});

test('20-min test: FTP = 0.95 × avg 20-min power', () => {
  assert.equal(ftpFromTwentyMin(300), 285);
});

test('8-min test: FTP = 0.90 × avg 8-min power', () => {
  assert.equal(ftpFromEightMin(320), 288);
});

test('60-min / threshold ride: FTP = avg power (definitional)', () => {
  assert.equal(ftpFromSixtyMin(276), 276);
});

// --- Critical Power fit (the bestEffort → VDOT analog) ---

test('CP fit recovers CP and W′ from a synthetic P(t) = W′/t + CP curve', () => {
  const CP = 280;
  const WPRIME = 20000; // joules
  const curve = [180, 300, 600, 900, 1200].map((t) => ({
    durationSeconds: t,
    watts: WPRIME / t + CP,
  }));
  const fit = criticalPowerFit(curve);
  assert.ok(fit);
  assert.ok(Math.abs(fit!.cp - CP) < 1, `CP ~${CP}, got ${fit!.cp}`);
  assert.ok(Math.abs(fit!.wPrime - WPRIME) < 50, `W' ~${WPRIME}, got ${fit!.wPrime}`);
  // FTP ≈ CP by default (cpToFtp = 1.0).
  assert.equal(ftpFromPowerCurve(curve), Math.round(CP));
  // A lower cpToFtp scales FTP below CP.
  assert.equal(ftpFromPowerCurve(curve, 0.97), Math.round(CP * 0.97));
});

test('CP fit is null when under-determined (fewer than two distinct durations)', () => {
  assert.equal(criticalPowerFit([{ durationSeconds: 600, watts: 300 }]), null);
  assert.equal(
    criticalPowerFit([
      { durationSeconds: 600, watts: 300 },
      { durationSeconds: 600, watts: 305 },
    ]),
    null,
  );
  assert.equal(ftpFromPowerCurve([{ durationSeconds: 600, watts: 300 }]), null);
});

// --- ftpFromTest dispatch ---

test('ftpFromTest dispatches each kind and honours global multipliers', () => {
  assert.equal(ftpFromTest({ kind: 'ramp', best1MinWatts: 400 }), 300);
  assert.equal(ftpFromTest({ kind: 'twenty_min', avg20MinWatts: 300 }), 285);
  assert.equal(ftpFromTest({ kind: 'eight_min', avg8MinWatts: 320 }), 288);
  assert.equal(ftpFromTest({ kind: 'sixty_min', avg60MinWatts: 260 }), 260);
  // threshold_ride prefers a 60-min number, falls back to 0.95×20-min.
  assert.equal(ftpFromTest({ kind: 'threshold_ride', avg60MinWatts: 265 }), 265);
  assert.equal(ftpFromTest({ kind: 'threshold_ride', avg20MinWatts: 300 }), 285);
  // Missing the required field → null (not a throw).
  assert.equal(ftpFromTest({ kind: 'ramp' }), null);

  const tuned: GlobalPowerModel = { ...DEFAULT_GLOBAL_POWER_MODEL, rampFactor: 0.7 };
  assert.equal(ftpFromTest({ kind: 'ramp', best1MinWatts: 400 }, tuned), 280);
});

// --- resolveFtp precedence (the getAthleteVdot analog) ---

test('resolveFtp: explicit FTP wins over a test', () => {
  const test: FtpTest = { kind: 'ramp', best1MinWatts: 400 }; // would give 300
  assert.equal(resolveFtp({ ftpWatts: 250, ftpTest: test }), 250);
});

test('resolveFtp: falls back to a test when no explicit FTP', () => {
  assert.equal(resolveFtp({ ftpTest: { kind: 'twenty_min', avg20MinWatts: 300 } }), 285);
});

test('resolveFtp: null when only LTHR (HR-only athlete) or nothing is set', () => {
  assert.equal(resolveFtp({ lthrBpm: 165 }), null);
  assert.equal(resolveFtp({}), null);
});

// --- resolvePowerZones orchestration ---

test('resolvePowerZones: FTP anchor → %FTP watt zones (basis ftp)', () => {
  const z = resolvePowerZones({ ftpWatts: 250 });
  assert.equal(z.basis, 'ftp');
  assert.equal(z.ftpWatts, 250);
  assert.ok(z.zones);
  assert.equal(z.zones!.threshold.hiWatts, Math.round(250 * 1.05));
});

test('resolvePowerZones: no meter but LTHR → %LTHR HR zones (basis lthr)', () => {
  const z = resolvePowerZones({ lthrBpm: 170 });
  assert.equal(z.basis, 'lthr');
  assert.equal(z.ftpWatts, null);
  assert.equal(z.zones, null);
  assert.ok(z.hrZones);
  assert.equal(z.hrZones!.threshold.hiBpm, Math.round(170 * 1.05));
});

test('resolvePowerZones: FTP + LTHR → watt zones plus a secondary HR cue', () => {
  const z = resolvePowerZones({ ftpWatts: 250, lthrBpm: 170 });
  assert.equal(z.basis, 'ftp');
  assert.ok(z.zones);
  assert.ok(z.hrZones, 'HR bands attached as a secondary cue when LTHR is known');
});

test('resolvePowerZones: throws when there is no anchor at all', () => {
  assert.throws(() => resolvePowerZones({}), /no fitness anchor/);
});
