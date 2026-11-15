/**
 * Provider adapters. Every external service sits behind one of these interfaces so a
 * swap is configuration, not a rewrite. Inputs are limited to postal codes and
 * coordinates: personal data must never appear in any provider call (PDPA guard).
 */
import type { LatLng, Place } from '../domain/types';

export interface Geocoder {
  readonly id: string;
  /** Resolve a postal code to a place (gate rule applied by the resolver layer). */
  byPostal(postal: string): Promise<Place | null>;
  /** Fallback when no postal code is given. Block and street only. */
  bySearch(block: string, street: string): Promise<Place[]>;
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
  router: Router;
  optimizer: Optimizer;
  tiles: TileSource;
  store: KeyValueStore;
}
