/**
 * Provider adapters. Every external service sits behind one of these interfaces so a
 * swap is configuration, not a rewrite. Inputs are limited to postal codes and
 * coordinates: personal data must never appear in any provider call (PDPA guard).
 */
import type { LatLng } from '../domain/types';

/** A raw geocoder answer: the building point, before the gate rule is applied. */
export interface GeocodeHit {
  postal?: string;
  block?: string;
  street?: string;
  building?: string;
  position: LatLng;
}

export interface Geocoder {
  readonly id: string;
  /** Look up a postal code. Only the postal code is sent. */
  byPostal(postal: string): Promise<GeocodeHit | null>;
  /** Fallback when no postal code is given. Only block and street are sent. */
  bySearch(block: string, street: string): Promise<GeocodeHit[]>;
}

/** OpenStreetMap-style road classes. motorway = expressway; *_link = slip road. */
export type RoadClass =
  | 'motorway' | 'motorway_link' | 'trunk' | 'trunk_link'
  | 'primary' | 'primary_link' | 'secondary' | 'secondary_link'
  | 'tertiary' | 'tertiary_link' | 'unclassified' | 'residential'
  | 'living_street' | 'service' | 'other';

export interface Road {
  id: string;
  cls: RoadClass;
  /** access=private/no: an estate road, not a public road. */
  private: boolean;
  coords: LatLng[];
  name?: string;
}

export type GateKind = 'guardhouse' | 'barrier' | 'pedestrian';

export interface GateNode {
  id: string;
  position: LatLng;
  kind: GateKind;
}

export interface Development {
  id: string;
  name?: string;
  /** Closed ring. */
  boundary: LatLng[];
  gated: boolean;
  postals: string[];
}

export interface MapArea {
  roads: Road[];
  gates: GateNode[];
  developments: Development[];
}

/** Road and gate map data around a point (OpenStreetMap via Overpass, proxied and cached). */
export interface MapDataSource {
  readonly id: string;
  around(position: LatLng, radiusM: number): Promise<MapArea>;
}

export interface TimeMatrix {
  /** Seconds, row = from, column = to. */
  durations: number[][];
  /** Metres. */
  distances: number[][];
}

export interface Router {
  readonly id: string;
  matrix(points: LatLng[]): Promise<TimeMatrix>;
  /** Road geometry for drawing the route line. */
  path(points: LatLng[]): Promise<LatLng[]>;
}

export interface OptimizeJob {
  points: LatLng[];
  /** Indices into `points`. */
  start: number;
  end: number | null;
  /** Per-point service time, seconds. */
  serviceSec: number[];
  /** Per-point latest arrival, seconds from run start. Soft: breaches are reported, not forbidden. */
  deadlineSec: (number | null)[];
  /** Indices that must keep their position. */
  locked: number[];
}

export interface OptimizeResult {
  /** Visit order as indices into `points`. */
  order: number[];
  etaSec: number[];
  lateBySec: number[];
  totalSec: number;
  totalMeters: number;
}

export interface Optimizer {
  readonly id: string;
  optimize(job: OptimizeJob): Promise<OptimizeResult>;
}

export interface TileSource {
  readonly id: string;
  styleUrl: string;
  /** Must be shown on every map. */
  attribution: string;
}

export interface KeyValueStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export interface Providers {
  geocoder: Geocoder;
  mapData: MapDataSource;
  router: Router;
  optimizer: Optimizer;
  tiles: TileSource;
  store: KeyValueStore;
}
