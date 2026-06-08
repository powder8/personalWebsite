/**
 * PURE planning + validation for the chat's action tools — no DB, no
 * server-only, so it's unit-testable in isolation. `chatTools.ts` turns a
 * PlannedAction into the actual directive/anchor mutation. Type-only imports of
 * the engine/server shapes are erased at runtime (no server-only chain).
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { AnchorInput } from '@/server/anchor';
import type { NewDirective } from '@/server/directives';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Anthropic tool definitions exposed to the model. */
export const CHAT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'request_training_adjustment',
    description:
      "Adjust the athlete's plan for a day or date range: take a rest/day off, reduce mileage, or move/skip a hard workout. Use when the athlete (or coach) wants to change what's scheduled because of travel, illness, fatigue, or life. Resolve relative dates (e.g. 'tomorrow', 'next Tuesday') to YYYY-MM-DD using today's date from the context. The coach can review every change.",
    input_schema: {
      type: 'object',
      properties: {
        adjustment: {
          type: 'string',
          enum: ['rest', 'reduced_mileage', 'move_workout'],
          description: 'rest = full day(s) off; reduced_mileage = lighter running; move_workout = free this day so a key session reshuffles.',
        },
        from: { type: 'string', description: 'Start date, YYYY-MM-DD.' },
        to: { type: 'string', description: 'Optional end date (inclusive), YYYY-MM-DD. Omit for a single day.' },
        note: { type: 'string', description: 'Short reason, e.g. "travelling" or "sore calf".' },
      },
      required: ['adjustment', 'from'],
    },
  },
  {
    name: 'adjust_paces_window',
    description:
      'Temporarily ease (slower) or sharpen (faster) the athlete\'s prescribed paces over a date window — e.g. "run easy this week" or "paces feel too hard". This is a windowed nudge in seconds per mile, not a permanent fitness change. Resolve relative dates to YYYY-MM-DD.',
    input_schema: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['easier', 'faster'], description: 'easier = slow paces down; faster = speed them up.' },
        secondsPerMile: { type: 'number', description: 'Magnitude, 1–60 s/mi.' },
        from: { type: 'string', description: 'Start date, YYYY-MM-DD.' },
        to: { type: 'string', description: 'Optional end date (inclusive), YYYY-MM-DD.' },
        note: { type: 'string', description: 'Short reason.' },
      },
      required: ['direction', 'secondsPerMile', 'from'],
    },
  },
  {
    name: 'set_fitness_anchor',
    description:
      "Override the athlete's fitness anchor (the number all paces derive from) when they have a new benchmark — a recent race result or a known VDOT. This retunes future planned paces. Use only when the athlete/coach clearly states a new performance or value, and confirm the specifics first.",
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['vdot', 'race'], description: 'vdot = a known VDOT number; race = a recent race result.' },
        vdot: { type: 'number', description: 'VDOT 20–90 (kind=vdot).' },
        raceDistanceMeters: { type: 'number', description: 'Race distance in meters (kind=race), e.g. 5000, 10000, 21097.5, 42195.' },
        raceTimeSeconds: { type: 'number', description: 'Race time in seconds (kind=race).' },
      },
      required: ['kind'],
    },
  },
];

export function fmtTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.round(s % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

export type PlannedAction =
  | { error: string }
  | { type: 'directive'; directive: NewDirective; summary: string }
  | { type: 'anchor'; anchor: AnchorInput; describe: string };

/** Validate + map a tool call to a concrete action (or an error). Pure. */
export function planToolAction(name: string, input: Record<string, unknown>): PlannedAction {
  switch (name) {
    case 'request_training_adjustment': {
      const adjustment = String(input.adjustment);
      const from = String(input.from ?? '');
      const to = input.to ? String(input.to) : null;
      const note = input.note ? String(input.note) : null;
      if (!DATE_RE.test(from) || (to && !DATE_RE.test(to))) return { error: 'Dates must be YYYY-MM-DD.' };
      const map: Record<string, { type: 'unavailable' | 'reduce_volume'; factor?: number; label: string }> = {
        rest: { type: 'unavailable', label: 'Rest / day off' },
        move_workout: { type: 'unavailable', label: 'Move workout' },
        reduced_mileage: { type: 'reduce_volume', factor: 0.65, label: 'Reduced mileage' },
      };
      const m = map[adjustment];
      if (!m) return { error: `Unknown adjustment "${adjustment}".` };
      const range = to && to !== from ? `${from} → ${to}` : from;
      return {
        type: 'directive',
        directive: { type: m.type, from, to, factor: m.factor, label: note ? `${m.label} — ${note}` : m.label },
        summary: `${m.label} applied for ${range}. The plan reshapes around it; your coach can see and adjust this.`,
      };
    }

    case 'adjust_paces_window': {
      const direction = String(input.direction);
      const sec = Math.round(Number(input.secondsPerMile));
      const from = String(input.from ?? '');
      const to = input.to ? String(input.to) : null;
      const note = input.note ? String(input.note) : null;
      if (direction !== 'easier' && direction !== 'faster') return { error: 'direction must be easier or faster.' };
      if (!DATE_RE.test(from) || (to && !DATE_RE.test(to))) return { error: 'Dates must be YYYY-MM-DD.' };
      if (!(sec >= 1 && sec <= 60)) return { error: 'secondsPerMile must be 1–60.' };
      const delta = direction === 'easier' ? sec : -sec;
      const range = to && to !== from ? `${from} → ${to}` : `from ${from}`;
      return {
        type: 'directive',
        directive: { type: 'pace_adjust', from, to, deltaSecPerMile: delta, label: note ? `Paces ${direction} ${sec}s/mi — ${note}` : `Paces ${direction} ${sec}s/mi` },
        summary: `Paces ${direction} by ${sec}s/mi ${range}. Coach-reviewable; remove it anytime.`,
      };
    }

    case 'set_fitness_anchor': {
      const kind = String(input.kind);
      if (kind === 'vdot') {
        const vdot = Number(input.vdot);
        if (!(vdot >= 20 && vdot <= 90)) return { error: 'VDOT must be 20–90.' };
        return { type: 'anchor', anchor: { kind: 'vdot', vdot }, describe: `Fitness anchor set to VDOT ${vdot}` };
      }
      if (kind === 'race') {
        const distanceMeters = Number(input.raceDistanceMeters);
        const timeSeconds = Number(input.raceTimeSeconds);
        if (!(distanceMeters > 0) || !(timeSeconds > 0)) return { error: 'Race needs distance (m) and time (s).' };
        return {
          type: 'anchor',
          anchor: { kind: 'race', distanceMeters, timeSeconds },
          describe: `Anchor set from ${(distanceMeters / 1000).toFixed(1)}K in ${fmtTime(timeSeconds)}`,
        };
      }
      return { error: `Unknown anchor kind "${kind}".` };
    }

    default:
      return { error: `Unknown tool "${name}".` };
  }
}
