/**
 * SYNTHETIC test geography (not real coordinates). Modelled on the Blossom Residences case:
 * a gated estate with its main guardhouse on the public road to the south, a rear barrier
 * onto a minor lane to the north, a pedestrian gate on the east, and an expressway running
 * past the west side, closer to the blocks than the real entrance.
 * Units are metres east/north of BASE.
 */
import type { LatLng } from '../src/domain/types';
import type { Development, GateNode, MapArea, Road, RoadClass } from '../src/providers/types';
import { offset } from '../src/resolve/geo';

export const BASE: LatLng = { lat: 1.38, lng: 103.77 };
export const at = (e: number, n: number): LatLng => offset(BASE, e, n);
const road = (id: string, cls: RoadClass, pts: [number, number][], priv = false): Road => ({ id, cls, private: priv, coords: pts.map(([e, n]) => at(e, n)) });
const gate = (id: string, kind: GateNode['kind'], e: number, n: number): GateNode => ({ id, kind, position: at(e, n) });
const square = (e0: number, n0: number, e1: number, n1: number): LatLng[] => [at(e0, n0), at(e1, n0), at(e1, n1), at(e0, n1), at(e0, n0)];

export const estate: Development = { id: 'dev-estate', name: 'Synthetic Residences', boundary: square(0, 0, 200, 200), gated: true, postals: [] };
export const lockedEstate: Development = { id: 'dev-locked', name: 'No-Road Gate Estate', boundary: square(600, 600, 700, 700), gated: true, postals: [] };

export const area: MapArea = {
  developments: [estate, lockedEstate],
  roads: [
    road('main-public', 'tertiary', [[-300, -20], [500, -20]]),
    road('main-access', 'service', [[100, -20], [100, 100]], true),
    road('estate-loop', 'service', [[0, 100], [200, 100]], true),
    road('rear-access', 'service', [[100, 100], [100, 230]], true),
    road('rear-lane', 'residential', [[-100, 230], [300, 230]]),
    road('expressway', 'motorway', [[-15, -300], [-15, 500]]),
    road('slip', 'motorway_link', [[-15, 40], [5, 60]]),
    // Non-gated HDB block area to the south-east
    road('hdb-expressway', 'motorway', [[300, -55], [600, -55]]),
    road('hdb-street', 'residential', [[300, -100], [600, -100]]),
    // Locked estate: only a public road to its south
    road('locked-public', 'residential', [[550, 560], [750, 560]]),
    // Dead-end estate road through the barrier that never reaches the public road (30 m gap)
    road('locked-internal', 'service', [[650, 640], [650, 590]], true),
  ],
  gates: [
    gate('guardhouse', 'guardhouse', 108, 5),
    gate('boom', 'barrier', 100, 0),
    gate('rear-barrier', 'barrier', 100, 198),
    gate('ped', 'pedestrian', 200, 60),
    gate('locked-barrier', 'barrier', 650, 600),
  ],
};

export const blocks: Record<string, LatLng> = {
  '677721': at(10, 40),
  '677722': at(10, 160),
  '677723': at(60, 180),
  '677724': at(20, 100),
  '600100': at(450, -60), // non-gated block beside the expressway
  '660650': at(650, 650), // inside the locked estate
};
