/**
 * Body status: the service around the pure engine (engine/body).
 *
 *   load vitals + training load + check-ins
 *     → assessBody (healthy baseline, episode detection)
 *     → reconcileEpisode (lifecycle, persisted in health_episodes)
 *     → prescribe (what the plan does about it)
 *     → syncAutoDirectives (the plan actually changes)
 *
 * Runs wherever fresh data or a fresh look arrives: the daily cron, a Whoop
 * webhook (new recovery the moment the athlete wakes), a check-in, and every
 * portal load. It is idempotent, so running it often is safe.
 */
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import type { DB } from '@/db';
import {
  activities,
  athletes,
  checkIns,
  dailySummaries,
  directives,
  healthEpisodes,
  hrvRecords,
  restingHrRecords,
  sleepRecords,
} from '@/db/schema';
import { addDays, diffDays, type DailyReading } from '@/engine';
import {
  VITALS,
  VITAL_KEYS,
  applyAthleteAction,
  assessBody,
  describeVital,
  prescribe,
  reconcileEpisode,
  type AthleteAction,
  type BodyAssessment,
  type BodyStatus,
  type EpisodeKind,
  type EpisodeState,
  type EpisodeStatus,
  type AthleteReport,
  type PastEpisode,
  type Prescription,
  type VitalKey,
  type VitalSeries,
} from '@/engine/body';
import { selectDailyLoad, NO_ANCHORS } from '@/engine/loadSelectLogic';
import { getLoadCurrency, resolveAthleteLoadAnchors } from '@/db/loadCurrencyConfig';
import { createDirective, syncAutoDirectives, type DesiredDirective } from './directives';

/** Enough history for a 56-day baseline behind a ~90-day look back. */
const LOOKBACK_DAYS = 150;

type EpisodeRow = typeof healthEpisodes.$inferSelect;

export interface VitalView {
  key: VitalKey;
  label: string;
  unit: string;
  decimals: number;
  value: number | null;
  day: string | null;
  usual: number | null;
  lo: number | null;
  hi: number | null;
  /** ok = in range; off = clearly worse than usual; forming = baseline not ready. */
  state: 'ok' | 'off' | 'very_off' | 'forming';
  series: { day: string; value: number; inEpisode: boolean }[];
}

