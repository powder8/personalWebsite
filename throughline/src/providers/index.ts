import type { Provider, ProviderId } from './types';
import { garmin } from './garmin';
import { strava } from './strava';

const registry: Record<ProviderId, Provider> = {
  garmin,
  strava,
};

export function getProvider(id: ProviderId): Provider {
  const p = registry[id];
  if (!p) throw new Error(`Unknown provider: ${id}`);
  return p;
}

export type { Provider, ProviderId } from './types';
