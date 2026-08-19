/**
 * Analytics — role-aware.
 *  - ADMIN sees the whole website: growth/signups, all engagement, and the
 *    site-wide product-feedback queue.
 *  - A COACH sees the same training/engagement/readiness metrics but scoped to
 *    only the athletes assigned to them; the site-wide business numbers and
 *    product feedback are hidden. Scope is enforced server-side in
 *    getAdminAnalytics — a coach never receives another coach's athlete data.
 *
 * Color rationale (validated via the dataviz palette checker):
 *  - signups columns: single hue (sky-400, 8.2:1 on card) — magnitude, not identity
 *  - phase bars: ordinal indigo ramp base→build→peak→taper (monotone lightness)
 *  - session mix: single-hue bars; the app's canonical SESSION_COLOR dot beside
 *    each label carries identity, so color never encodes the value
 *  - readiness: the app's reserved status colors via BandBadge
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@/db';
import { todayISO } from '@/server/console';
import { getAdminAnalytics, type AdminAnalytics, type AnalyticsScope } from '@/server/adminAnalytics';
import { consoleViewer, visibleAthleteIds } from '@/server/access';
import { Card, BandBadge } from '@/components/ui';
import { SESSION_COLOR, SESSION_LABEL } from '@/components/WeekStrip';
import type { Band } from '@/server/console';

export const dynamic = 'force-dynamic';

export default async function AnalyticsPage() {
  const viewer = await consoleViewer();
  if (!viewer) notFound();

  const db = await getDb();
  const today = todayISO();
  const scope: AnalyticsScope =
    viewer.kind === 'admin'
      ? { kind: 'site' }
      : { kind: 'coach', athleteIds: (await visibleAthleteIds(db, viewer)) ?? new Set() };
  const a = await getAdminAnalytics(db, today, scope);
  const isSite = a.scope === 'site';

  return (
    <div className="space-y-5">
      <div>
        <Link href="/coach" className="text-sm text-sky-300 hover:underline">
          ← Roster
        </Link>
        <div className="mt-1 flex items-baseline justify-between">
          <h1 className="text-lg font-semibold text-slate-900">{isSite ? 'Analytics' : 'Your athletes'}</h1>
          <span className="text-sm text-slate-500">
            {isSite ? 'Whole website' : 'Your roster only'} · {today}
          </span>
        </div>
      </div>

      {/* ── GROWTH (admin) / YOUR ATHLETES (coach) ─────────────────────── */}
      <SectionHeader>{isSite ? 'Growth' : 'Your athletes'}</SectionHeader>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label={isSite ? 'Active athletes' : 'Athletes'} value={a.growth.activeAthletes} />
        {isSite && <StatTile label="Signed-up accounts" value={a.growth.signedUpUsers} />}
        <StatTile label="Onboarded" value={a.growth.onboarded} />
        <StatTile
          label="Coaching mode"
          value={`${a.growth.assisted} / ${a.growth.autonomous}`}
          sublabel="coach-guided / autonomous"
        />
      </div>
      {isSite && (
        <Card title="Athlete signups · last 12 weeks">
          <SignupChart weeks={a.growth.athleteSignupsByWeek} />
        </Card>
      )}

      {/* ── ENGAGEMENT ─────────────────────────────────────────────────── */}
      <SectionHeader>Engagement</SectionHeader>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Trained this week" value={a.engagement.activeAthletes7d} sublabel="athletes with a logged activity" />
        <StatTile label="Runs · 28d" value={a.engagement.runs28d} />
        <StatTile label="Miles · 28d" value={a.engagement.miles28d.toLocaleString()} />
        <StatTile label="Check-ins · 7d" value={a.engagement.checkIns7d} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <StatTile label="Strava connected" value={a.engagement.stravaConnected} />
        <StatTile label="Whoop connected" value={a.engagement.whoopConnected} />
      </div>

      {/* ── TRAINING ───────────────────────────────────────────────────── */}
      <SectionHeader>Training</SectionHeader>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile label="Live plans" value={a.training.athletesWithLivePlan} sublabel="athletes with a current plan" />
        <StatTile label="Planned miles · next 7d" value={a.training.plannedMiles7d.toLocaleString()} />
        <StatTile
          label="Readiness today"
          value={a.readinessToday.reduce((s, r) => s + r.count, 0)}
          sublabel="athletes assessed"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Card title="Current training phase">
          {a.training.phaseMix.length > 0 ? (
            <PhaseBars mix={a.training.phaseMix} />
          ) : (
            <Empty>No current-week plans yet.</Empty>
          )}
        </Card>
        <Card title="Planned sessions · next 7 days">
          {a.training.sessionMix7d.length > 0 ? (
            <SessionBars mix={a.training.sessionMix7d} />
          ) : (
            <Empty>Nothing scheduled in the next 7 days.</Empty>
          )}
        </Card>
      </div>
      {a.readinessToday.length > 0 && (
        <Card title="Readiness today">
          <div className="flex flex-wrap items-center gap-4">
            {a.readinessToday.map((r) => (
              <span key={r.key} className="flex items-center gap-2">
                <BandBadge band={r.key as Band} />
                <span className="text-sm font-semibold tabular-nums text-slate-700">{r.count}</span>
              </span>
            ))}
          </div>
        </Card>
      )}

      {/* ── GOALS ──────────────────────────────────────────────────────── */}
      <SectionHeader>Goals</SectionHeader>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile label="Goal races set" value={a.goals.withGoalRace} />
        <StatTile
          label="With a target time"
          value={a.goals.withTargetTime}
          sublabel={a.goals.withGoalRace > 0 ? `of ${a.goals.withGoalRace}, target unlocks the on-pace verdict` : undefined}
        />
        <StatTile
          label="Most common distance"
          value={a.goals.distanceMix[0]?.key ?? '-'}
          sublabel={a.goals.distanceMix[0] ? `${a.goals.distanceMix[0].count} athlete${a.goals.distanceMix[0].count === 1 ? '' : 's'}` : undefined}
        />
      </div>
      {a.goals.distanceMix.length > 0 && (
        <Card title="Goal distances">
          <HBarList rows={a.goals.distanceMix.map((d) => ({ label: d.key, count: d.count }))} />
        </Card>
      )}

      {/* ── ESCALATIONS (both) + FEEDBACK (admin) ──────────────────────── */}
      <SectionHeader>{isSite ? 'Feedback & escalations' : 'Escalations'}</SectionHeader>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {isSite && <StatTile label="Open feedback" value={a.feedback.open} />}
        {isSite && <StatTile label="Addressed" value={a.feedback.addressed} />}
        <StatTile label="Open escalations" value={a.escalations.open} />
      </div>
      {a.escalations.byKind.length > 0 && (
        <Card title="Open escalations by kind">
          <div className="flex flex-wrap gap-2">
            {a.escalations.byKind.map((k) => (
              <span
                key={k.key}
                className="inline-flex items-center gap-1.5 rounded-full bg-rose-400/10 px-2.5 py-1 text-xs font-medium text-rose-300 ring-1 ring-inset ring-rose-400/30"
              >
                {k.key.replaceAll('_', ' ')}
                <span className="tabular-nums opacity-70">· {k.count}</span>
              </span>
            ))}
          </div>
        </Card>
      )}
      {isSite && (
        <Card
          title="Recent feedback"
          action={
            <Link href="/feedback" className="text-xs font-medium text-sky-300 hover:underline">
              All feedback →
            </Link>
          }
        >
          {a.feedback.recent.length > 0 ? (
            <ul className="divide-y divide-slate-100">
              {a.feedback.recent.map((f, i) => (
                <li key={i} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                  <span
                    className={`mt-1 h-2 w-2 shrink-0 rounded-full ${f.status === 'open' ? 'bg-amber-400' : 'bg-emerald-400'}`}
                    title={f.status}
                  />
                  <div className="min-w-0">
                    <p className="text-sm leading-snug text-slate-700">{f.body}</p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {f.author}
                      {f.category ? ` · ${f.category}` : ''} · {f.createdAt}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No feedback yet.</Empty>
          )}
        </Card>
      )}
    </div>
  );
}

// ── Presentational helpers ───────────────────────────────────────────────────

function SectionHeader({ children }: { children: React.ReactNode }) {
  return <h2 className="px-1 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{children}</h2>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-slate-400">{children}</p>;
}

function StatTile({ label, value, sublabel }: { label: string; value: number | string; sublabel?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200/70 bg-card p-4">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
      {sublabel && <div className="mt-0.5 text-[11px] leading-snug text-slate-400">{sublabel}</div>}
    </div>
  );
}

/** Signups column chart — single hue (magnitude), 12 Monday-anchored weeks. */
function SignupChart({ weeks }: { weeks: AdminAnalytics['growth']['athleteSignupsByWeek'] }) {
  const W = 640;
  const H = 150;
  const PAD_T = 14; // headroom for the direct label on the tallest column
  const PAD_B = 18;
  const PAD_L = 8;
  const PAD_R = 8;
  const n = weeks.length;
  const max = Math.max(...weeks.map((w) => w.count), 1);
  const plotH = H - PAD_T - PAD_B;
  const slot = (W - PAD_L - PAD_R) / n;
  const barW = Math.min(24, slot * 0.6);
  const y = (v: number) => H - PAD_B - (v / max) * plotH;
  const maxIdx = weeks.findIndex((w) => w.count === max);
  const fmt = (weekStart: string) => {
    const [, m, d] = weekStart.split('-');
    return `${Number(m)}/${Number(d)}`;
  };

  const total = weeks.reduce((s, w) => s + w.count, 0);
  if (total === 0) {
    return <Empty>No athlete signups in the last 12 weeks.</Empty>;
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Athlete signups per week, last 12 weeks">
      <line x1={PAD_L} x2={W - PAD_R} y1={H - PAD_B} y2={H - PAD_B} stroke="#26304a" strokeWidth={1} />
      {weeks.map((w, i) => {
        const cx = PAD_L + i * slot + slot / 2;
        const x = cx - barW / 2;
        const top = y(w.count);
        const label = i === maxIdx || i === n - 1;
        return (
          <g key={w.weekStart}>
            {w.count > 0 && (
              // 4px rounded data-end, square at the baseline.
              <path
                d={`M ${x} ${H - PAD_B} V ${top + 4} Q ${x} ${top} ${x + 4} ${top} H ${x + barW - 4} Q ${x + barW} ${top} ${x + barW} ${top + 4} V ${H - PAD_B} Z`}
                fill="#38bdf8"
              >
                <title>{`Week of ${fmt(w.weekStart)}: ${w.count} signup${w.count === 1 ? '' : 's'}`}</title>
              </path>
            )}
            {label && w.count > 0 && (
              <text x={cx} y={top - 4} textAnchor="middle" fontSize={10} className="fill-slate-600 font-semibold">
                {w.count}
              </text>
            )}
            <text x={cx} y={H - 5} textAnchor="middle" fontSize={9} className="fill-slate-400">
              {fmt(w.weekStart)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Ordinal phase bars — one hue, light→dark in phase order (validated ramp). */
const PHASE_ORDER = ['base', 'build', 'peak', 'taper'];
const PHASE_RAMP: Record<string, string> = {
  base: '#a5b4fc',
  build: '#818cf8',
  peak: '#6366f1',
  taper: '#4f46e5',
};

function PhaseBars({ mix }: { mix: { key: string; count: number }[] }) {
  const ordered = [...mix].sort((a, b) => PHASE_ORDER.indexOf(a.key) - PHASE_ORDER.indexOf(b.key));
  return (
    <HBarList
      rows={ordered.map((p) => ({ label: p.key, count: p.count, color: PHASE_RAMP[p.key] ?? '#818cf8' }))}
    />
  );
}

/** Session mix — single-hue bars; the canonical session color dot carries identity. */
function SessionBars({ mix }: { mix: { key: string; count: number }[] }) {
  return (
    <HBarList
      rows={mix.map((s) => ({
        label: SESSION_LABEL[s.key] ?? s.key,
        count: s.count,
        dotClass: SESSION_COLOR[s.key] ?? 'bg-slate-400',
      }))}
    />
  );
}

/** Horizontal bar list: label · thin bar · count at the tip. */
function HBarList({ rows }: { rows: { label: string; count: number; color?: string; dotClass?: string }[] }) {
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.label} className="flex items-center gap-2">
          <span className="flex w-28 shrink-0 items-center gap-1.5 text-xs capitalize text-slate-600">
            {r.dotClass && <span className={`h-2 w-2 shrink-0 rounded-full ${r.dotClass}`} />}
            <span className="truncate">{r.label}</span>
          </span>
          <span className="relative h-3 flex-1">
            <span
              className="absolute inset-y-0 left-0 rounded-r-[4px]"
              style={{ width: `${(r.count / max) * 100}%`, backgroundColor: r.color ?? '#38bdf8' }}
              title={`${r.label}: ${r.count}`}
            />
          </span>
          <span className="w-8 shrink-0 text-right text-xs font-semibold tabular-nums text-slate-700">{r.count}</span>
        </li>
      ))}
    </ul>
  );
}