export interface BodyStatusView {
  status: BodyStatus;
  tone: Prescription['tone'];
  headline: string;
  body: string;
  planNote: string | null;
  question: string | null;
  asks: Prescription['asks'];
  advice: string[];
  /** Do this today: short imperative steps. */
  today: string[];
  /** What moves the athlete to the next step. */
  next: string | null;
  forceEasy: boolean;
  /** The specific readings behind the call, in plain language. */
  evidence: string[];
  /** During an episode: each affected signal, and whether it is back in range. */
  markers: { key: VitalKey; label: string; state: 'back' | 'improving' | 'off'; text: string }[];
  dataDay: string | null;
  stale: boolean;
  vitals: VitalView[];
  load: { ratio: number | null; note: string | null };
  episode: { id: string; kind: EpisodeKind; status: EpisodeStatus; startedOn: string; days: number; returnDay: number | null; returnDays: number | null } | null;
  history: PastEpisode[];
  strain: { day: string; value: number; inEpisode: boolean }[];
  progressionActive: boolean;
  /** True when this evaluation changed the applied plan. */
  planChanged: boolean;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export async function loadVitalSeries(db: DB, athleteId: string, today: string): Promise<VitalSeries> {
  const from = addDays(today, -LOOKBACK_DAYS);
  const [hrvRows, rhrRows, sleepRows, dailyRows] = await Promise.all([
    db.select({ day: hrvRecords.day, v: hrvRecords.overnightAvgMs }).from(hrvRecords)
      .where(and(eq(hrvRecords.athleteId, athleteId), gte(hrvRecords.day, from), lte(hrvRecords.day, today))),
    db.select({ day: restingHrRecords.day, v: restingHrRecords.restingHr }).from(restingHrRecords)
      .where(and(eq(restingHrRecords.athleteId, athleteId), gte(restingHrRecords.day, from), lte(restingHrRecords.day, today))),
    db.select({ day: sleepRecords.day, total: sleepRecords.totalSleepSeconds, metrics: sleepRecords.metrics }).from(sleepRecords)
      .where(and(eq(sleepRecords.athleteId, athleteId), gte(sleepRecords.day, from), lte(sleepRecords.day, today))),
    db.select({
      day: dailySummaries.day,
      rr: dailySummaries.respiratoryRate,
      spo2: dailySummaries.spo2Pct,
      temp: dailySummaries.skinTempC,
      rhr: dailySummaries.restingHr,
      metrics: dailySummaries.metrics,
    }).from(dailySummaries)
      .where(and(eq(dailySummaries.athleteId, athleteId), gte(dailySummaries.day, from), lte(dailySummaries.day, today))),
  ]);

  const series: Required<VitalSeries> = { hrv: [], resting_hr: [], respiratory_rate: [], skin_temp: [], spo2: [], sleep: [] };
  for (const r of hrvRows) if (r.v != null) series.hrv.push({ day: r.day, value: r.v });
  for (const r of rhrRows) series.resting_hr.push({ day: r.day, value: r.v });
  const rhrDays = new Set(rhrRows.map((r) => r.day));
  const rrDays = new Set<string>();
  for (const r of dailyRows) {
    const m = (r.metrics as Record<string, unknown> | null) ?? null;
    // Columns first; the JSON blob covers rows written before the columns existed.
    const rr = r.rr ?? num(m?.respiratory_rate);
    const spo2 = r.spo2 ?? num(m?.spo2_percentage);
    const temp = r.temp ?? num(m?.skin_temp_celsius);
    if (rr != null) {
      series.respiratory_rate.push({ day: r.day, value: rr });
      rrDays.add(r.day);
    }
    if (spo2 != null) series.spo2.push({ day: r.day, value: spo2 });
    if (temp != null) series.skin_temp.push({ day: r.day, value: temp });
    if (r.rhr != null && !rhrDays.has(r.day)) series.resting_hr.push({ day: r.day, value: r.rhr });
  }
  for (const r of sleepRows) {
    if (r.total != null && r.total > 0) series.sleep.push({ day: r.day, value: r.total / 3600 });
    const rr = num((r.metrics as Record<string, unknown> | null)?.respiratory_rate);
    if (rr != null && !rrDays.has(r.day)) series.respiratory_rate.push({ day: r.day, value: rr });
  }
  return series;
}

/** Daily training load for the load-vs-usual read (last ~60 days is enough). */
export async function loadDailyLoads(db: DB, athleteId: string, today: string): Promise<DailyReading[]> {
  const since = new Date(`${addDays(today, -60)}T00:00:00Z`);
  const rows = await db
    .select({
      startTime: activities.startTime,
      sport: activities.sport,
      durationSeconds: activities.durationSeconds,
      distanceMeters: activities.distanceMeters,
      avgPaceSecPerKm: activities.avgPaceSecPerKm,
      avgHr: activities.avgHr,
      maxHr: activities.maxHr,
      trainingLoad: activities.trainingLoad,
      trainingLoadTss: activities.trainingLoadTss,
    })
    .from(activities)
    .where(and(eq(activities.athleteId, athleteId), gte(activities.startTime, since)));
  if (rows.length === 0) return [];
  const currency = await getLoadCurrency(db);
  const anchors = currency === 'tss' ? await resolveAthleteLoadAnchors(db, athleteId) : NO_ANCHORS;
  return rows.map((r) => {
    const km = (r.distanceMeters ?? 0) / 1000;
    const duration = r.durationSeconds && r.durationSeconds > 0 ? r.durationSeconds : km * (r.avgPaceSecPerKm ?? 330);
    const { value } = selectDailyLoad(
      { sport: r.sport, durationSeconds: duration, distanceMeters: r.distanceMeters, avgHr: r.avgHr, avgPaceSecPerKm: r.avgPaceSecPerKm, maxHr: r.maxHr, trainingLoad: r.trainingLoad, trainingLoadTss: r.trainingLoadTss },
      currency,
      anchors,
    );
    return { day: r.startTime.toISOString().slice(0, 10), value };
  });
}

function toState(r: EpisodeRow): EpisodeState {
  return {
    kind: r.kind as EpisodeKind,
    status: r.status as EpisodeStatus,
    startedOn: r.startedOn,
    lastOffDay: r.lastOffDay,
    report: (r.report as AthleteReport | null) ?? null,
    reportedOn: r.reportedOn,
    dismissedOn: r.dismissedOn,
    reraised: r.reraised,
    clearedOn: r.clearedOn,
    returnDays: r.returnDays,
    resolvedOn: r.resolvedOn,
    peakScore: r.peakScore,
  };
}

interface Loaded {
  mode: 'assisted' | 'autonomous';
  assessment: BodyAssessment;
  open: EpisodeRow | null;
  /** The latest day an episode was resolved (so its lagging tail isn't reopened). */
  handledThrough: string | null;
}

async function load(db: DB, athleteId: string, today: string): Promise<Loaded | null> {
  const [athlete] = await db.select({ mode: athletes.coachingMode }).from(athletes).where(eq(athletes.id, athleteId)).limit(1);
  if (!athlete) return null;
  const [series, loads, checks, episodes] = await Promise.all([
    loadVitalSeries(db, athleteId, today),
    loadDailyLoads(db, athleteId, today),
    db.select().from(checkIns).where(and(eq(checkIns.athleteId, athleteId), gte(checkIns.day, addDays(today, -4)), lte(checkIns.day, today))),
    db.select().from(healthEpisodes).where(eq(healthEpisodes.athleteId, athleteId)).orderBy(desc(healthEpisodes.startedOn)).limit(20),
  ]);
  const avg = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const subjective = {
    energy: avg(checks.map((c) => c.energy)),
    soreness: avg(checks.map((c) => c.soreness)),
    lifeStress: avg(checks.map((c) => c.lifeStress)),
    sleepQuality: avg(checks.map((c) => c.sleepQuality)),
  };
  const open = episodes.find((e) => e.status !== 'resolved') ?? null;
  const lastEnded = episodes.filter((e) => e.resolvedOn).map((e) => e.resolvedOn!).sort().at(-1) ?? null;
  // "I feel fine" → those days count as normal. A second dismissal accepts it for good.
  const accept = episodes
    .filter((e) => e.dismissedOn)
    .map((e) => ({ from: e.startedOn, to: addDays(e.dismissedOn!, e.reraised ? 28 : 4) }));
  const assessment = assessBody(series, loads, today, {
    accept,
    subjective,
    daysSinceEpisodeEnd: open ? 0 : lastEnded ? diffDays(today, lastEnded) : null,
  });
  return { mode: athlete.mode, assessment, open, handledThrough: lastEnded };
}

async function saveEpisode(db: DB, athleteId: string, row: EpisodeRow | null, next: EpisodeState | null): Promise<EpisodeRow | null> {
  if (!next) return row;
  const values = {
    kind: next.kind,
    status: next.status,
    startedOn: next.startedOn,
    lastOffDay: next.lastOffDay,
    report: next.report,
    reportedOn: next.reportedOn,
    dismissedOn: next.dismissedOn,
    reraised: next.reraised,
    clearedOn: next.clearedOn,
    returnDays: next.returnDays,
    resolvedOn: next.resolvedOn,
    peakScore: next.peakScore,
    updatedAt: new Date(),
  };
  if (!row) {
    const [created] = await db.insert(healthEpisodes).values({ athleteId, ...values }).returning();
    return created;
  }
  const prev = toState(row);
  if (JSON.stringify(prev) === JSON.stringify(next)) return row;
  const [updated] = await db.update(healthEpisodes).set(values).where(eq(healthEpisodes.id, row.id)).returning();
  return updated;
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

function evidenceFor(a: BodyAssessment, inEpisode: boolean): string[] {
  const recent = a.days.slice(-3);
  if (recent.length === 0) return [];
  const rows: { bad: number; text: string }[] = [];
  for (const k of VITAL_KEYS) {
    const rs = (inEpisode ? recent : recent.slice(-1)).map((d) => d.vitals[k]).filter((r): r is NonNullable<typeof r> => !!r && r.bad != null);
    if (rs.length === 0) continue;
    const meanBad = rs.reduce((s, r) => s + r.bad!, 0) / rs.length;
    if (meanBad < 1) continue;
    const last = rs[rs.length - 1];
    const value = rs.reduce((s, r) => s + r.value, 0) / rs.length;
    const text = describeVital(k, { ...last, value });
    if (text) rows.push({ bad: meanBad, text: rs.length > 1 ? `${text} (last ${rs.length} nights)` : text });
  }
  return rows.sort((x, y) => y.bad - x.bad).map((r) => r.text);
}

/** Per-signal recovery checklist for an active episode. */
function markersFor(a: BodyAssessment): BodyStatusView['markers'] {
  const e = a.episode;
  if (!e) return [];
  const out: BodyStatusView['markers'] = [];
  const fmt = (k: VitalKey, v: number) => `${v.toFixed(VITALS[k].decimals)}${VITALS[k].unit === 'bpm' || VITALS[k].unit === 'ms' || VITALS[k].unit === 'h' ? ` ${VITALS[k].unit}` : VITALS[k].unit}`;
  // Judge and show the last three nights together, the same window the engine uses,
  // so one noisy night can't contradict the verdict printed next to it.
  const latestOf = (k: VitalKey) => {
    const rs = a.days.slice(-3).map((d) => d.vitals[k]).filter((r): r is NonNullable<typeof r> => !!r && r.usual != null);
    if (rs.length === 0) return null;
    const last = rs[rs.length - 1];
    return { ...last, value: rs.reduce((sum, r) => sum + r.value, 0) / rs.length, nights: rs.length };
  };
  const avg = (n: number) => (n > 1 ? ` (${n}-night average)` : '');
  for (const k of e.recovered) {
    const r = latestOf(k);
    if (!r) continue;
    out.push({ key: k, label: VITALS[k].label, state: 'back', text: `${fmt(k, r.value)}${avg(r.nights)}, back in your range (${r.lo!.toFixed(VITALS[k].decimals)}–${r.hi!.toFixed(VITALS[k].decimals)})` });
  }
  for (const k of e.stillOff) {
    const r = latestOf(k);
    if (!r) continue;
    const side = VITALS[k].bad === 'low' ? 'below' : 'above';
    const improving = e.improving.includes(k);
    out.push({
      key: k,
      label: VITALS[k].label,
      state: improving ? 'improving' : 'off',
      text: `${fmt(k, r.value)}${avg(r.nights)}, still ${side} your range (${r.lo!.toFixed(VITALS[k].decimals)}–${r.hi!.toFixed(VITALS[k].decimals)})${improving ? ', and improving' : ''}`,
    });
  }
  return out;
}

function buildView(a: BodyAssessment, p: Prescription, row: EpisodeRow | null, today: string, progressionActive: boolean, planChanged: boolean): BodyStatusView {
  const open = row && row.status !== 'resolved' ? row : null;
  const vitals: VitalView[] = VITAL_KEYS.map((k): VitalView => {
    const spec = VITALS[k];
    const withK = a.days.filter((d) => d.vitals[k]);
    const latest = withK[withK.length - 1];
    const r = latest?.vitals[k] ?? null;
    return {
      key: k,
      label: spec.label,
      unit: spec.unit,
      decimals: spec.decimals,
      value: r?.value ?? null,
      day: latest?.day ?? null,
      usual: r?.usual ?? null,
      lo: r?.lo ?? null,
      hi: r?.hi ?? null,
      state: !r || r.bad == null ? 'forming' : r.bad >= 2 ? 'very_off' : r.bad >= 1 ? 'off' : 'ok',
      series: withK.filter((d) => diffDays(today, d.day) < 42).map((d) => ({ day: d.day, value: d.vitals[k]!.value, inEpisode: d.inEpisode })),
    };
  }).filter((v) => v.value != null);

  const ratio = a.load.ratio;
  const loadNote =
    ratio == null
      ? null
      : ratio >= 1.3
        ? `Your training load this week is about ${ratio.toFixed(1)}× your usual week.`
        : ratio <= 0.6
          ? 'Your training load this week is well below your usual week.'
          : 'Your training load this week is close to your usual week.';

  return {
    status: p.status,
    tone: p.tone,
    headline: p.headline,
    body: p.body,
    planNote: p.planNote,
    question: p.question,
    asks: progressionActive ? p.asks.filter((x) => x.action !== 'progress') : p.asks,
    advice: p.advice,
    today: p.today,
    next: p.next,
    forceEasy: p.forceEasy,
    // Once recovery is under way the checklist replaces the raw evidence list.
    evidence: a.episode?.phase === 'recovering' ? [] : evidenceFor(a, !!a.episode),
    markers: markersFor(a),
    dataDay: a.dataDay,
    stale: a.stale,
    vitals,
    load: { ratio, note: loadNote },
    episode: open
      ? {
          id: open.id,
          kind: open.kind as EpisodeKind,
          status: open.status as EpisodeStatus,
          startedOn: open.startedOn,
          days: diffDays(today, open.startedOn) + 1,
          returnDay: open.status === 'returning' && open.clearedOn ? diffDays(today, open.clearedOn) + 1 : null,
          returnDays: open.returnDays,
        }
      : null,
    history: a.history.filter((h) => diffDays(today, h.endedOn) <= 120),
    strain: a.days.filter((d) => d.strain != null && diffDays(today, d.day) < 42).map((d) => ({ day: d.day, value: d.strain!, inEpisode: d.inEpisode })),
    progressionActive,
    planChanged,
  };
}

// ---------------------------------------------------------------------------
// Evaluate (+ apply)
// ---------------------------------------------------------------------------

async function progressionIsActive(db: DB, athleteId: string, today: string): Promise<{ active: boolean; ids: string[] }> {
  const rows = await db.select().from(directives).where(and(eq(directives.athleteId, athleteId), eq(directives.active, true)));
  const mine = rows.filter((r) => (r.params as { category?: string } | null)?.category === 'progression' && (r.effectiveTo == null || r.effectiveTo >= today));
  return { active: mine.length > 0, ids: mine.map((r) => r.id) };
}

function toDesired(p: Prescription, mode: 'assisted' | 'autonomous'): DesiredDirective[] {
  return p.actions.map((x) => ({
    key: x.key,
    type: x.type,
    factor: x.factor,
    from: x.from,
    to: x.to,
    label: x.label,
    // A coach approves fatigue adjustments; illness holds never wait on one.
    proposed: mode === 'assisted' && !x.safety,
    keepRace: true,
  }));
}

export interface EvaluateResult {
  view: BodyStatusView;
  assessment: BodyAssessment;
  episode: EpisodeRow | null;
  /** The episode moved to a state the athlete hasn't been told about yet. */
  notifyKey: string | null;
}

/**
 * Evaluate the athlete's body status as of `today`. With `apply`, persist the
 * episode and bring the plan's automatic adjustments in line.
 */
export async function evaluateBodyStatus(db: DB, athleteId: string, today: string, opts: { apply?: boolean } = {}): Promise<EvaluateResult | null> {
  const loaded = await load(db, athleteId, today);
  if (!loaded) return null;
  const { assessment, mode } = loaded;
  const prev = loaded.open ? toState(loaded.open) : null;
  const next = reconcileEpisode(prev, assessment, today, { handledThrough: loaded.handledThrough });
  const p = prescribe(next, assessment, today);

  let row = loaded.open;
  let planChanged = false;
  const prog = await progressionIsActive(db, athleteId, today);
  if (opts.apply) {
    row = await saveEpisode(db, athleteId, loaded.open, next);
    planChanged = await syncAutoDirectives(db, athleteId, 'body_status', toDesired(p, mode));
    // Extra volume never rides along with a body that is struggling.
    if (prog.active && !['ready', 'primed', 'watch'].includes(p.status)) {
      for (const id of prog.ids) await db.update(directives).set({ active: false }).where(eq(directives.id, id));
      prog.active = false;
      planChanged = true;
    }
  }

  const key = row && row.status !== 'resolved' && row.status !== 'dismissed' ? `${row.status}:${row.kind}:${row.report ?? ''}` : null;
  const notifyKey = opts.apply && row && key && row.notifiedKey !== key ? key : null;
  return { view: buildView(assessment, p, row, today, prog.active, planChanged), assessment, episode: row, notifyKey };
}

/** Record that the athlete has been told about the episode's current state. */
export async function markNotified(db: DB, episodeId: string, key: string): Promise<void> {
  await db.update(healthEpisodes).set({ notifiedKey: key }).where(eq(healthEpisodes.id, episodeId));
}

/** The athlete told us something ("I'm ill", "I feel fine", "I'm better", …). */
export async function recordAthleteAction(db: DB, athleteId: string, today: string, action: AthleteAction | 'progress'): Promise<BodyStatusView | null> {
  const loaded = await load(db, athleteId, today);
  if (!loaded) return null;

  if (action === 'progress') {
    const now = prescribe(loaded.open ? toState(loaded.open) : null, loaded.assessment, today);
    const prog = await progressionIsActive(db, athleteId, today);
    // Only ever on offer: never while anything is off, never stacked.
    if (now.status !== 'primed' || prog.active) throw new Error('Extra volume is only available while your recovery signals are steady.');
    await createDirective(db, athleteId, {
      type: 'reduce_volume',
      factor: 1.06,
      from: today,
      to: addDays(today, 6),
      label: 'You chose to add about 6% this week',
      source: 'athlete',
      category: 'progression',
      keepRace: true,
    });
  } else {
    const prev = loaded.open ? toState(loaded.open) : null;
    const next = applyAthleteAction(prev, action, loaded.assessment, today);
    const row = await saveEpisode(db, athleteId, loaded.open, next);
    // What they told us is, by definition, something they already know.
    if (row && next) await markNotified(db, row.id, `${next.status}:${next.kind}:${next.report ?? ''}`);
  }
  const result = await evaluateBodyStatus(db, athleteId, today, { apply: true });
  return result?.view ?? null;
}
