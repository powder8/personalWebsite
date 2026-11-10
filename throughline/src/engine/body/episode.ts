/**
 * Episode lifecycle + the plan response. Pure: no DB, no clock.
 *
 * An episode has memory, so the app can do what a coach does: notice, ask,
 * hold training back while it lasts, then bring the athlete back in stages
 * instead of dropping them straight into the old plan.
 *
 *   suspected ──athlete: "I'm ill"/"just tired"──▶ confirmed
 *       │  └────athlete: "I feel fine"──────────▶ dismissed
 *       └─signals back in range (2 days)─┐
 *   confirmed ──"I'm better" / signals clear 3 days──▶ returning ──window ends──▶ resolved
 *   returning ──signals go off again──▶ suspected/confirmed (relapse)
 *
 * Safety asymmetry: holding training back is applied at once; adding training
 * is only ever offered, and the athlete chooses.
 */
import { addDays, diffDays } from '../dates';
import type { BodyAssessment, EpisodeKind } from './assess';
import type { VitalKey } from './vitals';

export type EpisodeStatus = 'suspected' | 'confirmed' | 'dismissed' | 'returning' | 'resolved';
/** What the athlete told us: a cold (above the neck), systemic illness, or just worn down. */
export type AthleteReport = 'mild' | 'systemic' | 'tired';
export type AthleteAction = 'sick_mild' | 'sick_systemic' | 'tired' | 'fine' | 'better' | 'resume';

