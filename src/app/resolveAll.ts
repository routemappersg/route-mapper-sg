import type { Place, Stop } from '../domain/types';
import { demoPlace } from '../providers/demo';
import type { Providers } from '../providers/types';
import { fetchCommunityGates } from './config';
import { memoryGateRecords, Resolver, type Resolution } from '../resolve/resolver';

export interface Resolved {
  stop: Stop;
  place: Place | null;
  flags: string[];
}

/**
 * Resolve every stop. With real providers (the Worker is configured) this applies the gate
 * rule; without them it uses demo positions and says so. Stops that cannot be placed are
 * returned with place = null, never dropped.
 */
export async function resolveAll(stops: Stop[], providers: Providers | null, community: typeof fetchCommunityGates = fetchCommunityGates): Promise<{ resolved: Resolved[]; demo: boolean }> {
  if (!providers) {
    return {
      demo: true,
      resolved: stops.map((stop) => {
        const place = demoPlace(stop);
        return { stop, place, flags: place ? ['demo'] : ['not-found'] };
      }),
    };
  }
  // Community gates are non-personal (postal codes + coordinates); only postal codes are sent to look them up.
  const postals = stops.map((s) => s.postal).filter((p): p is string => !!p);
  const resolver = new Resolver({ geocoder: providers.geocoder, mapData: providers.mapData, records: memoryGateRecords(await community(postals)) });
  const out: Resolved[] = [];
  for (const stop of stops) {
    const r: Resolution = await resolver.resolve(stop);
    out.push({ stop, place: r.place, flags: r.flags });
  }
  return { resolved: out, demo: false };
}
