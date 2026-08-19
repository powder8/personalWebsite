/**
 * Presentational Health page — pure server component, no client JS. Renders the
 * HealthSnapshot from server/health.ts across four owner-chosen metrics: VDOT
 * health score, cardio fitness (VO2max), recovery, and sleep & body.
 *
 * Design: matches the portal's dark gradient cards. Body copy is text-white/80
 * (the slate scale is inverted in this app). Charts are inline SVG meters —
 * single-hue sequential fills with a direct-labelled marker (a percentile is a
 * magnitude on a fixed 0-100 scale), never a categorical palette.
 */
import type { HealthSnapshot } from '@/server/health';
import { ordinal } from '@/server/healthLogic';
import { RecoveryCard } from '@/components/RecoveryCard';

const STATUS_TEXT = {
  good: 'text-emerald-300',
  watch: 'text-amber-300',
  low: 'text-rose-300',
} as const;

const CATEGORY_TEXT: Record<string, string> = {
  Superior: 'text-emerald-300',
  Excellent: 'text-emerald-300',
  Good: 'text-sky-300',
  Fair: 'text-amber-300',
  Poor: 'text-rose-300',
  'Very Poor': 'text-rose-300',
};

/** Horizontal percentile meter: sequential sky fill + a labelled marker. */
function PercentileMeter({ pct }: { pct: number }) {
  const clamped = Math.max(1, Math.min(99, pct));
  return (
    <div className="mt-1">
      <div className="relative h-3 w-full rounded-full bg-white/10">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-sky-500/70 to-sky-400"
          style={{ width: `${clamped}%` }}
        />
        <div
          className="absolute top-1/2 h-5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow"
          style={{ left: `${clamped}%` }}
          aria-hidden
        />
      </div>
      <div className="mt-1 flex justify-between text-[9px] font-medium uppercase tracking-wide text-slate-500">
        <span>Below average</span>
        <span>Median</span>
        <span>Elite</span>
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  unit,
  sub,
  valueClass = 'text-white',
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-2xl bg-white/5 p-3 ring-1 ring-inset ring-white/10">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className={`text-xl font-bold tabular-nums ${valueClass}`}>{value}</span>
        {unit && <span className="text-[11px] text-slate-400">{unit}</span>}
      </div>
      {sub && <div className="mt-0.5 text-[10px] text-slate-500">{sub}</div>}
    </div>
  );
}

