import type { Provider, ProviderId } from './types';
import { garmin } from './garmin';
import { strava } from './strava';

// Partial: not every ProviderId is an OAuth/webhook Provider. Apple Health is a
// PUSH provider (no OAuth, no pull) and never goes through this registry — it
// ingests via server/appleHealth.ts directly. getProvider throws for it, which
// is correct: nothing should ask this registry for 'apple'.
const registry: Partial<Record<ProviderId, Provider>> = {
  garmin,
  strava,
};

export function getProvider(id: ProviderId): Provider {
  const p = registry[id];
  if (!p) throw new Error(`Unknown provider: ${id}`);
  return p;
}

export type { Provider, ProviderId } from './types';
