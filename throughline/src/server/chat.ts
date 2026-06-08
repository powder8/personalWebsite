import 'server-only';
/**
 * Athlete-facing "ask about your training" chat. Retrieval-augmented: we inject
 * the athlete's REAL computed data (readiness, plan, fitness anchor, insights)
 * as grounding, and Claude narrates/reasons over it. Low hallucination by
 * design — it explains existing numbers rather than inventing advice.
 */
import Anthropic from '@anthropic-ai/sdk';
import { eq } from 'drizzle-orm';
import type { DB } from '@/db';
import { athletes } from '@/db/schema';
import { getAthletePortal } from '@/server/portal';
import { getTrainingInsights } from '@/server/insights';
import { getAthleteZones, getAthleteVdot } from '@/db/paceConfig';
import { equivalentPerformances, secPerKmToMinPerMile, paceRangeLabel } from '@/engine/plan';

export function chatConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const SYSTEM = `You are Throughline's running assistant, talking directly to an athlete about THEIR training.

Rules:
- Answer using ONLY the athlete data provided below. Cite the specific numbers (paces, mileage, readiness, VDOT) you're basing answers on.
- When asked what to do, explain what their plan / the engine already prescribes and the reasoning behind it. Do NOT invent new prescriptions that contradict their plan or paces.
- Their fitness benchmark is their RECENT training. If they ask about a faster past, note it's a different stage and that current targets use recent data.
- This is coaching guidance, not medical advice. For pain, injury, or medical questions, advise seeing a professional.
- If the data doesn't contain the answer, say so plainly rather than guessing.
- Be concise (a few sentences), specific, and encouraging. Use their first name occasionally. Plain text, no markdown headers.`;

function fmtTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.round(s % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}
const pm = (sec: number | null) => (sec == null ? '—' : `${secPerKmToMinPerMile(sec)}/mi`);
const mi = (m: number | null) => (m == null || m <= 0 ? '—' : (m / 1609.344).toFixed(1));

/** Compose a grounding context string from the athlete's structured data. */
async function buildContext(db: DB, athleteId: string): Promise<string | null> {
  const [athlete] = await db.select().from(athletes).where(eq(athletes.id, athleteId)).limit(1);
  if (!athlete) return null;
  const portal = await getAthletePortal(athleteId);
  if (!portal) return null;
  const insights = await getTrainingInsights(athleteId);
  const vdot = await getAthleteVdot(db, athleteId);
  const zones = await getAthleteZones(db, athleteId);

  const lines: string[] = [];
  lines.push(`Athlete: ${athlete.fullName} (first name ${athlete.fullName.split(' ')[0]}).`);
  if (portal.goalRace.name) {
    lines.push(
      `Goal race: ${portal.goalRace.name}${portal.goalRace.date ? ` on ${portal.goalRace.date}` : ''}${
        portal.goalRace.daysAway != null && portal.goalRace.daysAway >= 0 ? ` (${portal.goalRace.daysAway} days away)` : ''
      }.`,
    );
  }
  lines.push(
    `Today (${portal.today}): readiness ${portal.readiness.band ?? 'n/a'}${
      portal.readiness.score != null ? ` (${portal.readiness.score})` : ''
    }${portal.readiness.sentence ? ` — "${portal.readiness.sentence}"` : ''}.`,
  );
  if (portal.todaySession) {
    const s = portal.todaySession;
    lines.push(
      `Today's session: ${s.sessionType}, ${mi(s.distanceMeters)} mi${
        s.paceFastSecPerKm != null ? ` @ ${pm(s.paceFastSecPerKm)}–${pm(s.paceSlowSecPerKm)}` : ''
      }${s.description ? `. ${s.description}` : ''}.`,
    );
  }
  if (portal.thisWeek?.sessions.length) {
    lines.push(
      'This week: ' +
        portal.thisWeek.sessions
          .map((s) => `${s.day.slice(5)} ${s.sessionType} ${mi(s.distanceMeters)}mi`)
          .join('; ') +
        '.',
    );
  }
  if (vdot != null) {
    const anchorRace = (athlete.paceConfig as { race?: { distanceMeters: number; timeSeconds: number } } | null)?.race ?? null;
    lines.push(`Fitness anchor: VDOT ${Math.round(vdot * 10) / 10} (from RECENT data).`);
    lines.push(
      'Equivalent race times now: ' +
        equivalentPerformances(vdot, undefined, anchorRace).map((e) => `${e.label} ${fmtTime(e.timeSeconds)}`).join(', ') +
        '.',
    );
  }
  if (zones) {
    lines.push(
      'Training paces/mi: ' +
        (['recovery', 'easy', 'marathon', 'threshold', 'interval', 'rep'] as const)
          .map((k) => `${k} ${paceRangeLabel(zones.zones[k])}`)
          .join(', ') +
        '.',
    );
  }
  if (insights) {
    if (insights.recent?.hasData) {
      const r = insights.recent;
      lines.push(
        `Recent training (6 wks): ${r.avgWeeklyMiles} mi/wk, ~${r.easyPct}% easy / ~${r.qualityPct}% quality, ${r.longRuns} long runs.`,
      );
    }
    if (insights.buildProfile) {
      const p = insights.buildProfile;
      lines.push(
        `Most productive recent blocks (the benchmark): ~${p.medianWeeklyMiles} mi/wk, ~${p.medianRunDaysPerWeek} run-days/wk${
          p.medianQualityPerWeek != null ? `, ~${p.medianQualityPerWeek} quality sessions/wk` : ''
        }, long runs in ${p.blocksWithLongRuns}/${p.count} blocks.`,
      );
    }
    if (insights.careerBest) {
      lines.push(
        `Career best (CONTEXT ONLY, possibly a different life stage — not the current target): ~VDOT ${insights.careerBest.vdot} (${insights.careerBest.distanceLabel}, ${insights.careerBest.day}).`,
      );
    }
    if (insights.suggestions.length) {
      lines.push('System-flagged suggestions: ' + insights.suggestions.map((s) => `[${s.basis}] ${s.text}`).join(' '));
    }
  }
  return lines.join('\n');
}

export async function askTrainingQuestion(
  db: DB,
  athleteId: string,
  messages: ChatMessage[],
): Promise<{ reply: string }> {
  if (!chatConfigured()) throw new Error('Chat is not configured (missing ANTHROPIC_API_KEY).');
  const context = await buildContext(db, athleteId);
  if (context == null) throw new Error('Athlete not found.');

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const resp = await client.messages.create({
    // Default to the cheap/fast Haiku tier: this is grounded narration over
    // pre-computed data, not heavy reasoning. Bump ANTHROPIC_MODEL to a Sonnet
    // model if coaching nuance/tone needs it.
    model: process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5',
    max_tokens: 700,
    system: `${SYSTEM}\n\n=== THIS ATHLETE'S DATA (the only facts you may use) ===\n${context}`,
    messages: messages.slice(-12).map((m) => ({ role: m.role, content: m.content })),
  });
  const reply = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  return { reply: reply || "I couldn't generate a response — try rephrasing." };
}
