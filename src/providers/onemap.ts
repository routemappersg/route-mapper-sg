/**
 * OneMap (Singapore Land Authority) geocoder.
 * The app calls our Cloudflare Worker (`baseUrl`), which adds the OneMap token server-side
 * and renews it every 3 days. No token or account details live in the app.
 * Only a postal code, or block + street, is ever placed in the request.
 */
import type { GeocodeHit, Geocoder } from './types';

interface OneMapResult {
  BLK_NO?: string;
  ROAD_NAME?: string;
  BUILDING?: string;
  POSTAL?: string;
  LATITUDE?: string;
  LONGITUDE?: string;
}

const clean = (v?: string): string | undefined => {
  const s = (v ?? '').trim();
  return s && s.toUpperCase() !== 'NIL' ? s : undefined;
};

const title = (s?: string): string | undefined =>
  s?.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

function toHit(r: OneMapResult): GeocodeHit | null {
  const lat = Number(r.LATITUDE);
  const lng = Number(r.LONGITUDE);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const hit: GeocodeHit = { position: { lat, lng } };
  const postal = clean(r.POSTAL);
  const block = clean(r.BLK_NO);
  const street = title(clean(r.ROAD_NAME));
  const building = title(clean(r.BUILDING));
  if (postal) hit.postal = postal;
  if (block) hit.block = block.toUpperCase();
  if (street) hit.street = street;
  if (building) hit.building = building;
  return hit;
}

export function oneMapGeocoder(opts: { baseUrl: string; fetchJson: (url: string) => Promise<unknown> }): Geocoder {
  const search = async (q: string): Promise<GeocodeHit[]> => {
    const url = `${opts.baseUrl}/api/common/elastic/search?searchVal=${encodeURIComponent(q)}&returnGeom=Y&getAddrDetails=Y&pageNum=1`;
    const body = (await opts.fetchJson(url)) as { results?: OneMapResult[] };
    return (body.results ?? []).map(toHit).filter((h): h is GeocodeHit => h !== null);
  };
  return {
    id: 'onemap',
    async byPostal(postal) {
      const hits = await search(postal);
      // Prefer an exact postal match; otherwise return the first hit so the resolver can flag the mismatch.
      return hits.find((h) => h.postal === postal) ?? hits[0] ?? null;
    },
    async bySearch(block, street) {
      return search(`${block} ${street}`);
    },
  };
}
