import Link from 'next/link';
import { getDb } from '@/db';
import { listEscalations, ESCALATION_LABELS } from '@/server/escalations';
import { EscalationActions } from '@/components/EscalationActions';
import { Card } from '@/components/ui';

export const dynamic = 'force-dynamic';

const TODAY_MS = Date.UTC(2026, 5, 6); // seed reference "today"

function ageDays(d: Date): string {
  const days = Math.max(0, Math.round((TODAY_MS - new Date(d).getTime()) / 86400000));
  return days === 0 ? 'today' : `${days}d ago`;
}

export default async function EscalationsPage() {
  const db = await getDb();
  const rows = await listEscalations(db);

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold text-slate-900">Escalations</h1>
        <span className="text-sm text-slate-500">
          {rows.length} needing review · autonomous athletes the autopilot held
        </span>
      </div>

      {rows.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-500">Nothing to review — the autopilot is running clean. ✓</p>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Athlete</th>
                <th className="px-4 py-2 font-medium">Issue</th>
                <th className="px-4 py-2 font-medium">Why</th>
                <th className="px-4 py-2 font-medium">Raised</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((e) => (
                <tr key={e.id} className="align-top hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link href={`/athletes/${e.athleteId}`} className="font-medium text-sky-700 hover:underline">
                      {e.athleteName}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded bg-rose-50 px-1.5 py-0.5 text-xs font-medium text-rose-700 ring-1 ring-inset ring-rose-200">
                      {ESCALATION_LABELS[e.kind] ?? e.kind}
                    </span>
                  </td>
                  <td className="px-4 py-3 max-w-md text-slate-600">{e.reason}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-500">{ageDays(e.createdAt)}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-slate-500">{e.status}</span>
                  </td>
                  <td className="px-4 py-3">
                    <EscalationActions id={e.id} status={e.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