function GradientCard({ children, title, aside }: { children: React.ReactNode; title: string; aside?: string }) {
  return (
    <section className="rounded-3xl bg-gradient-to-br from-[#141b2e] via-[#10141f] to-indigo-950 p-5 shadow-lg">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold tracking-tight text-white">{title}</h2>
        {aside && <span className="text-[11px] text-slate-500">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

/** Metric 1 + 2: VDOT health score and cardio fitness (VO2max), same physiology. */
function CardioCard({ snapshot }: { snapshot: HealthSnapshot }) {
  const { cardio, age, sex } = snapshot;
  if (cardio.vdot == null) {
    return (
      <GradientCard title="Cardio fitness">
        <p className="mt-2 text-sm leading-relaxed text-white/80">
          Set a recent race result or fitness anchor and we&apos;ll surface your VDOT as a VO2max-based fitness
          score, with an age/sex percentile and a fitness age.
        </p>
      </GradientCard>
    );
  }

  const canRank = cardio.percentile != null;
  const fitnessAgeDelta = cardio.fitnessAge != null && age != null ? age - cardio.fitnessAge : null;

  return (
    <GradientCard title="Cardio fitness. VDOT &amp; VO2max">
      <div className="mt-3 grid grid-cols-3 gap-2">
        <StatTile label="VDOT" value={`${cardio.vdot}`} sub="fitness score" valueClass="text-sky-300" />
        <StatTile
          label="Est. VO2max"
          value={cardio.vo2max != null ? `${cardio.vo2max}` : '-'}
          unit="ml/kg/min"
          sub="from VDOT"
        />
        <StatTile
          label="Fitness age"
          value={cardio.fitnessAge != null ? `${cardio.fitnessAge}` : '-'}
          unit={cardio.fitnessAge != null ? 'yrs' : undefined}
          sub={
            fitnessAgeDelta != null
              ? fitnessAgeDelta > 0
                ? `${fitnessAgeDelta} yrs younger`
                : fitnessAgeDelta < 0
                  ? `${-fitnessAgeDelta} yrs older`
                  : 'on par with age'
              : 'add birth date'
          }
          valueClass={
            fitnessAgeDelta != null ? (fitnessAgeDelta >= 0 ? 'text-emerald-300' : 'text-amber-300') : 'text-white'
          }
        />
      </div>

      {canRank ? (
        <div className="mt-4">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-white/80">
              <span className="font-bold text-white">{ordinal(cardio.percentile!)} percentile</span> for{' '}
              {sex === 'female' ? 'women' : 'men'} aged {age}
            </span>
            {cardio.category && (
              <span className={`text-xs font-semibold ${CATEGORY_TEXT[cardio.category] ?? 'text-white'}`}>
                {cardio.category}
              </span>
            )}
          </div>
          <PercentileMeter pct={cardio.percentile!} />
        </div>
      ) : (
        <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
          Add your date of birth and sex in settings to unlock the age/sex percentile and fitness age.
        </p>
      )}

      <p className="mt-4 text-[10px] leading-relaxed text-slate-500">
        VDOT is a performance-derived VO2max proxy (Daniels&apos; Running Formula); the percentile compares it to the
        FRIEND registry treadmill standards (Kaminsky et al., Mayo Clin Proc 2015). Estimated from your running, not
        a lab or device measurement.
      </p>
    </GradientCard>
  );
}

/** Metric 3 addendum: resting-HR population context beside the baseline read. */
function RestingHrContextRow({ snapshot }: { snapshot: HealthSnapshot }) {
  const ctx = snapshot.restingHrContext;
  const rhr = snapshot.recovery.restingHr;
  if (!ctx || rhr == null) return null;
  const tone =
    ctx.band === 'athlete' || ctx.band === 'excellent'
      ? 'text-emerald-300'
      : ctx.band === 'good'
        ? 'text-sky-300'
        : ctx.band === 'average'
          ? 'text-amber-300'
          : 'text-rose-300';
  return (
    <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
      Your resting HR of <span className="font-semibold text-white/80">{rhr} bpm</span> sits in the{' '}
      <span className={`font-semibold ${tone}`}>{ctx.label.toLowerCase()}</span> vs the general population (AHA:
      normal 60-100; trained endurance athletes 40-60). Day-to-day change is read against your own baseline above.
    </p>
  );
}

/** Metric 4a: sleep duration & consistency vs the adult guideline. */
function SleepCard({ snapshot }: { snapshot: HealthSnapshot }) {
  const { sleep } = snapshot;
  if (sleep.avgHours == null) {
    return (
      <GradientCard title="Sleep">
        <p className="mt-2 text-sm leading-relaxed text-white/80">
          Connect a watch that tracks sleep and we&apos;ll show your nightly duration and consistency against the
          7-9 hour adult guideline.
        </p>
      </GradientCard>
    );
  }
  const a = sleep.assessment;
  const statusClass = a ? STATUS_TEXT[a.status] : 'text-white';
  return (
    <GradientCard title="Sleep" aside={`${sleep.nights}-night avg`}>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <StatTile label="Avg / night" value={`${sleep.avgHours}`} unit="h" valueClass={statusClass} />
        <StatTile
          label="Consistency"
          value={sleep.stdHours != null ? `±${sleep.stdHours}` : '-'}
          unit={sleep.stdHours != null ? 'h' : undefined}
          sub={a?.consistency ?? undefined}
        />
        <StatTile label="Last night" value={sleep.latestHours != null ? `${sleep.latestHours}` : '-'} unit="h" />
      </div>
      {a && (
        <p className={`mt-3 text-sm font-medium ${statusClass}`}>
          {a.label}
          {a.consistency === 'variable' && (
            <span className="font-normal text-white/70"> · schedule swings night to night</span>
          )}
        </p>
      )}
      <p className="mt-3 text-[10px] leading-relaxed text-slate-500">
        Guideline: National Sleep Foundation / CDC recommend 7-9 h for adults; a steadier schedule is linked to
        better recovery and health outcomes.
      </p>
    </GradientCard>
  );
}

/** Metric 4b: body / BMI — persistence DEFERRED in v1, shown as a clear stub. */
function BodyCard() {
  return (
    <GradientCard title="Body composition" aside="coming soon">
      <p className="mt-2 text-sm leading-relaxed text-white/80">
        Weight and BMI trend will live here. Logging isn&apos;t wired up yet, this is a placeholder while we add
        weight entry.
      </p>
      <div className="mt-3 grid grid-cols-3 gap-2 opacity-50">
        <StatTile label="Weight" value="-" unit="kg" />
        <StatTile label="BMI" value="-" />
        <StatTile label="Trend" value="-" />
      </div>
      <p className="mt-3 text-[10px] leading-relaxed text-slate-500">
        BMI is a population screen (WHO bands) that doesn&apos;t separate muscle from fat, so it reads high for many
        trained athletes, we&apos;ll surface it with that caveat once entry lands.
      </p>
    </GradientCard>
  );
}

const SPORT_LABEL: Record<string, string> = {
  run: 'Running',
  bike: 'Cycling',
  swim: 'Swimming',
  strength: 'Strength',
  cross_train: 'Cross-training',
  other: 'Other',
};

export function HealthView({ snapshot }: { snapshot: HealthSnapshot }) {
  const totalActs = snapshot.sports.reduce((a, s) => a + s.count, 0);
  return (
    <div className="space-y-4">
      {snapshot.sports.length > 0 && (
        <p className="px-1 text-xs text-slate-400">
          Last 90 days: {totalActs} {totalActs === 1 ? 'activity' : 'activities'} ·{' '}
          {snapshot.sports.map((s) => `${SPORT_LABEL[s.sport] ?? s.sport} ${s.count}`).join(' · ')}
        </p>
      )}

      <CardioCard snapshot={snapshot} />

      {/* Recovery, reuse the portal's card, then add the population context. */}
      {snapshot.hasWearable ? (
        <div>
          <RecoveryCard snapshot={snapshot.recovery} readiness={snapshot.readiness} />
          <RestingHrContextRow snapshot={snapshot} />
        </div>
      ) : (
        <GradientCard title="Recovery">
          <p className="mt-2 text-sm leading-relaxed text-white/80">
            Connect a wearable (Whoop) and we&apos;ll track HRV, resting heart rate, and sleep against both your own
            baseline and age-group norms.
          </p>
        </GradientCard>
      )}

      <SleepCard snapshot={snapshot} />
      <BodyCard />
    </div>
  );
}
