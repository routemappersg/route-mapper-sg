/** Core domain types. Personal fields (recipient, unit, contact) exist ONLY on-device. */

export type StopStatus = 'pending' | 'delivered' | 'failed' | 'skipped';

export interface LatLng {
  lat: number;
  lng: number;
}

/** A stop as held in IndexedDB on the driver's device. Never sent over the network. */
export interface Stop {
  id: string;
  postal?: string;
  block?: string;
  street?: string;
  /** PERSONAL: device-only. */
  unit?: string;
  /** PERSONAL: device-only. */
  recipient?: string;
  /** PERSONAL: device-only. */
  contact?: string;
  note?: string;
  /** Latest arrival, minutes after midnight on the run date. A warning source, never a blocker. */
  deadlineMin?: number;
  status: StopStatus;
  /** Fields the parser or geocoder is unsure about; the UI asks the user to confirm. */
  flags: string[];
}

/** What may leave the device: coordinates and postal code only. */
export interface Place {
  postal?: string;
  position: LatLng;
  /** True when the position is the main guarded vehicle gate of a gated development. */
  gated: boolean;
  confidence: 'verified' | 'map-data' | 'guess';
}
