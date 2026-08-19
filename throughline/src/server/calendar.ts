/**
 * iCalendar (.ics) feed of an athlete's published plan. Athletes subscribe once
 * and every planned session shows up in Apple/Google/Outlook calendars as an
 * all-day event, refreshing as the plan changes. Directives are overlaid so
 * unavailable days read as rest and adjusted paces are reflected.
 */
import { and, eq, gte } from 'drizzle-orm';
import type { DB } from '@/db';
import { plans, plannedSessions, athletes } from '@/db/schema';
import { applyDirectives, secPerKmToMinPerMile } from '@/engine/plan';
import { listActiveDirectives } from '@/server/directives';

const MI = 1609.344;

function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function ymd(day: string): string {
  return day.replace(/-/g, '');
}

/** Next day (for all-day DTEND, which is exclusive). */
function nextYmd(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return dt.toISOString().slice(0, 10).replace(/-/g, '');
}

function stamp(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

const TYPE_EMOJI: Record<string, string> = {
  rest: '😴',
  recovery: '🚶',
  easy: '🏃',
  long: '🏃',
  threshold: '🔥',
  interval: '⚡',
  rep: '⚡',
  marathon: '🏃',
  cross_train: '🚴',
};

/**
 * Build the full feed. Includes every session from the athlete's published
 * plans dated on/after `from` (default: 60 days back, so the current week is
 * always present even mid-week).
 */
export async function buildPlanIcs(db: DB, athleteId: string, from?: string): Promise<string | null> {
  const [athlete] = await db.select().from(athletes).where(eq(athletes.id, athleteId)).limit(1);
  if (!athlete) return null;

  const fromDay =
    from ?? new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);

  const rows = await db
    .select({
      id: plannedSessions.id,
      day: plannedSessions.day,
      sessionType: plannedSessions.sessionType,
      targetDistanceMeters: plannedSessions.targetDistanceMeters,
      targetPaceFastSecPerKm: plannedSessions.targetPaceFastSecPerKm,
      targetPaceSlowSecPerKm: plannedSessions.targetPaceSlowSecPerKm,
      description: plannedSessions.description,
    })
    .from(plannedSessions)
    .innerJoin(plans, eq(plannedSessions.planId, plans.id))
    .where(
      and(
        eq(plannedSessions.athleteId, athleteId),
        eq(plans.status, 'published'),
        gte(plannedSessions.day, fromDay),
      ),
    )
    .orderBy(plannedSessions.day);

  const directiveRows = await listActiveDirectives(db, athleteId);

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Throughline//Training Plan//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(`${athlete.fullName.split(' ')[0]}. Throughline`)}`,
    'X-PUBLISHED-TTL:PT6H',
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
  ];

  const dtstamp = stamp();
  for (const s of rows) {
    const adj = applyDirectives(
      {
        day: s.day,
        sessionType: s.sessionType,
        distanceMeters: s.targetDistanceMeters,
        paceFastSecPerKm: s.targetPaceFastSecPerKm,
        paceSlowSecPerKm: s.targetPaceSlowSecPerKm,
      },
      directiveRows,
    );

    const emoji = TYPE_EMOJI[adj.sessionType] ?? '🏃';
    const typeLabel = adj.sessionType.replace('_', ' ');
    const milesLabel =
      adj.distanceMeters != null && adj.distanceMeters > 0
        ? `, ${(adj.distanceMeters / MI).toFixed(1)} mi`
        : '';
    const summary = `${emoji} ${cap(typeLabel)}${milesLabel}`;

    const descParts: string[] = [];
    if (adj.paceFastSecPerKm != null) {
      descParts.push(
        `Pace ${secPerKmToMinPerMile(adj.paceFastSecPerKm)}-${secPerKmToMinPerMile(adj.paceSlowSecPerKm ?? adj.paceFastSecPerKm)}/mi`,
      );
    }
    if (s.description) descParts.push(s.description);
    if (adj.adjustments.length) descParts.push(`Adjusted: ${adj.adjustments.join('; ')}`);

    lines.push(
      'BEGIN:VEVENT',
      `UID:${s.id}@throughline`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${ymd(s.day)}`,
      `DTEND;VALUE=DATE:${nextYmd(s.day)}`,
      `SUMMARY:${esc(summary)}`,
      `DESCRIPTION:${esc(descParts.join('\n'))}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  // ICS requires CRLF line breaks.
  return lines.join('\r\n') + '\r\n';
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