export interface EpisodeState {
  kind: EpisodeKind;
  status: EpisodeStatus;
  startedOn: string;
  lastOffDay: string;
  report: AthleteReport | null;
  reportedOn: string | null;
  dismissedOn: string | null;
  /** A dismissed episode is raised again at most once if it clearly persists. */
  reraised: boolean;
  clearedOn: string | null;
  returnDays: number | null;
  resolvedOn: string | null;
  peakScore: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** The two signals that gate hard training: HRV and resting HR, when clearly off right now. */
export function coreOff(a: BodyAssessment): VitalKey[] {
  return a.offNow.filter((k) => k === 'hrv' || k === 'resting_hr');
}

/** How long the staged return lasts, scaled to how long the athlete was down. */
export function returnDaysFor(kind: EpisodeKind, report: AthleteReport | null, downDays: number): number {
  if (kind === 'illness') {
    return report === 'systemic' ? clamp(downDays, 4, 14) : clamp(Math.ceil(downDays / 2) + 1, 3, 10);
  }
  if (kind === 'overreaching') return clamp(Math.ceil(downDays / 3) + 1, 2, 6);
  return 0;
}

/** Begin the staged return. `downUntil` is the last day the athlete was down. */
function startReturn(e: EpisodeState, today: string, downUntil: string): EpisodeState {
  const downDays = Math.max(1, diffDays(downUntil, e.startedOn) + 1);
  const days = downDays >= 3 || e.report === 'systemic' ? returnDaysFor(e.kind, e.report, downDays) : 0;
  if (days === 0) return { ...e, status: 'resolved', resolvedOn: today, clearedOn: today, returnDays: 0 };
  return { ...e, status: 'returning', clearedOn: today, returnDays: days };
}

const KIND_RANK: Record<EpisodeKind, number> = { strain: 0, under_recovered: 1, overreaching: 2, illness: 3 };

/** Advance an episode from today's assessment. Returns null when there is nothing open. */
export function reconcileEpisode(
  prev: EpisodeState | null,
  a: BodyAssessment,
  today: string,
  opts: { handledThrough?: string | null } = {},
): EpisodeState | null {
  const det = a.episode;
  let open = prev && prev.status !== 'resolved' ? prev : null;

  if (!open) {
    if (!det) return null;
    // We already walked the athlete back from this one; a slow signal that
    // still lags is watched, not treated as a fresh illness.
    if (opts.handledThrough && det.startedOn <= opts.handledThrough && det.phase !== 'acute') return null;
    // First sight of it. It then runs through the same rules as an existing
    // episode, so one first seen already recovering starts the return today.
    open = {
      kind: det.kind,
      status: 'suspected',
      startedOn: det.startedOn,
      lastOffDay: det.lastOffDay,
      report: null,
      reportedOn: null,
      dismissedOn: null,
      reraised: false,
      clearedOn: null,
      returnDays: null,
      resolvedOn: null,
      peakScore: det.recentScore,
    };
  }

  const seen: EpisodeState = det
    ? {
        ...open,
        // New evidence can escalate the explanation, never quietly downgrade it.
        kind: open.report ? open.kind : KIND_RANK[det.kind] > KIND_RANK[open.kind] ? det.kind : open.kind,
        lastOffDay: det.lastOffDay > open.lastOffDay ? det.lastOffDay : open.lastOffDay,
        peakScore: Math.max(open.peakScore, det.recentScore),
      }
    : open;
  const daysSilent = a.dataDay ? diffDays(today, a.dataDay) : 99;

  switch (open.status) {
    case 'suspected':
      // The illness markers are back in range and only slow signals (HRV,
      // sleep) lag: start easing back in instead of waiting on them.
      if (det?.phase === 'recovering' && open.kind === 'illness') return startReturn(seen, today, today);
      if (det) return seen;
      // The detector leaves an episode only after a sustained return to range.
      if (!a.stale && a.clearStreak >= 1) return startReturn(seen, today, seen.lastOffDay);
      // No wearable data for days and the athlete never confirmed: stop restricting.
      if (daysSilent >= 4) return { ...seen, status: 'resolved', resolvedOn: today };
      return seen;

    case 'confirmed': {
      const sinceReport = open.reportedOn ? diffDays(today, open.reportedOn) : 99;
      // A cold with recovering signals eases back in after a few days. A
      // systemic illness waits for the athlete to say the fever is gone.
      if (det?.phase === 'recovering' && open.report === 'mild' && sinceReport >= 3) return startReturn(seen, today, today);
      if (det) return seen;
      // Signals are back in range and it has been a few days: begin the return
      // rather than resting forever if the athlete never taps "I'm better".
      if (a.clearStreak >= 3 && sinceReport >= 3) return startReturn(seen, today, today);
      if (daysSilent >= 4 && sinceReport >= 10) return startReturn(seen, today, today);
      return seen;
    }

    case 'dismissed': {
      // "I feel fine" buys a few quiet days: those days are accepted as normal.
      const since = open.dismissedOn ? diffDays(today, open.dismissedOn) : 0;
      if (since < 5) return seen;
      if (!det) return a.stale ? seen : { ...seen, status: 'resolved', resolvedOn: today };
      // Still clearly off after that: ask once more, then take their word for it.
      return open.reraised ? seen : { ...seen, status: 'suspected', reraised: true };
    }

    case 'returning': {
      // Relapse means the illness markers are off AGAIN. Low HRV alone is the
      // normal tail of recovery. The athlete's "I'm better" also gets a few
      // days for the signals to catch up.
      const sinceCleared = open.clearedOn ? diffDays(today, open.clearedOn) : 0;
      if (det?.phase === 'acute' && sinceCleared >= 3) {
        return { ...seen, status: open.report ? 'confirmed' : 'suspected', reportedOn: open.report ? today : null, clearedOn: null, returnDays: null };
      }
      const end = addDays(open.clearedOn ?? today, (open.returnDays ?? 0) - 1);
      if (today <= end) return seen;
      // Window over but HRV or resting HR still lags: hold the last (easy) stage up to a week longer.
      if (coreOff(a).length > 0 && diffDays(today, end) <= 7) return seen;
      return { ...seen, status: 'resolved', resolvedOn: today };
    }
    default:
      return seen;
  }
}

/** Apply what the athlete told us. */
export function applyAthleteAction(prev: EpisodeState | null, action: AthleteAction, a: BodyAssessment, today: string): EpisodeState | null {
  const open = prev && prev.status !== 'resolved' ? prev : null;
  const fresh = (kind: EpisodeKind): EpisodeState => ({
    kind,
    status: 'confirmed',
    startedOn: a.episode?.startedOn ?? today,
    lastOffDay: a.episode?.lastOffDay ?? today,
    report: null,
    reportedOn: today,
    dismissedOn: null,
    reraised: false,
    clearedOn: null,
    returnDays: null,
    resolvedOn: null,
    peakScore: a.episode?.recentScore ?? 0,
  });

  switch (action) {
    case 'sick_mild':
    case 'sick_systemic': {
      const base = open ?? fresh('illness');
      return {
        ...base,
        kind: 'illness',
        status: 'confirmed',
        report: action === 'sick_mild' ? 'mild' : 'systemic',
        reportedOn: today,
        lastOffDay: today > base.lastOffDay ? today : base.lastOffDay,
        dismissedOn: null,
        clearedOn: null,
        returnDays: null,
      };
    }
    case 'tired': {
      const base = open ?? fresh('under_recovered');
      // "Not ill, just worn down": training load decides which kind of tired.
      const kind: EpisodeKind = (a.load.ratio ?? 0) >= 1.2 || base.kind === 'overreaching' ? 'overreaching' : 'under_recovered';
      return { ...base, kind, status: 'confirmed', report: 'tired', reportedOn: today, dismissedOn: null, clearedOn: null, returnDays: null };
    }
    case 'fine':
      return open ? { ...open, status: 'dismissed', dismissedOn: today, clearedOn: null, returnDays: null } : null;
    case 'better':
      return open ? startReturn(open, today, today) : null;
    case 'resume':
      return open ? { ...open, status: 'resolved', resolvedOn: today } : null;
  }
}

// ---------------------------------------------------------------------------
// Prescription: what the plan does about it
// ---------------------------------------------------------------------------

export type BodyStatus =
  | 'unknown'
  | 'ready'
  | 'primed'
  | 'watch'
  | 'strained'
  | 'under_recovered'
  | 'overreaching'
  | 'illness_suspected'
  | 'ill'
  | 'returning';

export interface PlanAction {
  /** Stable identity, so an unchanged prescription isn't rewritten every day. */
  key: string;
  type: 'recovery_day' | 'unavailable' | 'reduce_volume';
  factor?: number;
  from: string;
  to: string;
  label: string;
  /** Illness holds apply even when a coach normally approves changes. */
  safety: boolean;
}

export interface AskOption {
  action: AthleteAction | 'progress';
  label: string;
  primary?: boolean;
}

export interface Prescription {
  status: BodyStatus;
  tone: 'good' | 'neutral' | 'caution' | 'alert';
  headline: string;
  body: string;
  /** What changed in the plan, in words. Null when nothing changed. */
  planNote: string | null;
  actions: PlanAction[];
  question: string | null;
  asks: AskOption[];
  advice: string[];
  /** Do this today: short imperative steps. */
  today: string[];
  /** What moves the athlete to the next step. */
  next: string | null;
  /** Today must not be a hard day, whatever the day score says. */
  forceEasy: boolean;
}

const ILL_ASKS: AskOption[] = [
  { action: 'sick_mild', label: 'Yes, a cold (above the neck)' },
  { action: 'sick_systemic', label: 'Yes, with fever, chest, or body aches' },
  { action: 'tired', label: 'No, just tired or stressed' },
  { action: 'fine', label: 'No, I feel fine' },
];

const VITAL_NAMES: Record<string, string> = { hrv: 'HRV', resting_hr: 'resting heart rate', respiratory_rate: 'breathing rate', skin_temp: 'skin temperature', spo2: 'blood oxygen', sleep: 'sleep' };
const pct = (f: number) => `${Math.round((1 - f) * 100)}%`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function prescribe(e: EpisodeState | null, a: BodyAssessment, today: string): Prescription {
  const base = { planNote: null, actions: [] as PlanAction[], question: null, asks: [] as AskOption[], advice: [] as string[], today: [] as string[], next: null as string | null, forceEasy: false };
  const hrvLo = a.latest?.vitals.hrv?.lo;
  const hrvGate = hrvLo != null ? `above ${Math.round(hrvLo)} ms` : 'back in your normal range';
  const TALK = 'Keep the effort easy: you should be able to talk in full sentences the whole time.';
  const open = e && e.status !== 'resolved' ? e : null;
  const act = (key: string, type: PlanAction['type'], from: number, to: number, label: string, factor?: number, safety = false): PlanAction => ({
    key,
    type,
    factor,
    from: addDays(today, from),
    to: addDays(today, to),
    label,
    safety,
  });

  if (open?.status === 'returning') {
    const total = open.returnDays ?? 0;
    const start = open.clearedOn ?? today;
    const dayNo = diffDays(today, start) + 1;
    const p1 = Math.ceil(total / 3);
    const p2 = Math.ceil((2 * total) / 3);
    // HRV or resting HR still off: volume may come back, intensity waits.
    const slow = coreOff(a);
    const lagging = slow.length > 0;
    const stages: { from: number; to: number; type: PlanAction['type']; factor: number; label: string; key: string }[] = [
      { from: 0, to: p1 - 1, type: 'recovery_day', factor: 0.5, label: 'Return, stage 1 of 3: short and easy', key: 'return-0' },
      { from: p1, to: p2 - 1, type: 'recovery_day', factor: 0.75, label: 'Return, stage 2 of 3: easy, building volume', key: 'return-1' },
      lagging
        ? { from: p2, to: total - 1, type: 'recovery_day', factor: 0.9, label: 'Return, stage 3 of 3: near-full volume, easy effort until your HRV recovers', key: 'return-2-easy' }
        : { from: p2, to: total - 1, type: 'reduce_volume', factor: 0.9, label: 'Return, stage 3 of 3: normal sessions at 90%', key: 'return-2' },
    ];
    const actions = stages
      .filter((st) => st.to >= st.from && addDays(start, st.to) >= today)
      .map<PlanAction>((st) => ({
        key: st.key,
        type: st.type,
        factor: st.factor,
        from: addDays(start, st.from) < today ? today : addDays(start, st.from),
        to: addDays(start, st.to),
        label: st.label,
        safety: true,
      }));
    const past = dayNo > total;
    // Past the window with a signal still lagging: keep it easy a little longer.
    if (past && lagging) actions.push(act('return-hold', 'recovery_day', 0, 2, 'Easy effort until your HRV recovers', 0.9, true));
    const stage = dayNo <= p1 ? 1 : dayNo <= p2 ? 2 : 3;
    const stageEnd = stage === 1 ? p1 : stage === 2 ? p2 : total;
    const left = Math.max(0, stageEnd - dayNo + 1);
    const inDays = left <= 1 ? 'Tomorrow' : `In ${left} days`;

    const recovered = (a.episode?.recovered ?? []).filter((k) => !a.offNow.includes(k));
    const stillOff = a.offNow;
    const names = (ks: string[]) => {
      const n = ks.map((k) => VITAL_NAMES[k] ?? k);
      return n.length <= 1 ? n.join('') : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
    };
    const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
    // Only slow signals lagging is the normal tail of recovery; fast ones still off is not.
    const onlySlow = stillOff.every((k) => k === 'hrv' || k === 'sleep');
    const signals =
      (recovered.length ? ` ${cap(names(recovered))} ${recovered.length > 1 ? 'are' : 'is'} back in your normal range.` : '') +
      (stillOff.length === 0
        ? recovered.length === 0
          ? ' Your signals are back in your normal range.'
          : ''
        : onlySlow
          ? ` ${cap(names(stillOff))} ${stillOff.length > 1 ? 'are' : 'is'} still off, which is common for a week or two after an illness.`
          : ` ${cap(names(stillOff))} ${stillOff.length > 1 ? 'are' : 'is'} still outside your normal range, so keep these days truly easy.`);

    return {
      ...base,
      status: 'returning',
      tone: 'caution',
      headline: stage === 1 ? 'You are recovering. Time to ease back in.' : stage === 2 ? 'Building back up' : past ? 'Nearly there: volume is back, intensity waits' : 'Nearly back to normal',
      body: `Day ${Math.min(dayNo, total)} of ${total} of your return.${signals}`,
      planNote:
        stage === 1
          ? 'Sessions are short and easy (about half volume), with no hard efforts.'
          : stage === 2
            ? 'Sessions are easy at about 75% volume, with no hard efforts yet.'
            : lagging
              ? 'Volume is back to about 90%, but every session stays easy until your HRV recovers.'
              : 'Your normal sessions are back at about 90% volume.',
      actions,
      today:
        stage === 3 && !lagging
          ? ['Do today’s session as planned, at about 90% of the volume.', 'Back off if a hard effort feels much harder than usual.']
          : [
              stage === 1 ? 'Do today’s session short: about half the planned time.' : stage === 2 ? 'Do about three quarters of today’s planned time.' : 'Do close to the full planned time.',
              TALK,
              'Skip anything hard: no intervals, tempo, or long efforts yet.',
              'Stop early if it feels harder than it should. Resting today is also fine.',
            ],
      next:
        stage === 1
          ? `${inDays} the plan steps up to about 75% volume, still easy.`
          : stage === 2
            ? `${inDays} the plan steps up to about 90% volume.`
            : lagging
              ? `Hard sessions return when your HRV is ${hrvGate} for two days.`
              : `${inDays} your full plan is back.`,
      question: 'How are your symptoms today?',
      asks: [
        { action: 'resume', label: 'Gone, and I feel strong: restore my plan' },
        { action: 'sick_mild', label: 'Still a cold: keep it very easy' },
        { action: 'sick_systemic', label: 'Worse: fever, chest, or body aches' },
      ],
      advice: ['A slower return costs days. A relapse costs weeks.'],
      forceEasy: stage < 3 || lagging,
    };
  }

  if (open?.status === 'confirmed') {
    if (open.report === 'systemic') {
      return {
        ...base,
        status: 'ill',
        tone: 'alert',
        headline: 'Rest until your symptoms clear',
        body:
          'With a fever, chest symptoms, or body aches, training slows your recovery and can be unsafe. Your plan shows rest for now, and nothing is lost by taking it.' +
          (a.episode?.phase === 'recovering' ? ' Your signals are improving. When the fever, chest symptoms, and aches are gone, tell us and we will start easing you back in.' : ''),
        today: ['Rest. No training today.', 'Drink plenty and sleep as much as you can.', 'When the fever, chest symptoms, and aches are gone, tap “I’m better”.'],
        next: 'When you tell us you are better, the plan brings you back in three stages, starting short and easy.',
        planNote: 'The next few days are rest days. They update every day until you tell us you are better.',
        actions: [act('ill-systemic', 'unavailable', 0, 3, 'Illness: rest until your symptoms clear', undefined, true)],
        asks: [
          { action: 'better', label: 'I’m better', primary: true },
          { action: 'sick_mild', label: 'It’s only a cold now' },
        ],
        advice: ['See a doctor if symptoms are severe, last more than a few days, or include chest pain or shortness of breath.'],
        forceEasy: true,
      };
    }
    if (open.report === 'mild') {
      return {
        ...base,
        status: 'ill',
        tone: 'alert',
        headline: 'Easy training only while you have a cold',
        body:
          'With symptoms above the neck only, light movement is fine if you feel up to it. Hard sessions wait until you are well.' +
          (a.episode?.phase === 'recovering' ? ' Your signals are improving, so the plan will start stepping back up in a few days.' : ''),
        today: ['If you feel up to it: 20 to 30 minutes, very easy.', TALK, 'Otherwise rest. Neither choice sets you back.'],
        next: 'When your symptoms are gone, tap “I’m better” and the plan steps back up in stages.',
        planNote: 'Sessions are easy at about half volume. Resting instead is always fine.',
        actions: [act('ill-mild', 'recovery_day', 0, 3, 'Cold: easy effort only, half volume', 0.5, true)],
        asks: [
          { action: 'better', label: 'I’m better', primary: true },
          { action: 'sick_systemic', label: 'It got worse (fever, chest, or aches)' },
        ],
        advice: ['Stop and rest if symptoms move to your chest or you develop a fever.'],
        forceEasy: true,
      };
    }
    // Confirmed "just tired".
    return {
      ...base,
      status: open.kind === 'overreaching' ? 'overreaching' : 'under_recovered',
      tone: 'caution',
      headline: 'Backing off so you can absorb the work',
      body: 'You told us you are worn down, and your signals agree. A few easy days now get you back to good training faster than pushing through.',
      planNote: 'Sessions are easy at about 70% volume until your signals return to your normal range.',
      today: ['Do today’s session easy and a little shorter, or rest.', TALK, 'Get to bed early tonight.'],
      next: `The plan returns to normal when your HRV is ${hrvGate} and your resting heart rate is back in range.`,
      actions: [act('tired', 'recovery_day', 0, 3, 'Recovery block: easy effort only', 0.7)],
      asks: [{ action: 'better', label: 'I feel recovered', primary: true }],
      advice: ['Protect your sleep this week. It does more for recovery than anything else you control.'],
      forceEasy: true,
    };
  }

  if (open?.status === 'dismissed') {
    return {
      ...base,
      status: 'watch',
      tone: 'neutral',
      headline: 'Your plan is unchanged',
      body: 'Your signals are still outside your usual range, but you told us you feel fine, so we left your plan alone. Tell us if that changes.',
      asks: [
        { action: 'sick_mild', label: 'I feel ill now' },
        { action: 'tired', label: 'I’m feeling worn down' },
      ],
    };
  }

  if (open?.status === 'suspected') {
    const d = a.episode;
    const span = d?.spanDays ?? diffDays(today, open.startedOn) + 1;
    if (open.kind === 'illness') {
      const markers = (d?.markers.length ?? 0) > 0;
      return {
        ...base,
        status: 'illness_suspected',
        tone: 'alert',
        headline: 'Your body may be fighting something',
        body: markers
          ? `Your signals have been outside your normal range for ${plural(span, 'day')}, including markers that rise with illness and not with training.`
          : `Your signals have been outside your normal range for ${plural(span, 'day')}, and your training load does not explain it.`,
        planNote: `Until this settles, sessions are easy at about ${Math.round(0.6 * 100)}% volume, with no hard efforts.`,
        actions: [act('suspect-illness', 'recovery_day', 0, 2, 'Possible illness: easy effort only until your signals settle', 0.6, true)],
        question: 'Are you feeling ill?',
        asks: ILL_ASKS,
        today: ['Keep any training short and easy today, or rest.', 'Answer the question below so we can set the right plan.'],
        next: 'Your answer decides the plan: rest for a fever or chest symptoms, light training for a cold, or back to normal if you feel fine.',
        forceEasy: true,
      };
    }
    if (open.kind === 'overreaching') {
      const hard = d?.severity === 'high' || span >= 7;
      const ratio = d?.leadInLoadRatio ?? a.load.ratio;
      return {
        ...base,
        status: 'overreaching',
        tone: 'alert',
        headline: 'You are carrying more fatigue than you are absorbing',
        body: `${ratio ? `Your training stepped up to about ${ratio.toFixed(1)}× your usual week, and y` : 'Y'}our recovery signals have been off for ${plural(span, 'day')}. Fitness comes from the work you absorb, so the plan backs off now.`,
        planNote: hard
          ? 'Two rest days, then easy sessions at about 60% volume.'
          : `Sessions are easy, cut by about ${pct(0.8)}, for the next few days.`,
        actions: hard
          ? [act('overreach-rest', 'unavailable', 0, 1, 'Deep fatigue: two rest days'), act('overreach-hard', 'recovery_day', 2, 5, 'Deep fatigue: easy effort only', 0.6)]
          : [act('overreach', 'recovery_day', 0, 3, 'Fatigue building: easy effort only', 0.8)],
        question: 'Does that match how you feel?',
        asks: [
          { action: 'tired', label: 'Yes, I’m worn down' },
          { action: 'sick_mild', label: 'I think I’m ill' },
          { action: 'fine', label: 'No, I feel fine' },
        ],
        advice: hard ? ['If you still feel flat after a week of easy training, take a full rest week and consider seeing a doctor.'] : [],
        today: hard ? ['Rest today.', 'Eat well and get to bed early.'] : ['Do today’s session easy and a little shorter.', TALK, 'No hard efforts until your signals settle.'],
        next: `Hard sessions return when your HRV is ${hrvGate} and your resting heart rate is back in range.`,
        forceEasy: true,
      };
    }
    if (open.kind === 'under_recovered') {
      return {
        ...base,
        status: 'under_recovered',
        tone: 'caution',
        headline: 'You are short on recovery',
        body: `Your signals have been off for ${plural(span, 'day')}, alongside short sleep or a demanding stretch outside training.`,
        planNote: `Sessions are easy, cut by about ${pct(0.85)}, for the next few days.`,
        actions: [act('under-recovered', 'recovery_day', 0, 2, 'Short on recovery: easy effort only', 0.85)],
        question: 'Does that match how you feel?',
        asks: [
          { action: 'tired', label: 'Yes, I’m worn down' },
          { action: 'sick_mild', label: 'I think I’m ill' },
          { action: 'fine', label: 'No, I feel fine' },
        ],
        advice: ['Give yourself a longer sleep window for the next few nights.'],
        today: ['Do today’s session easy and a little shorter.', 'Plan an earlier night.'],
        next: 'The plan returns to normal after two nights back in your normal range.',
        forceEasy: true,
      };
    }
    return {
      ...base,
      status: 'strained',
      tone: 'caution',
      headline: 'Your signals have been off for a couple of days',
      body: 'Nothing explains it yet. It can be the start of an illness, a hard few days, or poor sleep.',
      planNote: 'Today and tomorrow are easy, slightly shortened.',
      actions: [act('strain', 'recovery_day', 0, 1, 'Signals off: easy effort only', 0.85)],
      question: 'How do you feel?',
      asks: ILL_ASKS,
      forceEasy: true,
    };
  }

  // --- No open episode ---
  if (a.stale || a.coverage14 < 5) {
    return {
      ...base,
      status: 'unknown',
      tone: 'neutral',
      headline: a.dataDay ? 'No recent health data' : 'Connect a wearable to track your recovery',
      body: a.dataDay
        ? `Your latest reading is from ${a.dataDay}. We can only spot illness or fatigue early when your wearable syncs.`
        : 'With HRV, resting heart rate, and sleep, we can spot illness and fatigue early and adjust your plan.',
      asks: [{ action: 'sick_mild', label: 'I’m feeling ill' }],
    };
  }
  if (a.latest?.level === 'abnormal' && !a.latest.inEpisode) {
    return {
      ...base,
      status: 'strained',
      tone: 'caution',
      headline: 'Your body is under more strain than usual today',
      body: 'One off day is common after a hard session, a late night, or a drink. If tomorrow looks the same, we will adjust your plan.',
      today: ['Keep today easy. If a hard session is planned, swap it for easy training.', TALK],
      next: 'If tomorrow looks the same, the plan adjusts. If it clears, nothing changes.',
      asks: [{ action: 'sick_mild', label: 'I’m feeling ill' }],
      forceEasy: true,
    };
  }
  const slowOff = coreOff(a);
  if (a.episode || slowOff.length) {
    // No open episode, but HRV or resting HR sits outside the normal range:
    // either the tail of an illness we already walked back from, or one signal
    // drifting alone. Say so; it is not, by itself, a reason to change the plan.
    const ks = slowOff.length ? slowOff : (a.episode?.stillOff ?? []);
    const off = ks.map((k) => VITAL_NAMES[k] ?? k).join(' and ') || 'one of your signals';
    const plural2 = ks.length > 1;
    return {
      ...base,
      status: 'watch',
      tone: 'neutral',
      headline: `Your ${off} ${plural2 ? 'are' : 'is'} outside your normal range`,
      body: `${plural2 ? 'They often take' : 'It often takes'} a week or two to settle after an illness or a hard block. Your plan is unchanged, and we are watching whether other signals follow.`,
      today: ['Train as planned.', 'Back off if a hard effort feels much harder than usual.'],
      next: ks.includes('hrv') ? `This note clears when your HRV is ${hrvGate} again.` : null,
      asks: [{ action: 'sick_mild', label: 'I’m feeling ill' }],
    };
  }
  if (a.latest?.level === 'watch') {
    return {
      ...base,
      status: 'watch',
      tone: 'neutral',
      headline: 'One signal is a little off today',
      body: 'Train as planned and start easy. We are watching whether it continues.',
      asks: [{ action: 'sick_mild', label: 'I’m feeling ill' }],
    };
  }
  if (a.primed) {
    return {
      ...base,
      status: 'primed',
      tone: 'good',
      headline: 'You are absorbing the training well',
      body: 'Your recovery signals have stayed in your normal range for two weeks of steady training. You have room to add a little.',
      asks: [{ action: 'progress', label: 'Add about 6% for the next week', primary: true }],
    };
  }
  return {
    ...base,
    status: 'ready',
    tone: 'good',
    headline: 'Your body is handling the training',
    body: 'Your recovery signals are in your normal range.',
    asks: [{ action: 'sick_mild', label: 'I’m feeling ill' }],
  };
}
