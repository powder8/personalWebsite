'use client';

import { useState } from 'react';
import Link from 'next/link';
import { secPerKmToMinPerMile } from '@/engine/plan';
import { SESSION_COLOR, SESSION_LABEL } from '@/components/WeekStrip';
import type { CalWeek, CalDay, CalActual } from '@/server/trainingCalendarLogic';

/**
 * Unified planned-vs-actual calendar — the portal centerpiece. Stacked week
 * rows (agenda style, phone-first): each day shows the planned target and what
 * was actually run/cross-trained, with a status glyph. Tap any day to expand the
 * detail + the coach's take inline. Past weeks live behind a collapse so the
 * focus stays on now and ahead.
 */

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const SPORT_ICON: Record<string, string> = {
  bike: '🚴',
  swim: '🏊',
  strength: '💪',
  cross_train: '🔁',
  other: '🤸',
};

function pace(sec: number | null): string {
  return sec == null ? '' : `${secPerKmToMinPerMile(sec)}/mi`;
}
function mi(n: number): string {
  return n <= 0 ? '—' : n >= 10 ? n.toFixed(1) : n.toFixed(1);
}
function dur(sec: number | null): string {
  if (!sec) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
function fmtDate(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}
function dayNum(day: string): number {
  return Number(day.split('-')[2]);
}

/** Status → the small glyph + color shown under each day. */
function statusGlyph(d: CalDay): { mark: string; cls: string; label: string } | null {
  if (d.isFuture) return null;
  switch (d.status) {
    case 'done':
      return { mark: '✓', cls: 'text-emerald-600', label: `${mi(d.primaryRun?.miles ?? 0)} mi` };
    case 'partial':
      return { mark: '◑', cls: 'text-amber-600', label: `${mi(d.primaryRun?.miles ?? 0)} mi` };
    case 'missed':
      return { mark: '✗', cls: 'text-rose-500', label: 'missed' };
    case 'extra':
      return { mark: '＋', cls: 'text-sky-600', label: `${mi(d.primaryRun?.miles ?? 0)} mi` };
    case 'cross':
      return { mark: SPORT_ICON[d.crossTrain[0]?.sport] ?? '🔁', cls: '', label: 'XT' };
    default:
      return null; // rest with nothing logged
  }
}

export function TrainingCalendar({
  weeks,
  today,
  athleteId,
}: {
  weeks: CalWeek[];
  today: string;
  athleteId: string;
}) {
  const [expanded, setExpanded] = useState<string | null>(today);

  const currentIdx = weeks.findIndex((w) => w.isCurrent);
  const splitAt = currentIdx >= 0 ? currentIdx : 0;
  const past = weeks.slice(0, splitAt);
  const nowAndAhead = weeks.slice(splitAt);

  const toggle = (day: string) => setExpanded((cur) => (cur === day ? null : day));

  return (
    <div className="space-y-3">
      {past.length > 0 && (
        <details className="rounded-xl bg-slate-50">
          <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-slate-500">
            ◂ Previous weeks <span className="font-normal text-slate-400">· {past.length}</span>
          </summary>
          <div className="space-y-3 px-1 pb-2 pt-1">
            {past.map((w) => (
              <Week key={w.weekStart} week={w} today={today} expanded={expanded} toggle={toggle} athleteId={athleteId} />
            ))}
          </div>
        </details>
      )}
      {nowAndAhead.map((w) => (
        <Week key={w.weekStart} week={w} today={today} expanded={expanded} toggle={toggle} athleteId={athleteId} />
      ))}

      <div className="flex flex-wrap gap-x-4 gap-y-1 px-1 pt-1 text-[11px] text-slate-400">
        <span><span className="text-emerald-600">✓</span> hit</span>
        <span><span className="text-amber-600">◑</span> short</span>
        <span><span className="text-rose-500">✗</span> missed</span>
        <span><span className="text-sky-600">＋</span> extra</span>
        <span>🔁 cross-train</span>
      </div>
    </div>
  );
}

function Week({
  week,
  today,
  expanded,
  toggle,
  athleteId,
}: {
  week: CalWeek;
  today: string;
  expanded: string | null;
  toggle: (day: string) => void;
  athleteId: string;
}) {
  const expandedDay = week.days.find((d) => d.day === expanded) ?? null;
  return (
    <div className={`rounded-2xl p-3 ${week.isCurrent ? 'bg-sky-400/5 ring-1 ring-inset ring-sky-400/30' : 'bg-card'}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs font-semibold text-slate-600">
          {week.isCurrent ? 'This week' : `Week of ${MONTHS[Number(week.weekStart.split('-')[1]) - 1]} ${dayNum(week.weekStart)}`}
          {week.phase && <span className="ml-1.5 font-normal capitalize text-slate-400">· {week.phase}</span>}
        </div>
        <div className="flex items-center gap-2 text-[11px] tabular-nums text-slate-500">
          <span>
            {mi(week.actualMiles)}<span className="text-slate-500">/</span>{mi(week.plannedMiles)} mi
          </span>
          {week.adherencePct != null && (
            <span
              className={`rounded-full px-1.5 py-0.5 font-semibold ${
                week.adherencePct >= 80
                  ? 'bg-emerald-400/15 text-emerald-600'
                  : week.adherencePct >= 50
                    ? 'bg-amber-400/15 text-amber-600'
                    : 'bg-rose-400/15 text-rose-600'
              }`}
            >
              {week.adherencePct}%
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {week.days.map((d) => (
          <DayCell key={d.day} d={d} selected={d.day === expanded} onClick={() => toggle(d.day)} />
        ))}
      </div>

      {expandedDay && <DayDetail d={expandedDay} athleteId={athleteId} />}
    </div>
  );
}

function DayCell({ d, selected, onClick }: { d: CalDay; selected: boolean; onClick: () => void }) {
  const plannedType = d.planned?.sessionType ?? null;
  const plannedRun = plannedType && plannedType !== 'rest' && (d.planned?.miles ?? 0) > 0;
  const glyph = statusGlyph(d);
  const empty = !plannedRun && d.actuals.length === 0;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={empty && !d.isToday}
      className={`flex min-h-[68px] flex-col items-center gap-1 rounded-xl px-1 py-1.5 text-center transition ${
        selected
          ? 'bg-slate-900 text-white shadow-md'
          : d.isToday
            ? 'bg-lime-300 text-[#0c1018]'
            : empty
              ? 'bg-slate-50 text-slate-400'
              : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
      }`}
    >
      <span className={`text-[9px] font-bold uppercase ${selected ? 'text-white/50' : d.isToday ? 'text-[#0c1018]/50' : 'text-slate-400'}`}>
        {DOW[d.dow]} {dayNum(d.day)}
      </span>
      {/* Planned target */}
      {plannedRun ? (
        <>
          <span className={`h-1.5 w-1.5 rounded-full ${SESSION_COLOR[plannedType!] ?? 'bg-slate-300'}`} />
          <span className="text-[10px] font-semibold leading-none tabular-nums">{mi(d.planned!.miles)}</span>
        </>
      ) : plannedType === 'rest' ? (
        <span className={`text-[9px] ${selected ? 'text-white/40' : 'text-slate-500'}`}>rest</span>
      ) : (
        <span className="text-[9px] text-transparent">·</span>
      )}
      {/* Actual outcome */}
      {glyph ? (
        <span className={`text-[11px] font-bold leading-none ${selected ? 'text-white' : glyph.cls}`}>{glyph.mark}</span>
      ) : (
        <span className="text-[11px] leading-none text-transparent">·</span>
      )}
    </button>
  );
}

function DayDetail({ d, athleteId }: { d: CalDay; athleteId: string }) {
  return (
    <div className="mt-2 space-y-2 rounded-xl bg-slate-50 p-3 text-sm">
      <div className="text-xs font-semibold text-slate-500">{fmtDate(d.day)}</div>

      {/* Planned */}
      {d.planned && d.planned.sessionType !== 'rest' && d.planned.miles > 0 ? (
        <div>
          <div className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${SESSION_COLOR[d.planned.sessionType] ?? 'bg-slate-300'}`} />
            <span className="font-medium text-slate-700">
              Planned: {SESSION_LABEL[d.planned.sessionType] ?? d.planned.sessionType} · {mi(d.planned.miles)} mi
            </span>
            {d.planned.paceFastSecPerKm != null && (
              <span className="text-xs tabular-nums text-slate-400">
                {pace(d.planned.paceFastSecPerKm)}–{pace(d.planned.paceSlowSecPerKm)}
              </span>
            )}
          </div>
          {d.planned.adjustments.length > 0 && (
            <div className="mt-1 inline-block rounded bg-amber-400/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-600">
              {d.planned.adjustments.join('; ')}
            </div>
          )}
          {d.planned.description && <p className="mt-0.5 text-xs text-slate-500">{d.planned.description}</p>}
        </div>
      ) : d.planned?.sessionType === 'rest' && d.actuals.length === 0 ? (
        <p className="text-slate-500">Rest day — nothing scheduled.</p>
      ) : null}

      {/* Multi-run day: one session logged as several activities */}
      {d.actuals.filter((a) => a.isRun).length > 1 && (
        <p className="text-xs font-medium text-slate-500">
          {d.actuals.filter((a) => a.isRun).length} runs · {mi(d.actuals.filter((a) => a.isRun).reduce((s, a) => s + a.miles, 0))} mi
          total — coach’s take is on your main effort.
        </p>
      )}

      {/* Actual runs — main effort first */}
      {d.primaryRun && <ActualLine a={d.primaryRun} athleteId={athleteId} primary={d.actuals.filter((a) => a.isRun).length > 1} />}
      {d.actuals.filter((a) => a.isRun && a !== d.primaryRun).map((a) => (
        <ActualLine key={a.activityId} a={a} athleteId={athleteId} />
      ))}

      {/* Coach's take for the run */}
      {d.verdict && (
        <div
          className={`rounded-lg p-2 text-xs ${
            d.verdict.positive ? 'bg-emerald-400/10 text-emerald-800' : 'bg-amber-400/10 text-amber-800'
          }`}
        >
          <div className="font-semibold">{d.verdict.headline}</div>
          <p className="mt-0.5 leading-snug">{d.verdict.detail}</p>
        </div>
      )}

      {/* Cross-training (supporting context) */}
      {d.crossTrain.map((a) => (
        <div key={a.activityId} className="flex items-center gap-2 text-xs text-slate-600">
          <span>{SPORT_ICON[a.sport] ?? '🔁'}</span>
          <span className="font-medium capitalize">{a.sport.replace('_', ' ')}</span>
          {a.name && <span className="text-slate-400">· {a.name}</span>}
          {a.durationSeconds ? <span className="tabular-nums text-slate-400">· {dur(a.durationSeconds)}</span> : null}
          {a.miles > 0 && <span className="tabular-nums text-slate-400">· {mi(a.miles)} mi</span>}
        </div>
      ))}
      {d.crossTrain.length > 0 && d.status !== 'missed' && (
        <p className="text-[11px] text-slate-400">Cross-training counts — it builds aerobic fitness without the pounding.</p>
      )}

      {/* Today, still to do */}
      {d.isToday && d.status === 'upcoming' && d.planned && d.planned.miles > 0 && (
        <p className="text-xs font-medium text-sky-700">Still on today’s plan — go get it. 🏃</p>
      )}

      {/* Missed-but-cross-trained reassurance */}
      {d.status === 'missed' && d.crossTrain.length > 0 && (
        <p className="text-[11px] text-slate-400">Run was missed, but you still moved — that’s a win on a tough day.</p>
      )}
      {d.status === 'missed' && d.crossTrain.length === 0 && (
        <p className="text-xs text-slate-500">No run logged. One missed day won’t derail you — roll into the next session.</p>
      )}
    </div>
  );
}

