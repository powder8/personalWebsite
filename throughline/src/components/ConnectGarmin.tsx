/**
 * Garmin Connect card: connect via OAuth, or show the connection with a
 * Disconnect option. Garmin delivers history in the background after
 * connecting, so the first data can take a while to appear.
 */
import { DisconnectButton } from '@/components/DisconnectButton';

export function ConnectGarmin({ athleteId, connected, latestDay }: { athleteId: string; connected: boolean; latestDay: string | null }) {
  if (!connected) {
    return (
      <div>
        <a
          href={`/api/auth/garmin/connect?athleteId=${athleteId}`}
          className="inline-flex items-center rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-[#0a0a0b] transition hover:bg-slate-800"
        >
          Connect Garmin
        </a>
        <p className="mt-2 text-xs text-slate-500">
          Brings in activities, resting heart rate, HRV, sleep, VO2max, and weight from Garmin Connect. If your Garmin
          already syncs to Strava, we keep the Strava copy of each activity so nothing counts twice.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <span className="inline-flex items-center rounded-full bg-emerald-400/15 px-2.5 py-1 text-xs font-medium text-emerald-300">
        Garmin connected ✓
      </span>
      <p className="text-xs text-slate-500">
        {latestDay
          ? `Latest Garmin data: ${latestDay}. New data arrives automatically.`
          : 'Connected. Garmin sends your history in the background, so it can take a few hours to appear.'}
      </p>
      <DisconnectButton athleteId={athleteId} provider="garmin" label="Garmin" />
    </div>
  );
}
