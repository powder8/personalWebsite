/** Shown by the service worker when a page navigation has no network. */
export default function OfflinePage() {
  return (
    <div className="mx-auto max-w-md px-6 py-20 text-center">
      <div className="text-4xl">📡</div>
      <h1 className="mt-4 text-xl font-semibold text-slate-900">You&apos;re offline</h1>
      <p className="mt-2 text-sm text-slate-500">
        Throughline needs a connection to show today&apos;s plan, it&apos;s recomputed live from your training. Your
        watch keeps recording; everything syncs when you&apos;re back online.
      </p>
    </div>
  );
}