function ActualLine({ a, athleteId, primary }: { a: CalActual; athleteId: string; primary?: boolean }) {
  return (
    <Link
      href={`/me/${athleteId}/runs/${a.activityId}`}
      className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg bg-card px-2 py-1.5 text-xs ring-1 ring-inset ring-slate-200 transition hover:ring-slate-300"
    >
      <span className="font-semibold text-slate-700">
        {a.workoutType === 1 ? '🏁' : '🏃'} {mi(a.miles)} mi
      </span>
      {primary && (
        <span className="rounded bg-violet-400/15 px-1 text-[10px] font-medium text-violet-500">
          {a.workoutType === 1 ? 'race' : 'main'}
        </span>
      )}
      {a.paceSecPerKm != null && <span className="tabular-nums text-slate-500">{pace(a.paceSecPerKm)}</span>}
      {a.durationSeconds ? <span className="tabular-nums text-slate-400">{dur(a.durationSeconds)}</span> : null}
      {a.elevationGainMeters != null && a.elevationGainMeters > 0 && (
        <span className="text-slate-400">↑{Math.round(a.elevationGainMeters * 3.281)} ft</span>
      )}
      {a.surface === 'trail' && <span className="text-emerald-600">trail</span>}
      {a.avgHr != null && <span className="text-slate-400">{a.avgHr} bpm</span>}
      <span className="ml-auto text-sky-500">details →</span>
    </Link>
  );
}
