/**
 * "Coach's take" on a completed run. Tone-styled by whether the run reinforced
 * good habits (positive) or earned a gentle correction (caution). Pure markup;
 * data from server/runFeedback.ts.
 */
import Link from 'next/link';
import type { RunFeedback } from '@/server/runFeedbackLogic';

export function RunFeedbackCard({
  feedback,
  href,
  compact = false,
}: {
  feedback: RunFeedback;
  href?: string;
  compact?: boolean;
}) {
  const tone = feedback.positive
    ? { ring: 'ring-emerald-400/30', bg: 'bg-emerald-400/10', dot: 'bg-emerald-400', label: 'text-emerald-300' }
    : { ring: 'ring-amber-400/30', bg: 'bg-amber-400/10', dot: 'bg-amber-400', label: 'text-amber-300' };

  const body = (
    <div className={`rounded-2xl ${tone.bg} p-4 ring-1 ring-inset ${tone.ring}`}>
      <div className="flex items-center gap-2">
        <span className={`inline-block h-2 w-2 rounded-full ${tone.dot}`} />
        <span className={`text-[11px] font-semibold uppercase tracking-wide ${tone.label}`}>Coach&rsquo;s take</span>
      </div>
      <p className="mt-1.5 text-base font-bold tracking-tight text-slate-900">{feedback.headline}</p>
      <p className={`mt-1 ${compact ? 'text-xs' : 'text-sm'} leading-relaxed text-slate-600`}>{feedback.detail}</p>
      {href && (
        <span className="mt-2 inline-block text-xs font-semibold text-sky-300">See the run →</span>
      )}
    </div>
  );

  return href ? (
    <Link href={href} className="block transition hover:opacity-90">
      {body}
    </Link>
  ) : (
    body
  );
}
