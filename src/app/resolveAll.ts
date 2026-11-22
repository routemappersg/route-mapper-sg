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
const CONCURRENCY = 4;
const BREAKER_AFTER = 3;

/**
 * Look stops up a few at a time, in order. If the map-data service fails several times in a row
 * it is skipped for the rest of the plan (stops are flagged "check pin") so a slow free service
 * can never hold a whole plan hostage.
 */
export async function resolveAll(
  stops: Stop[],
  providers: Providers | null,
  community: typeof fetchCommunityGates = fetchCommunityGates,
  onProgress: (done: number, total: number) => void = () => undefined,
  /** Called as soon as each stop is found, so a screen can show it straight away instead of waiting for all. */
  onEach: (r: Resolved, index: number) => void = () => undefined,
): Promise<{ resolved: Resolved[]; demo: boolean }> {
  if (!providers) {
    return {
      demo: true,
      resolved: stops.map((stop, i) => {
        const place = demoPlace(stop);
        const r: Resolved = { stop, place, flags: place ? ['demo'] : ['not-found'] };
        onEach(r, i);
        return r;
      }),
    };
  }
  // Community gates are non-personal (postal codes + coordinates); only postal codes are sent to look them up.
  const postals = stops.map((s) => s.postal).filter((p): p is string => !!p);
  let failures = 0;
  const mapData: Providers['mapData'] = {
    id: providers.mapData.id,
    async around(position, radiusM) {
      if (failures >= BREAKER_AFTER) throw new Error('map data skipped');
      try {
        const area = await providers.mapData.around(position, radiusM);
        failures = 0;
        return area;
      } catch (e) {
        failures++;
        throw e;
      }
    },
  };
  const resolver = new Resolver({ geocoder: providers.geocoder, mapData, records: memoryGateRecords(await community(postals)) });
  const out: Resolved[] = new Array<Resolved>(stops.length);
  let next = 0;
  let done = 0;
  onProgress(0, stops.length);
  const worker = async (): Promise<void> => {
    for (let i = next++; i < stops.length; i = next++) {
      const stop = stops[i]!;
      let r: Resolution | null = null;
      try {
        r = await resolver.resolve(stop);
      } catch {
        /* e.g. the address lookup is unreachable: keep the stop, flagged, never drop it */
      }
      out[i] = { stop, place: r?.place ?? null, flags: r ? r.flags : ['not-found'] };
      onEach(out[i]!, i);
      onProgress(++done, stops.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, stops.length) }, worker));
  return { resolved: out, demo: false };
}
