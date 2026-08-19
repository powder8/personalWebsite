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
import { getAdaptationState } from '@/server/adaptation';
import { getAthleteZones, getAthleteVdot } from '@/db/paceConfig';
import { equivalentPerformances, secPerKmToMinPerMile, paceRangeLabel } from '@/engine/plan';
import { CHAT_TOOLS, executeChatTool, type ChatActor, type ActionTaken } from '@/server/chatTools';

export function chatConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

function systemPrompt(audience: 'coach' | 'athlete'): string {
  const who =
    audience === 'coach'
      ? "You are talking to the COACH about one of their athletes. Refer to the athlete by name."
      : "You are talking directly to the ATHLETE about THEIR training. Use their first name occasionally.";
  return `You are Throughline's running assistant. ${who}

Answering:
- Answer using ONLY the athlete data provided below. Cite the specific numbers (paces, mileage, readiness, VDOT) you're basing answers on.
- When asked what to do, explain what the plan / engine already prescribes and the reasoning. Don't invent prescriptions that contradict their plan or paces.
- The fitness benchmark is RECENT training. If asked about a faster past, note it's a different stage and that current targets use recent data.
- This is coaching guidance, not medical advice. For pain, injury, or medical questions, advise seeing a professional.
- If they've missed sessions or fallen behind: be warm and encouraging, never guilt-trip. NEVER tell them to "make up" missed miles by stacking them, that causes injury and quitting. A missed day is forgiven; after a real layoff, ease back in (lighter for a few days) rather than cramming. Calendar dates don't move.
- If the data doesn't contain the answer, say so plainly rather than guessing.
- Be concise, specific, and encouraging. Plain text, no markdown headers.

Taking action (tools):
- You can CHANGE the plan with the provided tools: take days off / rest, reduce mileage, move a workout, ease or sharpen paces for a window, or set a new fitness anchor from a race or VDOT.
- Only call a tool when the user clearly asks for a change, not when they're just discussing or asking "what if". If a request is ambiguous, ask a brief clarifying question instead of acting.
- Resolve relative dates ("tomorrow", "this week", "next Tue") to YYYY-MM-DD using TODAY from the data below.
- For a fitness-anchor change, confirm the exact race/time or VDOT before calling the tool.
- set_training_goal REBUILDS the whole plan, use it only when the athlete clearly commits to a goal, and confirm distance + date (+ target time) first. Estimate currentWeeklyMiles from the recent-training data above if unstated.
- After a tool runs, tell the user plainly what changed and that the coach can see and adjust it. Every change is reversible.`;
}

function fmtTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.round(s % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}
const pm = (sec: number | null) => (sec == null ? '-' : `${secPerKmToMinPerMile(sec)}/mi`);
const mi = (m: number | null) => (m == null || m <= 0 ? '-' : (m / 1609.344).toFixed(1));

/** Compose a grounding context string from the athlete's structured data. */
async function buildContext(
  db: DB,
  athleteId: string,
): Promise<{ context: string; today: string; firstName: string } | null> {
  const [athlete] = await db.select().from(athletes).where(eq(athletes.id, athleteId)).limit(1);
  if (!athlete) return null;
  const portal = await getAthletePortal(athleteId);
  if (!portal) return null;
  const insights = await getTrainingInsights(athleteId);
  const vdot = await getAthleteVdot(db, athleteId);
  const zones = await getAthleteZones(db, athleteId);

  const firstName = athlete.fullName.split(' ')[0];
  const lines: string[] = [];
  lines.push(`TODAY is ${portal.today}. Resolve any relative dates against this.`);
  lines.push(`Athlete: ${athlete.fullName} (first name ${firstName}).`);
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
    }${portal.readiness.sentence ? `. "${portal.readiness.sentence}"` : ''}.`,
  );
  if (portal.todaySession) {
    const s = portal.todaySession;
    lines.push(
      `Today's session: ${s.sessionType}, ${mi(s.distanceMeters)} mi${
        s.paceFastSecPerKm != null ? ` @ ${pm(s.paceFastSecPerKm)}-${pm(s.paceSlowSecPerKm)}` : ''
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
        `Career best (CONTEXT ONLY, possibly a different life stage, not the current target): ~VDOT ${insights.careerBest.vdot} (${insights.careerBest.distanceLabel}, ${insights.careerBest.day}).`,
      );
    }
    if (insights.suggestions.length) {
      lines.push('System-flagged suggestions: ' + insights.suggestions.map((s) => `[${s.basis}] ${s.text}`).join(' '));
    }
  }

  const adaptation = await getAdaptationState(athleteId, portal.today);
  if (adaptation) {
    lines.push(
      `Adherence: ${adaptation.tone}${
        adaptation.lastRunDay ? `, last run ${adaptation.layoffDays}d ago` : ''
      }, ${adaptation.missedRecent} missed in last 2 weeks, current streak ${adaptation.streakDays} days.${
        adaptation.tone !== 'on_track' ? ' If they bring it up, encourage, do not suggest making up the missed miles.' : ''
      }`,
    );
  }

  return { context: lines.join('\n'), today: portal.today, firstName };
}

const MAX_TOOL_ITERATIONS = 5;

export async function askTrainingQuestion(
  db: DB,
  athleteId: string,
  messages: ChatMessage[],
  opts: { audience?: 'coach' | 'athlete' } = {},
): Promise<{ reply: string; actions: ActionTaken[] }> {
  if (!chatConfigured()) throw new Error('Chat is not configured (missing ANTHROPIC_API_KEY).');
  const ctx = await buildContext(db, athleteId);
  if (ctx == null) throw new Error('Athlete not found.');

  const audience = opts.audience ?? 'athlete';
  const actor: ChatActor = { role: audience, athleteId, firstName: ctx.firstName, today: ctx.today };

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  // Default to the cheap/fast Haiku tier. Tool-use + coaching nuance is more
  // reliable on Sonnet — set ANTHROPIC_MODEL to bump it if needed.
  const model = process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5';
  const system = `${systemPrompt(audience)}\n\n=== THIS ATHLETE'S DATA (the only facts you may use) ===\n${ctx.context}`;

  const convo: Anthropic.MessageParam[] = messages
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content }));

  const actions: ActionTaken[] = [];
  let lastText = '';

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const resp = await client.messages.create({
      model,
      max_tokens: 900,
      system,
      tools: CHAT_TOOLS,
      messages: convo,
    });

    lastText = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    const toolUses = resp.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (resp.stop_reason !== 'tool_use' || toolUses.length === 0) {
      return { reply: lastText || "I couldn't generate a response, try rephrasing.", actions };
    }

    // Execute each requested tool and feed the results back.
    convo.push({ role: 'assistant', content: resp.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      const r = await executeChatTool(db, actor, tu.name, tu.input as Record<string, unknown>);
      actions.push({ tool: tu.name, summary: r.summary, ok: r.ok });
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: r.summary, is_error: !r.ok });
    }
    convo.push({ role: 'user', content: results });
  }

  return {
    reply: lastText || 'Done. I made the requested changes.',
    actions,
  };
}
