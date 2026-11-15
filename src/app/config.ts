/**
 * Connects the app to our Cloudflare Worker. The app never talks to OneMap, openrouteservice,
 * Overpass or Supabase directly: only to the Worker, which holds every key and checks that no
 * personal data is in a request. Without VITE_API_BASE the app runs in clearly-labelled demo mode.
 */
import type { GateRecord } from '../resolve/resolver';
import { oneMapGeocoder } from '../providers/onemap';
import { orsOptimizer, orsRouter } from '../providers/ors';
import { overpassMapData } from '../providers/overpass';
import type { KeyValueStore, Providers } from '../providers/types';

export const API_BASE: string = ((import.meta.env.VITE_API_BASE as string | undefined) ?? '').replace(/\/+$/, '');

/** Routing calls a single device may spend per day, so one driver cannot drain the shared free quota. */
export const DEVICE_ROUTING_CAP = 40;

export interface ServerConfig {
  providers: { geocode: boolean; mapData: boolean; route: boolean; community: boolean };
  banner: string | null;
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

async function call(url: string, init: RequestInit, ms = 20_000): Promise<unknown> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal });
    if (!res.ok) throw new ApiError(res.status, `HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export const fetchJson = (url: string): Promise<unknown> => call(url, {});
export const postJson = (url: string, body: unknown): Promise<unknown> =>
  call(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, 40_000);
export const postText = (url: string, body: string): Promise<unknown> =>
  call(url, { method: 'POST', headers: { 'content-type': 'text/plain' }, body }, 40_000);

const today = (now: number): string => new Date(now).toISOString().slice(0, 10);

/** Counts routing calls per device per day. Over the cap the planner uses the in-browser engine. */
export function capped<T extends object>(inner: T, methods: (keyof T)[], store: KeyValueStore, now: () => number, cap = DEVICE_ROUTING_CAP): T {
  const out = { ...inner } as Record<string, unknown>;
  for (const m of methods) {
    const fn = (inner as Record<string, unknown>)[m as string] as (...a: unknown[]) => Promise<unknown>;
    out[m as string] = async (...args: unknown[]) => {
      const key = `routing-calls:${today(now())}`;
      const used = (await store.get<number>(key)) ?? 0;
      if (used >= cap) throw new ApiError(429, 'device-cap');
      await store.set(key, used + 1);
      return fn.apply(inner, args);
    };
  }
  return out as T;
}

export async function loadServerConfig(base = API_BASE): Promise<ServerConfig | null> {
  if (!base) return null;
  try {
    return (await call(`${base}/config`, {}, 6_000)) as ServerConfig;
  } catch {
    // Unreachable (offline, or the Worker is down): keep going, individual calls fall back on their own.
    return { providers: { geocode: true, mapData: true, route: true, community: true }, banner: null };
  }
}

const off = (what: string) => async (): Promise<never> => { throw new ApiError(503, `${what}-disabled`); };

export function buildProviders(store: KeyValueStore, cfg: ServerConfig, base = API_BASE, now: () => number = Date.now): Providers | null {
  if (!base) return null;
  const geocoder = cfg.providers.geocode
    ? oneMapGeocoder({ baseUrl: `${base}/onemap`, fetchJson })
    : { id: 'off', byPostal: off('geocode'), bySearch: off('geocode') };
  const mapData = cfg.providers.mapData
    ? overpassMapData({ baseUrl: base, postText })
    : { id: 'off', around: off('mapdata') };
  const router = cfg.providers.route ? orsRouter({ baseUrl: base, postJson }) : { id: 'off', matrix: off('route'), path: off('route') };
  const optimizer = cfg.providers.route ? orsOptimizer({ baseUrl: base, postJson }) : { id: 'off', optimize: off('route') };
  return {
    geocoder,
    mapData: mapData as Providers['mapData'],
    router: capped(router as Providers['router'], ['matrix', 'path'], store, now),
    optimizer: capped(optimizer as Providers['optimizer'], ['optimize'], store, now),
    tiles: { id: 'onemap', styleUrl: '', attribution: '' },
    store,
  };
}

/** Verified community gates for these postal codes. Failure is harmless: the map-data rule still applies. */
export async function fetchCommunityGates(postals: string[], base = API_BASE): Promise<GateRecord[]> {
  const list = [...new Set(postals)].slice(0, 50);
  if (!base || list.length === 0) return [];
  try {
    const r = (await fetchJson(`${base}/community/gates?postals=${list.join(',')}`)) as {
      gates?: { id: string; name?: string; postals: string[]; gate: { lat: number; lng: number }; gated: boolean }[];
    };
    return (r.gates ?? []).map((g) => ({ developmentId: g.id, ...(g.name ? { name: g.name } : {}), postals: g.postals, gate: g.gate, gated: g.gated }));
  } catch {
    return [];
  }
}
