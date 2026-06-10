import Link from 'next/link';
import { getDb } from '@/db';
import { listFeedback } from '@/server/feedback';
import { FeedbackActions } from '@/components/FeedbackActions';
import { Card } from '@/components/ui';

export const dynamic = 'force-dynamic';

const TODAY_MS = Date.now();
function age(d: Date): string {
  const days = Math.max(0, Math.round((TODAY_MS - new Date(d).getTime()) / 86400000));
  return days === 0 ? 'today' : `${days}d ago`;
}

export default async function FeedbackPage() {
  const db = await getDb();
  const rows = await listFeedback(db);
  const open = rows.filter((r) => r.status === 'open');
  const addressed = rows.filter((r) => r.status === 'addressed');

  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold text-slate-900">Feedback</h1>
        <span className="text-sm text-slate-500">{open.length} open · from the coach, in context</span>
      </div>

      {rows.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-500">
            No feedback yet. Heather can use the 💬 button (bottom-right) on any page.
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {[...open, ...addressed].map((f) => (
            <div
              key={f.id}
              className={`rounded-lg border p-3 ${
                f.status === 'open' ? 'border-slate-200 bg-white' : 'border-slate-200 bg-slate-50 opacity-75'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="font-medium text-slate-700">{f.author}</span>
                    {f.category && (
                      <span className="rounded bg-sky-50 px-1.5 py-0.5 font-medium text-sky-700">{f.category}</span>
                    )}
                    {f.path && (
                      <Link href={f.path} className="text-sky-700 hover:underline">
                        {f.path}
                      </Link>
                    )}
                    <span>· {age(f.createdAt)}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{f.body}</p>
                </div>
                <FeedbackActions id={f.id} status={f.status} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
