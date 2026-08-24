/**
 * Distance + pace formatting in the athlete's chosen units (miles or kilometers).
 * One central place so every surface reads the same way once it passes `units`.
 * Pure; no server deps.
 */
export type Units = 'mi' | 'km';

const METERS_PER_MILE = 1609.344;

export function asUnits(v: string | null | undefined): Units {
  return v === 'km' ? 'km' : 'mi';
}

/** Short distance-unit label: "mi" or "km". */
export function distanceUnit(units: Units): string {
  return units === 'km' ? 'km' : 'mi';
}

/** Pace-unit label: "/mi" or "/km". */
export function paceUnit(units: Units): string {
  return units === 'km' ? '/km' : '/mi';
}

/** Distance in the athlete's unit, as a number. */
export function distanceValue(meters: number, units: Units): number {
  return units === 'km' ? meters / 1000 : meters / METERS_PER_MILE;
}

/** "5.0 mi" / "8.0 km" — one decimal by default. */
export function fmtDistance(meters: number, units: Units, decimals = 1): string {
  return `${distanceValue(meters, units).toFixed(decimals)} ${distanceUnit(units)}`;
}

/** Pace from seconds-per-KILOMETER into "m:ss" in the athlete's unit (no suffix). */
export function fmtPaceClock(secPerKm: number, units: Units): string {
  const secPerUnit = units === 'km' ? secPerKm : secPerKm * (METERS_PER_MILE / 1000);
  const m = Math.floor(secPerUnit / 60);
  const s = Math.round(secPerUnit - m * 60);
  return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, '0')}`;
}

/** Pace with the unit suffix: "8:30/mi" or "5:17/km". */
export function fmtPace(secPerKm: number, units: Units): string {
  return `${fmtPaceClock(secPerKm, units)}${paceUnit(units)}`;
}
