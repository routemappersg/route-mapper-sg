/**
 * DEMO ONLY. Approximate positions for the D4-01 fixture, so the Review screen can be tried
 * before the Cloudflare Worker (OneMap + openrouteservice) exists. Positions are neighbourhood
 * level, NOT verified gates. Every demo stop is flagged "demo".
 */
import type { Stop } from '../domain/types';
import type { Place } from '../domain/types';

const P = (lat: number, lng: number) => ({ lat, lng });

const BY_POSTAL: Record<string, { lat: number; lng: number }> = {
  '540248': P(1.3921, 103.8985),
  '530444': P(1.3795, 103.8938),
  '692128': P(1.3579, 103.7333),
  '650355': P(1.3618, 103.7505),
  '270004': P(1.3132, 103.7882),
  '122464': P(1.3099, 103.7679),
  '600274': P(1.342, 103.7468),
  '120410': P(1.3114, 103.7697),
  '677723': P(1.3899, 103.7703),
  '350115': P(1.3373, 103.8627),
};
const BY_BLOCK: Record<string, { lat: number; lng: number }> = {
  '543': P(1.3939, 103.7443),
  '401': P(1.3203, 103.7503),
  '570': P(1.378, 103.8882),
};


export function demoPlace(stop: Stop): Place | null {
  const pos = (stop.postal && BY_POSTAL[stop.postal]) || (stop.block && BY_BLOCK[stop.block]) || null;
  return pos ? { postal: stop.postal, position: pos, gated: stop.postal === '677723', confidence: 'guess' } : null;
}
